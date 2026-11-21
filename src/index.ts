import 'dotenv/config';
import { randomInt } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Client, GatewayIntentBits, Events, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, FileBuilder } from 'discord.js';
import pino from 'pino';
import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';
import { reviewCard } from './review-card.js';
import { welcomeCard } from './welcome-card.js';
import { levelUpCard } from './level-card.js';

const {DISCORD_TOKEN,DATABASE_URL}=process.env;
if(!DISCORD_TOKEN || !DATABASE_URL) throw new Error('Missing DISCORD_TOKEN or DATABASE_URL');
const db=new PrismaClient();
const log=pino({level:process.env.LOG_LEVEL??'info'});
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]});
function orderAttachmentName(original:string,itemId:string){
 const extension=(/\.([a-zA-Z0-9]{1,12})$/.exec(original)?.[1]??'bin').toLowerCase();
 return 'lextrum-product-'+itemId+'.'+extension;
}
function orderDeliveryErrorInfo(error:unknown){
 const e=error as {name?:string;message?:string;code?:number|string;errors?:unknown;issues?:unknown;rawError?:unknown};
 return {name:e?.name??'Error',message:e?.message??String(error),code:e?.code??null,
  issues:e?.issues??null,errors:e?.errors??e?.rawError??null};
}

const joins=new Map<string,number[]>();
const cooldown=new Map<string,number>();
const inviteCache=new Map<string,Map<string,{uses:number;inviterId:string|null}>>();

const messageBursts=new Map<string,{at:number;signature:string;attachmentCount:number}[]>();
const violations=new Map<string,{count:number;last:number}>();
const riskyDomains=/(?:discord(?:-?nitro|-?gift|-?app)?\.(?:gift|click|top|xyz|ru)|(?:steam|roblox|discord)[-_.]?(?:free|bonus|verify|claim)\.(?:com|net|xyz|top)|bit\.ly|tinyurl\.com)\b/i;
const suspiciousInvite=/https?:\/\/(?:discord\.gg|discord(?:app)?\.com\/invite)\/[^\s]+/i;
type FaqRule={trigger:string;answer:string|null};
const faqCache=new Map<string,{expires:number;rules:Map<string,string>}>();
const faqCooldown=new Map<string,number>();
const normalizeFaq=(value:string)=>value.trim().toLocaleLowerCase().replace(/\s+/g,' ');
async function loadFaq(guildId:string){
 const cached=faqCache.get(guildId);
 if(cached&&cached.expires>Date.now())return cached.rules;
 const events=await db.auditEvent.findMany({where:{guildId,event:'FAQ_RULE'},orderBy:{createdAt:'desc'},take:500,select:{detail:true}});
 const rules=new Map<string,string>();
 const seen=new Set<string>();
 for(const event of events){
  try{
   const data=JSON.parse(event.detail??'') as FaqRule;
   if(typeof data.trigger!=='string'||typeof data.answer!=='string'&&data.answer!==null)continue;
   if(seen.has(data.trigger))continue;
   seen.add(data.trigger);
   if(data.answer!==null&&rules.size<100)rules.set(data.trigger,data.answer);
  }catch{}
 }
 faqCache.set(guildId,{expires:Date.now()+60_000,rules});
 return rules;
}
const suspiciousWords=/\b(?:free\s+(?:nitro|robux|money)|claim\s+(?:your\s+)?(?:reward|bonus)|withdrawal\s+success|deposit\s+to\s+(?:claim|unlock)|crypto\s+giveaway)\b/i;
async function antiRaidLog(guildId:string,details:string){
 const guild=client.guilds.cache.get(guildId);
 const channel=guild?.channels.cache.find(ch=>ch.type===ChannelType.GuildText && /^(?:・|･|#|\s|-)*anti[- _]?raid(?:[- _]?logs?)?$/i.test(ch.name));
 if(channel?.isTextBased() && 'send' in channel){
  await channel.send({content:details.slice(0,1900),allowedMentions:{parse:[]}}).catch(e=>log.warn(e,'Anti-raid log failed'));
 }else{
  await audit(guildId,'AUTO_MOD',undefined,details);
 }
}
async function moderateSpam(message:import('discord.js').Message<true>):Promise<boolean>{
 if(message.member?.permissions.has(PermissionFlagsBits.ManageMessages))return false;
 const key=message.guildId+':'+message.author.id,now=Date.now();
 const text=message.content.toLowerCase().trim();
 const images=message.attachments.filter(a=>a.contentType?.startsWith('image/')||/\.(?:png|jpe?g|gif|webp)$/i.test(a.name)).size;
 const signature=text.replace(/https?:\/\/\S+/g,'[link]').replace(/\s+/g,' ').slice(0,220);
 const history=(messageBursts.get(key)??[]).filter(x=>now-x.at<45_000);
 history.push({at:now,signature,attachmentCount:images});
 messageBursts.set(key,history);
 const duplicateCount=history.filter(x=>x.signature===signature && (signature.length>=12||images>0)).length;
 const recentImages=history.filter(x=>now-x.at<20_000).reduce((n,x)=>n+x.attachmentCount,0);
 const everyone=message.mentions.everyone || /<@&\d+>/.test(text) && message.mentions.roles.size>=4;
 const massMentions=message.mentions.users.size>=8;
 const suspiciousPromo=suspiciousWords.test(text) && (images>=2||/https?:\/\//i.test(text));
 const phishing=riskyDomains.test(text) && (suspiciousWords.test(text)||/nitro|gift|verify|login|claim|free/i.test(text));
 const inviteSpam=suspiciousInvite.test(text) && (history.filter(x=>now-x.at<45_000&&x.signature===signature).length>=3);
 const flood=history.filter(x=>now-x.at<10_000).length>=7;
 const reason=phishing?'Įtartina phishing / scam nuoroda':inviteSpam?'Pasikartojančios Discord invite nuorodos':everyone?'@everyone/@here arba masiniai role paminėjimai':massMentions?'Masiniai narių paminėjimai':duplicateCount>=3?'Pasikartojantis spam':(images>=4||recentImages>=8)?'Masinis nuotraukų spam':suspiciousPromo?'Įtartina reklama / scam':flood?'Žinučių flood':null;
 if(!reason)return false;
 const deleted=await message.delete().then(()=>true).catch(()=>false);
 const state=violations.get(key),count=(state&&now-state.last<30*60_000?state.count:0)+1;
 violations.set(key,{count,last:now});
 let action='Tik ištrinta žinutė';
 if(count>=2 && message.member?.moderatable){
  const duration=Math.min(60,count===2?10:30);
  const timed=await message.member.timeout(duration*60_000,'Lextrum AutoMod: '+reason).then(()=>true).catch(()=>false);
  if(timed)action='Timeout '+duration+' min';
 }
 const details='🛡️ **Anti-raid / AutoMod**\nNarys: <@'+message.author.id+'> ('+message.author.id+')\nKanalas: <#'+message.channelId+'>\nPriežastis: '+reason+'\nVeiksmas: '+action+'\nIštrinta: '+(deleted?'taip':'ne (trūksta teisių)')+'\nPriedai: '+message.attachments.size+'\nTekstas: '+(message.content.slice(0,350).replace(/@/g,'＠')||'[tik failai]');
 await antiRaidLog(message.guildId,details);
 await audit(message.guildId,'AUTOMOD_SPAM',message.author.id,reason+'; '+action);
 return true;
}

async function refreshInvites(guildId:string){
 const guild=await client.guilds.fetch(guildId);
 try{const invites=await guild.invites.fetch();const result=new Map<string,{uses:number;inviterId:string|null}>();for(const inv of invites.values())result.set(inv.code,{uses:inv.uses??0,inviterId:inv.inviterId??null});return result;}catch(e){log.warn({guildId,error:e},'Invite tracking requires Manage Guild permission');return null;}
}
function renderMessage(template:string,values:Record<string,string>){return template.replace(/\{(user|username|count|inviter|level|invites)\}/g,(_,key:string)=>values[key]??'unknown').slice(0,1900);}
async function sendTo(guildId:string,channelId:string|null|undefined,content:string){if(!channelId)return;const ch=await client.guilds.cache.get(guildId)?.channels.fetch(channelId).catch(()=>null);if(ch?.isTextBased()&&'send' in ch)await ch.send({content,allowedMentions:{parse:[]}}).catch(e=>log.warn(e,'Could not send community message'));}
const xpLevel=(points:number)=>Math.floor(Math.sqrt(Math.max(0,points)/100));
client.once(Events.ClientReady,async()=>{for(const guild of client.guilds.cache.values()){const codes=await refreshInvites(guild.id);if(codes)inviteCache.set(guild.id,codes);}});
client.on(Events.InviteCreate,async invite=>{if(!invite.guild)return;const codes=await refreshInvites(invite.guild.id);if(codes)inviteCache.set(invite.guild.id,codes);});
client.on(Events.InviteDelete,async invite=>{if(!invite.guild)return;const codes=await refreshInvites(invite.guild.id);if(codes)inviteCache.set(invite.guild.id,codes);});

async function audit(guildId:string,event:string,actorId?:string,detail?:string){
  await db.auditEvent.create({data:{guildId,event,actorId,detail}});
  const cfg=await db.guildConfig.findUnique({where:{guildId}});
  if(!cfg?.logChannelId)return;
  const ch=await client.channels.fetch(cfg.logChannelId).catch(()=>null);
  if(!ch?.isTextBased()||!('send' in ch))return;
  const person=actorId?'<@'+actorId+'> ('+actorId+')':'Sistema';
  const descriptions:Record<string,string>={
    VERIFY:'✅ **Narys patvirtintas / Verified**',
    MEMBER_LEFT:'👋 **Narys išėjo / Member left**',
    RAID_ALERT:'🚨 **Anti-Raid įspėjimas**',
    MASS_MENTIONS:'🛡️ **Masiniai paminėjimai**',
    AUTOMOD_SPAM:'🛡️ **AutoMod pažeidimas**'
  };
  const heading=descriptions[event]??'📋 **'+event.replace(/_/g,' ')+'**';
  const body=heading+'\n**Narys / User:** '+person+(detail?'\n**Informacija:** '+detail.replace(/@/g,'＠'):'')+'\n**Laikas:** <t:'+Math.floor(Date.now()/1000)+':F>';
  await ch.send({content:body.slice(0,1900),allowedMentions:{parse:[]}}).catch(e=>log.warn(e,'Audit log send failed'));
}
async function lockdown(guildId:string,enable:boolean,actor:string){
  const guild=await client.guilds.fetch(guildId);
  await guild.channels.fetch();
  const me=await guild.members.fetchMe();
  const cfg=await db.guildConfig.upsert({where:{guildId},create:{guildId},update:{}});
  if(enable===cfg.lockdown)return;
  if(enable){
    for(const ch of guild.channels.cache.values()){
      if(ch.type!==ChannelType.GuildText || !ch.permissionsFor(me)?.has(PermissionFlagsBits.ManageRoles))continue;
      const existing=ch.permissionOverwrites.cache.get(guild.roles.everyone.id);
      const previous=existing?.allow.has(PermissionFlagsBits.SendMessages)?'allow':existing?.deny.has(PermissionFlagsBits.SendMessages)?'deny':'inherit';
      try {
        await ch.permissionOverwrites.edit(guild.roles.everyone,{SendMessages:false},{reason:'Anti-raid lockdown'});
        await db.lockdownOverwrite.upsert({where:{guildId_channelId:{guildId,channelId:ch.id}},create:{guildId,channelId:ch.id,previous},update:{previous}});
      } catch(e){log.warn({error:e,channel:ch.id},'Could not lock channel');}
    }
  }else{
    const snapshots=await db.lockdownOverwrite.findMany({where:{guildId}});
    for(const snap of snapshots){
      const ch=guild.channels.cache.get(snap.channelId);
      if(ch?.type===ChannelType.GuildText && ch.permissionsFor(me)?.has(PermissionFlagsBits.ManageRoles)){
        try {
          await ch.permissionOverwrites.edit(guild.roles.everyone,{SendMessages:snap.previous==='inherit'?null:snap.previous==='allow'},{reason:'Restore pre-lockdown permissions'});
          await db.lockdownOverwrite.delete({where:{guildId_channelId:{guildId,channelId:ch.id}}});
        }catch(e){log.warn({error:e,channel:ch.id},'Could not restore permissions');}
      }
    }
  }
  await db.guildConfig.update({where:{guildId},data:{lockdown:enable}});
  await audit(guildId,enable?'LOCKDOWN':'UNLOCK',actor);
}
client.once(Events.ClientReady,c=>log.info({bot:c.user.tag,release:'lextrum-ticket-forms-claim-20261114'},'Bot online'));
client.on(Events.GuildMemberAdd,async member=>{
  try{
    const now=Date.now(),guildId=member.guild.id;
    const recent=(joins.get(guildId)??[]).filter(t=>now-t<60_000);recent.push(now);joins.set(guildId,recent);
    const cfg=await db.guildConfig.findUnique({where:{guildId}});
    if(recent.length>=(cfg?.joinThreshold??8) && !cfg?.lockdown){
      await audit(guildId,'RAID_ALERT',undefined,`${recent.length} members joined within one minute`);
      await lockdown(guildId,true,'system');
    }
    const auto=await db.communityAutomation.findUnique({where:{guildId}});
    let inviterId:string|null=null;let inviteCode:string|null=null;
    if(auto?.inviteTrackingEnabled!==false){
      const previous=inviteCache.get(guildId);
      const current=await refreshInvites(guildId);
      if(current){if(previous){const used=[...current.entries()].find(([code,entry])=>entry.uses>(previous.get(code)?.uses??0));if(used){inviteCode=used[0];inviterId=used[1].inviterId;}}inviteCache.set(guildId,current);}
      await db.memberInvite.upsert({where:{guildId_userId:{guildId,userId:member.id}},create:{guildId,userId:member.id,inviterId,inviteCode},update:{inviterId,inviteCode,joinedAt:new Date()}});
      if(auto?.inviteLogChannelId)await sendTo(guildId,auto.inviteLogChannelId,'🔗 <@'+member.id+'> joined • inviter: '+(inviterId?'<@'+inviterId+'>':'unknown')+' • code: '+(inviteCode??'unknown'));
    }
    if(auto?.welcomeChannelId){
      const welcomeChannel=await member.guild.channels.fetch(auto.welcomeChannelId).catch(()=>null);
      if(welcomeChannel?.isTextBased() && 'send' in welcomeChannel){
        const card=await welcomeCard(member.displayName,member.guild.memberCount,member.user.displayAvatarURL({extension:'png',size:256}));
        await welcomeChannel.send({files:[new AttachmentBuilder(card,{name:'lextrum-welcome.png'})]});
      }
    }
    if(member.user.createdTimestamp>now-3*86400_000)await audit(guildId,'NEW_ACCOUNT',member.id);
  }catch(e){log.error(e,'Join handler');}
});
client.on(Events.GuildMemberRemove,async member=>{
 try{const auto=await db.communityAutomation.findUnique({where:{guildId:member.guild.id}});if(auto?.goodbyeChannelId)await sendTo(member.guild.id,auto.goodbyeChannelId,renderMessage(auto.goodbyeMessage,{user:member.user.username,username:member.user.username,count:String(member.guild.memberCount),inviter:'unknown',level:'0',invites:'0'}));await audit(member.guild.id,'MEMBER_LEFT',member.id);}catch(e){log.error(e,'Leave handler');}
});
client.on(Events.MessageCreate,async message=>{
  if(!message.inGuild()||message.author.bot)return;
  try{
    if(await moderateSpam(message))return;
    const faqText=normalizeFaq(message.content);
    if(faqText.length>=3&&faqText.length<=100){
      const faqKey=message.guildId+':'+message.channelId+':'+message.author.id;
      if(Date.now()-(faqCooldown.get(faqKey)??0)>60_000){
        const answer=(await loadFaq(message.guildId)).get(faqText);
        if(answer){
          faqCooldown.set(faqKey,Date.now());
          await message.reply({content:answer,allowedMentions:{parse:[]}}).catch(e=>log.warn(e,'FAQ response failed'));
        }
      }
    }
    const key=`${message.guildId}:${message.author.id}`,now=Date.now();
    const auto=await db.communityAutomation.findUnique({where:{guildId:message.guildId}});if(auto?.xpEnabled===false)return;
    if(now-(cooldown.get(key)??0)<(auto?.xpCooldownSeconds??60)*1000)return;
    cooldown.set(key,now);
    const points=auto?.xpPerMessage??5;
    const old=await db.xp.findUnique({where:{guildId_userId:{guildId:message.guildId,userId:message.author.id}}});
    const next=await db.xp.upsert({where:{guildId_userId:{guildId:message.guildId,userId:message.author.id}},create:{guildId:message.guildId,userId:message.author.id,points},update:{points:{increment:points},lastEarnedAt:new Date()}});
    const level=xpLevel(next.points);
    if(auto?.levelUpEnabled!==false&&level>xpLevel(old?.points??0)&&level>0){
      const channel=await message.guild.channels.fetch(auto?.levelChannelId??message.channelId).catch(()=>null);
      if(channel?.isTextBased()&&'send' in channel){
        try{
          const member=message.member??await message.guild.members.fetch(message.author.id).catch(()=>null);
          const card=await levelUpCard(member?.displayName??message.author.displayName,level,message.author.displayAvatarURL({extension:'png',size:256}));
          await channel.send({files:[new AttachmentBuilder(card,{name:'lextrum-level-up.png'})]});
        }catch(error){
          log.warn({error,guildId:message.guildId,userId:message.author.id},'Level-up card failed; sending text fallback');
          await channel.send({content:'🎉 <@'+message.author.id+'> pasiekė **'+level+'** lygį!',allowedMentions:{users:[message.author.id]}}).catch(e=>log.error(e,'Level-up fallback failed'));
        }
      }else log.warn({guildId:message.guildId,channelId:auto?.levelChannelId},'Level-up channel unavailable');
      await audit(message.guildId,'LEVEL_UP',message.author.id,String(level));
    }
  }catch(e){log.error(e,'Message handler');}
});
client.on(Events.InteractionCreate,async interaction=>{
  if(!interaction.isChatInputCommand()||!interaction.inGuild())return;
  try{
    const id=interaction.guildId,guild=interaction.guild!,cmd=interaction.commandName,sub=interaction.options.getSubcommand(false);
    const privileged=['setup','security','announce'].includes(cmd);
    if(privileged && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){
      await interaction.reply({content:'Manage Server permission required.',flags:MessageFlags.Ephemeral});return;
    }
    if(cmd==='dm-update'){
      if(!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)){
        await interaction.reply({content:'Tik administratoriams.',flags:MessageFlags.Ephemeral});return;
      }
      const title=interaction.options.getString('title',true).trim();
      const body=interaction.options.getString('message',true).trim();
      if(title.length<3||title.length>100||body.length<5||body.length>1500){
        await interaction.reply({content:'Patikrink pavadinimo ir teksto ilgį.',flags:MessageFlags.Ephemeral});return;
      }
      const recent=await db.auditEvent.findFirst({where:{guildId:id,event:'DM_UPDATE_BROADCAST',createdAt:{gte:new Date(Date.now()-24*60*60_000)}},orderBy:{createdAt:'desc'}});
      if(recent){await interaction.reply({content:'Atnaujinimų DM galima siųsti ne dažniau kaip kartą per 24 valandas.',flags:MessageFlags.Ephemeral});return;}
      const subscribers=await db.subscription.findMany({where:{guildId:id,enabled:true},select:{userId:true},take:101});
      if(subscribers.length>100){await interaction.reply({content:'Yra daugiau nei 100 prenumeratorių. Masinis siuntimas sustabdytas – reikalinga atskira eilės sistema.',flags:MessageFlags.Ephemeral});return;}
      if(!subscribers.length){await interaction.reply({content:'Nėra prenumeratorių. Nariai gali užsiprenumeruoti su /updates subscribe.',flags:MessageFlags.Ephemeral});return;}
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      await db.auditEvent.create({data:{guildId:id,event:'DM_UPDATE_BROADCAST',actorId:interaction.user.id,detail:JSON.stringify({title,recipients:subscribers.length})}});
      let sent=0,failed=0,skipped=0;
      for(const sub of subscribers){
        try{
          const current=await db.subscription.findUnique({where:{guildId_userId:{guildId:id,userId:sub.userId}}});
          if(!current?.enabled){skipped++;continue;}
          const member=await guild.members.fetch(sub.userId).catch(()=>null);
          if(!member||member.user.bot){skipped++;continue;}
          await member.send({content:'📢 **'+title.replace(/[@*_~`|]/g,'')+'**\n\n'+body+'\n\n_Šio serverio atnaujinimai. Atsisakyti: /updates unsubscribe_',allowedMentions:{parse:[]}});
          sent++;
        }catch(e){failed++;log.warn({err:e,userId:sub.userId},'Update DM delivery failed');}
        await new Promise(resolve=>setTimeout(resolve,1100));
      }
      await db.auditEvent.create({data:{guildId:id,event:'DM_UPDATE_RESULT',actorId:interaction.user.id,detail:JSON.stringify({sent,failed,skipped})}});
      await interaction.editReply('📨 Atnaujinimas išsiųstas. Pavyko: '+sent+' • nepavyko: '+failed+' • praleista: '+skipped+'. Tik užsiprenumeravusiems nariams.');return;
    }
    if(cmd==='dm'||cmd==='dm-history'){
      if(!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)){
        await interaction.reply({content:'Ši komanda skirta tik serverio administratoriams.',flags:MessageFlags.Ephemeral});return;
      }
      if(cmd==='dm-history'){
        const records=await db.auditEvent.findMany({where:{guildId:id,event:'ADMIN_DM_SENT'},orderBy:{createdAt:'desc'},take:interaction.options.getInteger('limit')??10});
        const lines=records.map(x=>'• <t:'+Math.floor(x.createdAt.getTime()/1000)+':f> • admin: <@'+x.actorId+'> • gavėjas: <@'+(x.detail??'unknown')+'>');
        await interaction.reply({content:lines.length?'📩 **DM siuntimo istorija** (žinučių turinys nesaugomas)\n'+lines.join('\n'):'Išsiųstų DM įrašų nėra.',flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});return;
      }
      const recipient=interaction.options.getUser('user',true);
      const messageText=interaction.options.getString('message',true).trim();
      if(recipient.bot||recipient.id===client.user?.id||recipient.id===interaction.user.id){
        await interaction.reply({content:'Pasirink kitą tikrą narį (ne botą ir ne save).',flags:MessageFlags.Ephemeral});return;
      }
      if(!messageText||messageText.length>1800){
        await interaction.reply({content:'Žinutė turi būti 1–1800 simbolių.',flags:MessageFlags.Ephemeral});return;
      }
      const member=await guild.members.fetch(recipient.id).catch(()=>null);
      if(!member){await interaction.reply({content:'Gavėjas turi būti šio serverio narys.',flags:MessageFlags.Ephemeral});return;}
      const since=new Date(Date.now()-24*60*60_000);
      const recent=await db.auditEvent.findMany({where:{guildId:id,event:'ADMIN_DM_SENT',actorId:interaction.user.id,createdAt:{gte:since}},orderBy:{createdAt:'desc'},take:20,select:{createdAt:true}});
      if(recent.length>=20){await interaction.reply({content:'Pasiektas 20 DM per 24 val. limitas.',flags:MessageFlags.Ephemeral});return;}
      if(recent[0]&&Date.now()-recent[0].createdAt.getTime()<60_000){await interaction.reply({content:'Palauk 60 sekundžių prieš siųsdamas kitą DM.',flags:MessageFlags.Ephemeral});return;}
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      try{
        await recipient.send({content:'📩 **'+guild.name.replace(/[@*_`~|]/g,'')+' administracijos žinutė**\n'+messageText+'\n\n_Siuntė serverio administratorius: '+interaction.user.username+'_ ',allowedMentions:{parse:[]}});
      }catch{
        await interaction.editReply('Nepavyko išsiųsti DM. Gavėjas gali būti išjungęs privačias žinutes.');return;
      }
      await db.auditEvent.create({data:{guildId:id,event:'ADMIN_DM_SENT',actorId:interaction.user.id,detail:recipient.id}});
      await interaction.editReply('✅ DM sėkmingai išsiųsta <@'+recipient.id+'>. Žinutės turinys istorijoje nesaugomas.');return;
    }
    if(cmd==='faq-set'||cmd==='faq-remove'||cmd==='faq-list'){
      if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){await interaction.reply({content:'Reikia Manage Server teisės.',flags:MessageFlags.Ephemeral});return;}
      if(cmd==='faq-list'){
        const rules=await loadFaq(id);
        const lines=[...rules.keys()].slice(0,30).map((trigger,i)=>(i+1)+'. '+trigger);
        await interaction.reply({content:lines.length?'**Auto Responder frazės:**\n'+lines.join('\n'):'Automatinių atsakymų dar nėra.',flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});return;
      }
      const trigger=normalizeFaq(interaction.options.getString('trigger',true));
      if(trigger.length<3||trigger.length>100){await interaction.reply({content:'Frazė turi būti 3–100 simbolių.',flags:MessageFlags.Ephemeral});return;}
      const answer=cmd==='faq-set'?interaction.options.getString('answer',true).trim():null;
      if(answer!==null&&(!answer||answer.length>1500)){await interaction.reply({content:'Atsakymas turi būti 1–1500 simbolių.',flags:MessageFlags.Ephemeral});return;}
      const rules=await loadFaq(id);
      if(answer!==null&&!rules.has(trigger)&&rules.size>=100){await interaction.reply({content:'Pasiektas 100 taisyklių limitas.',flags:MessageFlags.Ephemeral});return;}
      await db.auditEvent.create({data:{guildId:id,event:'FAQ_RULE',actorId:interaction.user.id,detail:JSON.stringify({trigger,answer})}});
      faqCache.delete(id);
      await interaction.reply({content:answer!==null?'✅ Automatinis atsakymas išsaugotas.':'🗑️ Automatinis atsakymas išjungtas.',flags:MessageFlags.Ephemeral});return;
    }
    if(cmd==='apply'){
      const modal=new ModalBuilder().setCustomId('dg_staff_application').setTitle('Lextrum • Staff Application');
      const motivation=new TextInputBuilder().setCustomId('motivation').setLabel('Kodėl nori prisijungti prie staff?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(20).setMaxLength(1000);
      const experience=new TextInputBuilder().setCustomId('experience').setLabel('Patirtis ir įgūdžiai').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);
      const availability=new TextInputBuilder().setCustomId('availability').setLabel('Kiek laiko gali skirti per savaitę?').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(motivation),new ActionRowBuilder<TextInputBuilder>().addComponents(experience),new ActionRowBuilder<TextInputBuilder>().addComponents(availability));
      await interaction.showModal(modal);return;
    }
    if(cmd==='applications'){
      if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){await interaction.reply({content:'Reikia Manage Server teisės.',flags:MessageFlags.Ephemeral});return;}
      const records=await db.auditEvent.findMany({where:{guildId:id,event:'STAFF_APPLICATION'},orderBy:{createdAt:'desc'},take:interaction.options.getInteger('limit')??10});
      const body=records.map(x=>'• <@'+x.actorId+'> • <t:'+Math.floor(x.createdAt.getTime()/1000)+':R> • '+(x.detail??'').slice(0,100)).join('\n');
      await interaction.reply({content:body||'Staff paraiškų dar nėra.',flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});return;
    }
    if(cmd==='ticket-config'){
      if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){await interaction.reply({content:'Reikia Manage Server teisės.',flags:MessageFlags.Ephemeral});return;}
      const channel=interaction.options.getChannel('feedback_channel',true);
      await db.communityPanel.upsert({where:{guildId:id},create:{guildId:id,feedbackChannelId:channel.id},update:{feedbackChannelId:channel.id}});
      await interaction.reply({content:'⭐ Transcript ir feedback kanalas nustatytas: <#'+channel.id+'>',flags:MessageFlags.Ephemeral});return;
    }
    if(cmd==='createorder'){
      if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){
        await interaction.reply({content:'Tik administracija gali kurti užsakymus.',flags:MessageFlags.Ephemeral});return;
      }
      const orderNumber=interaction.options.getString('ordernumber',true).trim();
      const productName=interaction.options.getString('product_name',true).trim();
      const productNumber=(interaction.options.getString('productnumber')??'1').trim();
      const buyerId=interaction.options.getUser('buyer')?.id;
      if(!/^[a-zA-Z0-9_-]{3,40}$/.test(orderNumber)||!/^[a-zA-Z0-9_-]{1,30}$/.test(productNumber)){
        await interaction.reply({content:'Leidžiami tik raidžių, skaičių, brūkšnelių ir _ numeriai.',flags:MessageFlags.Ephemeral});return;
      }
      const existing=await db.digitalOrder.findUnique({where:{guildId_orderNumber:{guildId:id,orderNumber}},include:{items:true}});
      if(existing?.buyerId&&buyerId&&existing.buyerId!==buyerId&&existing.items.some(item=>item.deliveredAt)){
        await interaction.reply({content:'Šio užsakymo prekė jau perduota kitam pirkėjui.',flags:MessageFlags.Ephemeral});return;
      }
      const itemExisting=existing?.items.find(item=>item.productNumber===productNumber);
      if(itemExisting?.deliveredAt){
        await interaction.reply({content:'Šis produktas jau atsiimtas ir nebegali būti keičiamas.',flags:MessageFlags.Ephemeral});return;
      }
      const order=await db.digitalOrder.upsert({
        where:{guildId_orderNumber:{guildId:id,orderNumber}},
        create:{guildId:id,orderNumber,productName,buyerId:buyerId??null},
        update:{productName,...(buyerId?{buyerId}:{})}
      });
      await db.digitalOrderItem.upsert({
        where:{orderId_productNumber:{orderId:order.id,productNumber}},
        create:{orderId:order.id,productNumber,productName},
        update:{productName}
      });
      await audit(id,'ORDER_CREATED',interaction.user.id,orderNumber+' #'+productNumber);
      await interaction.reply({content:'📦 **Order #'+orderNumber+'** · Prekė #'+productNumber+' — '+productName+'\n'+(buyerId?'Pirkėjas: <@'+buyerId+'>':'⚠️ Pirkėjas dar nepriskirtas')+'\nFailą gali įkelti svetainės **Orders** skiltyje. Atsiėmimas: `/recieveorder`.',flags:MessageFlags.Ephemeral});return;
    }
    if(cmd==='recieveorder'){
      const orderNumber=interaction.options.getString('ordernumber',true).trim();
      const productName=interaction.options.getString('productname',true).trim();
      if(!/^[a-zA-Z0-9_-]{3,40}$/.test(orderNumber)||!productName||productName.length>150){
        await interaction.reply({content:'Invalid order number or product name.',flags:MessageFlags.Ephemeral});return;
      }
      const order=await db.digitalOrder.findUnique({where:{guildId_orderNumber:{guildId:id,orderNumber}},include:{items:{select:{id:true,productName:true,productNumber:true,fileName:true,deliveredAt:true,deliveryState:true,preparationStatus:true}}}});
      const matches=order?.items.filter(item=>item.productName.trim().toLocaleLowerCase('en-US')===productName.toLocaleLowerCase('en-US'))??[];
      if(matches.length>1){await interaction.reply({content:'Multiple products have that name in this order. Please contact support to clarify which product you want to receive.',flags:MessageFlags.Ephemeral});return;}
      const item=matches[0];
      if(!order||!item){await interaction.reply({content:'Order or product not found. Check the order number and enter the exact product name shown in your purchase.',flags:MessageFlags.Ephemeral});return;}
      if(!order.buyerId){await interaction.reply({content:'Užsakymas dar nepriskirtas pirkėjui. Susisiek su administracija.',flags:MessageFlags.Ephemeral});return;}
      if(order.buyerId!==interaction.user.id){await interaction.reply({content:'Šis užsakymas nepriskirtas tavo Discord paskyrai.',flags:MessageFlags.Ephemeral});return;}
      if(item.deliveredAt||item.deliveryState!=='pending'){await interaction.reply({content:'This product has already been delivered or is currently being sent.',flags:MessageFlags.Ephemeral});return;}
      if(!item.fileName||item.preparationStatus!=='ready'){
        const reviewing=item.preparationStatus==='reviewing';
        const heading=reviewing?'🔎 Your order is under review':'📦 Your order is being prepared';
        const description=[
         '**Order:** #'+orderNumber,
         '**Product:** '+item.productName,
         '',
         reviewing?'Our team is currently checking your product before delivery.':'Your product is being prepared and is not ready for delivery yet.',
         '',
         '**Please try /recieveorder again later.**',
         'Once your product is ready, you will be asked to accept the delivery terms before receiving the file in your DMs.'
        ].join(String.fromCharCode(10));
        const panel=new ContainerBuilder().setAccentColor(reviewing?0x5c85d6:0xf0b34e)
         .addTextDisplayComponents(new TextDisplayBuilder().setContent('**'+heading+'**'))
         .addTextDisplayComponents(new TextDisplayBuilder().setContent(description));
        await interaction.reply({flags:MessageFlags.Ephemeral|MessageFlags.IsComponentsV2,components:[panel]});return;
      }
      const terms=[
       '**🔐 Digital Product Delivery Terms**',
       '',
       '• This product is licensed to you only. You may not leak, share, redistribute, upload publicly, or resell the file without permission.',
       '• Do not give copies of this file to other people, servers, or websites.',
       '• Respect the original creator’s licence and intellectual property rights.',
       '• Violating these terms may restrict future deliveries under the purchase agreement.',
       '',
       '**Do you agree?** Accept to receive the purchased file privately in your Discord DMs.'
      ].join(String.fromCharCode(10));
      const container=new ContainerBuilder().setAccentColor(0x8066f2)
       .addTextDisplayComponents(new TextDisplayBuilder().setContent('**📦 Order #'+orderNumber+' · '+item.productName+'**'))
       .addTextDisplayComponents(new TextDisplayBuilder().setContent(terms))
       .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('lx_order_accept:'+item.id).setLabel('✅ Sutinku / Accept').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('lx_order_decline:'+item.id).setLabel('❌ Nesutinku / Decline').setStyle(ButtonStyle.Secondary)
       ));
      await interaction.reply({flags:MessageFlags.Ephemeral|MessageFlags.IsComponentsV2,components:[container]});return;
    }
    if(cmd==='suggestion-config'){
      if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){await interaction.reply({content:'Reikia Manage Server leidimo.',flags:MessageFlags.Ephemeral});return;}
      const channel=interaction.options.getChannel('channel',true);
      await db.guildConfig.upsert({where:{guildId:id},create:{guildId:id,suggestionChannelId:channel.id},update:{suggestionChannelId:channel.id}});
      await interaction.reply({content:'💡 Pasiūlymų kanalas nustatytas: <#'+channel.id+'>',flags:MessageFlags.Ephemeral});return;
    }
    if(cmd==='giveaway-reroll'){
      if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){await interaction.reply({content:'Reikia Manage Server teisės.',flags:MessageFlags.Ephemeral});return;}
      const messageId=interaction.options.getString('message_id',true).trim();
      if(!/^\d{17,20}$/.test(messageId)){await interaction.reply({content:'Neteisingas giveaway žinutės ID.',flags:MessageFlags.Ephemeral});return;}
      const giveaway=await db.giveaway.findFirst({where:{guildId:id,messageId}});
      if(!giveaway){await interaction.reply({content:'Giveaway nerastas.',flags:MessageFlags.Ephemeral});return;}
      if(!giveaway.ended){await interaction.reply({content:'Reroll galimas tik pasibaigus giveaway.',flags:MessageFlags.Ephemeral});return;}
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const entries=await db.giveawayEntry.findMany({where:{giveawayId:giveaway.id},select:{userId:true}});
      const pool=entries.map(e=>e.userId);
      if(!pool.length){await interaction.editReply('Giveaway neturi dalyvių.');return;}
      const winners:string[]=[];
      const requested=Math.min(interaction.options.getInteger('winners')??giveaway.winnerCount,pool.length);
      while(winners.length<requested){winners.push(pool.splice(randomInt(pool.length),1)[0]);}
      const channel=await guild.channels.fetch(giveaway.channelId).catch(()=>null);
      if(!channel?.isTextBased()||!('send' in channel)){await interaction.editReply('Giveaway kanalas neprieinamas.');return;}
      const message=await channel.send({content:'🎉 **Giveaway reroll** • '+giveaway.prize+'\nNauji laimėtojai: '+winners.map(userId=>'<@'+userId+'>').join(', '),allowedMentions:{users:winners}});
      await audit(id,'GIVEAWAY_REROLL',interaction.user.id,giveaway.id+' '+winners.join(','));
      await interaction.editReply('Nauji laimėtojai paskelbti: '+message.url);return;
    }
    if(cmd==='suggestion-status'){
      if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){await interaction.reply({content:'Reikia Manage Server teisės.',flags:MessageFlags.Ephemeral});return;}
      const messageId=interaction.options.getString('message_id',true).trim();
      const status=interaction.options.getString('status',true);
      const note=interaction.options.getString('note')?.trim();
      if(!/^\d{17,20}$/.test(messageId)){await interaction.reply({content:'Netinkamas žinutės ID.',flags:MessageFlags.Ephemeral});return;}
      const cfg=await db.guildConfig.findUnique({where:{guildId:id}});
      if(!cfg?.suggestionChannelId){await interaction.reply({content:'Nustatyk pasiūlymų kanalą su /suggestion-config.',flags:MessageFlags.Ephemeral});return;}
      const channel=await guild.channels.fetch(cfg.suggestionChannelId).catch(()=>null);
      if(!channel||channel.type!==ChannelType.GuildText){await interaction.reply({content:'Pasiūlymų kanalas neprieinamas.',flags:MessageFlags.Ephemeral});return;}
      const post=await channel.messages.fetch(messageId).catch(()=>null);
      const v2Suggestion=post?.flags.has(MessageFlags.IsComponentsV2)?post.components.find(c=>c.type===17):null;
      const v2Data=v2Suggestion?.toJSON() as unknown as {type:17;accent_color?:number;components?:Array<{type:number;content?:string}>}|undefined;
      const isOurSuggestion=await db.auditEvent.findFirst({where:{guildId:id,event:'SUGGESTION',detail:messageId},select:{id:true}});
      const v2Valid=Boolean(isOurSuggestion&&v2Data?.components?.some(c=>c.type===10&&c.content?.includes('**Autorius:**')));
      if(!post||post.author.id!==client.user?.id||(!v2Valid&&(!post.embeds[0]||!post.embeds[0].title?.startsWith('💡')))){await interaction.reply({content:'Nerastas šio boto pasiūlymas nurodytame kanale.',flags:MessageFlags.Ephemeral});return;}
      const labels:Record<string,string>={pending:'⏳ Pending',accepted:'✅ Accepted',in_progress:'🔧 In Progress',implemented:'🚀 Implemented',denied:'❌ Denied'};
      const colors:Record<string,number>={pending:0x8066f2,accepted:0x57f287,in_progress:0xfee75c,implemented:0x2ecc71,denied:0xed4245};
      if(v2Data?.components&&v2Valid){
        const updated=v2Data.components.map(child=>{
          if(child.type!==10||!child.content?.startsWith('**Būsena:**'))return child;
          return {...child,content:'**Būsena:** '+(labels[status]??status)+(note?'\n**Staff komentaras:** '+note.slice(0,500):'')};
        });
        await post.edit({components:[{type:17,accent_color:colors[status]??0x8066f2,components:updated} as unknown as ContainerBuilder],allowedMentions:{parse:[]}});
      }else{
        const embed=EmbedBuilder.from(post.embeds[0]).setColor(colors[status]??0x8066f2).setFooter({text:'Status: '+(labels[status]??status)+' • 👍 Pritariu • 👎 Nepritariu'});
        const fields=(post.embeds[0].fields??[]).filter(f=>!['Būsena','Staff komentaras'].includes(f.name));
        embed.setFields(...fields,{name:'Būsena',value:labels[status]??status},...(note?[{name:'Staff komentaras',value:note}]:[]));
        await post.edit({embeds:[embed],allowedMentions:{parse:[]}});
      }
      await audit(id,'SUGGESTION_STATUS',interaction.user.id,messageId+' → '+status);
      await interaction.reply({content:'Pasiūlymo būsena atnaujinta: '+(labels[status]??status)+'\n'+post.url,flags:MessageFlags.Ephemeral});return;
    }
    if(cmd==='suggestion'){
      const cfg=await db.guildConfig.findUnique({where:{guildId:id}});
      if(!cfg?.suggestionChannelId){await interaction.reply({content:'Administratorius turi nustatyti kanalą per /suggestion-config.',flags:MessageFlags.Ephemeral});return;}
      const idea=interaction.options.getString('idea',true).trim();
      const reason=interaction.options.getString('reason')?.trim();
      const attachment=interaction.options.getAttachment('image');
      if(attachment&&(!attachment.contentType?.startsWith('image/')||attachment.size>8_000_000)){await interaction.reply({content:'Pridėk paveikslėlį iki 8 MB (PNG, JPG, GIF ir kt.).',flags:MessageFlags.Ephemeral});return;}
      const channel=await guild.channels.fetch(cfg.suggestionChannelId).catch(()=>null);
      if(!channel||channel.type!==ChannelType.GuildText){await interaction.reply({content:'Pasiūlymų kanalas nerastas arba neprieinamas.',flags:MessageFlags.Ephemeral});return;}
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const settingRecord=await db.auditEvent.findFirst({where:{guildId:id,event:'SUGGESTION_SETTINGS'},orderBy:{createdAt:'desc'},select:{detail:true}});
      let settings:Record<string,string>={};
      try{if(settingRecord?.detail)settings=JSON.parse(settingRecord.detail) as Record<string,string>;}catch{}
      const heading=(settings.title||'Naujas pasiūlymas').slice(0,90);
      const pending=(settings.pendingLabel||'⏳ Pending').slice(0,80);
      const proposalContent='**💡 '+heading+'**\n\n'+idea+'\n\n**Autorius:** <@'+interaction.user.id+'>'+(reason?'\n\n**Kodėl?**\n'+reason:'');
      if(proposalContent.length>3900){await interaction.editReply('Pasiūlymas per ilgas V2 panelei.');return;}
      const emojiValue=(value:string)=>{const match=/^<(a?):([a-zA-Z0-9_]+):(\d{17,20})>$/.exec(value);return match?{id:match[3],name:match[2],animated:match[1]==='a'}:{name:value};};
      const upEmoji=settings.upEmoji||'👍',downEmoji=settings.downEmoji||'👎';
      const upLabel=(settings.upLabel||'Pritariu').slice(0,45),downLabel=(settings.downLabel||'Nepritariu').slice(0,45);
      const color=settings.color&&/^#[0-9a-fA-F]{6}$/.test(settings.color)?parseInt(settings.color.slice(1),16):0x8066f2;
      const proposalChildren:Record<string,unknown>[]=[{type:10,content:proposalContent}];
      if(attachment)proposalChildren.push({type:12,items:[{media:{url:attachment.url}}]});
      proposalChildren.push({type:10,content:'**Būsena:** '+pending});
      proposalChildren.push({type:1,components:[
        {type:2,style:3,custom_id:'lx_suggest:up',label:upLabel+' · 0',emoji:emojiValue(upEmoji)},
        {type:2,style:4,custom_id:'lx_suggest:down',label:downLabel+' · 0',emoji:emojiValue(downEmoji)}
      ]});
      const posted=await channel.send({flags:MessageFlags.IsComponentsV2,components:[{type:17,accent_color:color,components:proposalChildren} as unknown as ContainerBuilder],allowedMentions:{parse:[]}});
      await db.auditEvent.create({data:{guildId:id,event:'SUGGESTION',actorId:interaction.user.id,detail:posted.id}});
      await interaction.editReply('💡 Pasiūlymas paskelbtas: '+posted.url);
      return;
    }
    if(cmd==='ping'){await interaction.reply({content:'Pong! Bot is online.',flags:MessageFlags.Ephemeral});return;}
    if(cmd==='setup'){
      const logChannelId=interaction.options.getChannel('log_channel')?.id??null;
      const announcementChannelId=interaction.options.getChannel('announcement_channel')?.id??null;
      await db.guildConfig.upsert({where:{guildId:id},create:{guildId:id,logChannelId,announcementChannelId},update:{...(logChannelId?{logChannelId}:{}),...(announcementChannelId?{announcementChannelId}:{})}});
      await interaction.reply({content:'Server settings saved.',flags:MessageFlags.Ephemeral});await audit(id,'SETUP',interaction.user.id);return;
    }
    if(cmd==='security'){
      if(sub==='status'){
        const cfg=await db.guildConfig.findUnique({where:{guildId:id}});
        await interaction.reply({content:`Lockdown: ${cfg?.lockdown?'ON':'OFF'}; raid threshold: ${cfg?.joinThreshold??8} joins/min`,flags:MessageFlags.Ephemeral});return;
      }
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      await lockdown(id,sub==='lockdown',interaction.user.id);
      await interaction.editReply('Security status updated.');return;
    }
    if(cmd==='mod'){
      if(!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)){
        await interaction.reply({content:'Moderate Members permission required.',flags:MessageFlags.Ephemeral});return;
      }
      const user=interaction.options.getUser('user',true);
      const member=await guild.members.fetch(user.id).catch(()=>null);
      if(!member || user.id===interaction.user.id || member.roles.highest.position>= (await guild.members.fetch(interaction.user.id)).roles.highest.position && guild.ownerId!==interaction.user.id){
        await interaction.reply({content:'You cannot moderate that member.',flags:MessageFlags.Ephemeral});return;
      }
      const reason=interaction.options.getString('reason')??'No reason provided';
      if(sub==='timeout'){
        if(!member.moderatable){await interaction.reply({content:'Bot cannot timeout that member.',flags:MessageFlags.Ephemeral});return;}
        await member.timeout(interaction.options.getInteger('minutes',true)*60_000,reason);
      }
      await db.moderationCase.create({data:{guildId:id,targetId:user.id,actorId:interaction.user.id,action:sub??'unknown',reason}});
      await interaction.reply({content:`${sub} saved for ${user.username}.`,flags:MessageFlags.Ephemeral});
      await audit(id,'MOD_'+sub,interaction.user.id,`Member ${user.id}: ${reason}`);return;
    }
    if(cmd==='announce'){
      const cfg=await db.guildConfig.findUnique({where:{guildId:id}});
      if(!cfg?.announcementChannelId){await interaction.reply({content:'Set an announcement channel with /setup.',flags:MessageFlags.Ephemeral});return;}
      const ch=await guild.channels.fetch(cfg.announcementChannelId);
      if(!ch || !ch.isTextBased() || !('send' in ch)){await interaction.reply({content:'Announcement channel unavailable.',flags:MessageFlags.Ephemeral});return;}
      const pingEveryone=interaction.options.getBoolean('everyone')??false;
      const pingRole=interaction.options.getRole('role');
      if((pingEveryone||pingRole)&&!interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone)){await interaction.reply({content:'Norint žymėti @everyone arba roles reikia Mention Everyone teisės.',flags:MessageFlags.Ephemeral});return;}
      const pingText=[pingEveryone?'@everyone':null,pingRole?'<@&'+pingRole.id+'>':null].filter(Boolean).join(' ');
      const announceText=[pingText,'**'+interaction.options.getString('title',true)+'**',interaction.options.getString('body',true)].filter(Boolean).join('\n\n');
      const announcePanel=new ContainerBuilder().setAccentColor(0x5865f2).addTextDisplayComponents(new TextDisplayBuilder().setContent(announceText.slice(0,4000)));
      await ch.send({flags:MessageFlags.IsComponentsV2,components:[announcePanel],allowedMentions:{parse:pingEveryone?['everyone']:[],roles:pingRole?[pingRole.id]:[]}});

      await interaction.reply({content:'Announcement posted (no DMs sent).',flags:MessageFlags.Ephemeral});
      await audit(id,'ANNOUNCE',interaction.user.id);return;
    }
    if(cmd==='updates'){
      const enabled=sub==='subscribe';
      await db.subscription.upsert({where:{guildId_userId:{guildId:id,userId:interaction.user.id}},create:{guildId:id,userId:interaction.user.id,enabled},update:{enabled}});
      await interaction.reply({content:enabled?'Subscribed to future opt-in notifications.':'Unsubscribed from notification DMs.',flags:MessageFlags.Ephemeral});return;
    }
    if(cmd==='rank'){
      const xp=await db.xp.findUnique({where:{guildId_userId:{guildId:id,userId:interaction.user.id}}});
      await interaction.reply({content:`Your XP: ${xp?.points??0}`,flags:MessageFlags.Ephemeral});return;
    }
  }catch(e){
    log.error(e,'Interaction failed');
    if(interaction.deferred||interaction.replied)await interaction.editReply('An error occurred. Check permissions and logs.').catch(()=>{});
    else await interaction.reply({content:'An error occurred. Check permissions and logs.',flags:MessageFlags.Ephemeral}).catch(()=>{});
  }
});

client.on(Events.InteractionCreate,async interaction=>{
 if(!interaction.isModalSubmit()||interaction.customId!=='dg_staff_application'||!interaction.inGuild())return;
 try{
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  const guildId=interaction.guildId;
  const last=await db.auditEvent.findFirst({where:{guildId,event:'STAFF_APPLICATION',actorId:interaction.user.id},orderBy:{createdAt:'desc'}});
  if(last&&Date.now()-last.createdAt.getTime()<7*24*60*60_000){await interaction.editReply('Paraišką jau pateikei per pastarąsias 7 dienas.');return;}
  const motivation=interaction.fields.getTextInputValue('motivation');
  const experience=interaction.fields.getTextInputValue('experience');
  const availability=interaction.fields.getTextInputValue('availability');
  const cfg=await db.guildConfig.findUnique({where:{guildId}});
  if(!cfg?.logChannelId){await interaction.editReply('Staff paraiškoms administratorius turi nustatyti log kanalą per /setup.');return;}
  const channel=await interaction.guild!.channels.fetch(cfg.logChannelId).catch(()=>null);
  if(!channel?.isTextBased()||!('send' in channel)){await interaction.editReply('Staff paraiškų kanalas neprieinamas.');return;}
  const staffText=['**📋 Nauja staff paraiška**','**Kandidatas:** <@'+interaction.user.id+'>','**Motyvacija:**\n'+motivation.slice(0,1024),'**Patirtis:**\n'+experience.slice(0,1024),'**Prieinamumas:**\n'+availability.slice(0,1024)].join('\n\n');
  const staffPanel=new ContainerBuilder().setAccentColor(0x5865f2);
  // The two text blocks stay under Discord's 4000-character Text Display limit.
  staffPanel.addTextDisplayComponents(new TextDisplayBuilder().setContent(staffText.slice(0,4000)));
  const sent=await channel.send({flags:MessageFlags.IsComponentsV2,components:[staffPanel],allowedMentions:{parse:[]}});
  await db.auditEvent.create({data:{guildId,event:'STAFF_APPLICATION',actorId:interaction.user.id,detail:sent.id}});
  await interaction.editReply('✅ Paraiška pateikta staff komandai. Ačiū!');
 }catch(e){log.error(e,'Staff application failed');if(interaction.deferred)await interaction.editReply('Nepavyko pateikti paraiškos.').catch(()=>{});}
});
client.on(Events.InteractionCreate,async interaction=>{
 if((!interaction.isButton()&&!interaction.isStringSelectMenu()&&!interaction.isModalSubmit())||!interaction.inGuild())return;
 if(!['dg_verify','dg_ticket_open','dg_ticket_close','dg_ticket_select','dg_ticket_claim','dg_ticket_cancel','dg_ticket_confirm','dg_ticket_close_confirm','dg_ticket_close_cancel'].includes(interaction.customId)&&!interaction.customId.startsWith('dg_ticket_form:')&&!interaction.customId.startsWith('dg_ticket_confirm:'))return;
 try{
  const guild=interaction.guild!,guildId=guild.id,userId=interaction.user.id;
  const cfg=await db.communityPanel.findUnique({where:{guildId}});
  if(!cfg){await interaction.reply({content:'Sistema dar nesukonfigūruota.',flags:MessageFlags.Ephemeral});return;}
  if(interaction.customId==='dg_verify'){
   if(!cfg.verifiedRoleId){await interaction.reply({content:'Verify rolė nenustatyta.',flags:MessageFlags.Ephemeral});return;}
   const role=await guild.roles.fetch(cfg.verifiedRoleId);
   if(!role||role.managed||[PermissionFlagsBits.Administrator,PermissionFlagsBits.ManageGuild,PermissionFlagsBits.ManageRoles,PermissionFlagsBits.BanMembers,PermissionFlagsBits.KickMembers].some(p=>role.permissions.has(p))){await interaction.reply({content:'Verify rolė netinkama.',flags:MessageFlags.Ephemeral});return;}
   const member=await guild.members.fetch(userId);
   await member.roles.add(cfg.verifiedRoleId,'DevGuard verification');
   await interaction.reply({content:'Patvirtinta! Rolė suteikta.',flags:MessageFlags.Ephemeral});
   await audit(guildId,'VERIFY',userId);
   return;
  }
  if(interaction.customId==='dg_ticket_cancel'&&interaction.isButton()){await interaction.update({content:'❌ Ticket kūrimas atšauktas.',components:[]});return;}
  if(interaction.customId==='dg_ticket_close_cancel'&&interaction.isButton()){await interaction.update({content:'Ticketas paliktas atidarytas.',components:[]});return;}
  // Open the question modal directly after a category selection; no intermediate confirmation.
  // Keep legacy confirmation clicks functional for already-sent ephemeral messages.
  if(interaction.customId==='dg_ticket_open'||interaction.customId==='dg_ticket_select'||interaction.customId.startsWith('dg_ticket_confirm:')){
   if(!interaction.isButton()&&!interaction.isStringSelectMenu())return;
   const ticketType=interaction.isStringSelectMenu()?interaction.values[0]:
    interaction.customId.startsWith('dg_ticket_confirm:')?decodeURIComponent(interaction.customId.slice('dg_ticket_confirm:'.length)):'General';
   if(!ticketType.trim()||ticketType.length>70){await interaction.reply({content:'Netinkamas ticket pasirinkimas.',flags:MessageFlags.Ephemeral});return;}
   const existing=await db.supportTicket.findFirst({where:{guildId,userId,status:'open'}});
   if(existing){await interaction.reply({content:'Jau turi atidarytą ticketą: <#'+existing.channelId+'>',flags:MessageFlags.Ephemeral});return;}
   type TicketQuestion={label:string;style:'short'|'paragraph';required:boolean};
   let options:{label:string;questions?:TicketQuestion[]}[]=[];
   try{options=JSON.parse(cfg.ticketOptionsJson??'[]');}catch{}
   const option=options.find(o=>o.label===ticketType);
   const questions=option?.questions?.length?option.questions:[{label:'Priežastis / Reason',style:'short' as const,required:true},{label:'Aprašyk problemą / Details',style:'paragraph' as const,required:true}];
   const modal=new ModalBuilder().setCustomId('dg_ticket_form:'+encodeURIComponent(ticketType)).setTitle(('Lextrum • '+ticketType).slice(0,45));
   questions.slice(0,5).forEach((q,i)=>modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('q'+i).setLabel(q.label.slice(0,45)).setStyle(q.style==='paragraph'?TextInputStyle.Paragraph:TextInputStyle.Short).setRequired(q.required).setMaxLength(q.style==='paragraph'?1500:200))));
   await interaction.showModal(modal);return;
  }
  if(interaction.customId==='dg_ticket_close_confirm'){
   if(!interaction.isButton())return;
   const ticket=await db.supportTicket.findUnique({where:{channelId:interaction.channelId??''}});
   if(!ticket||ticket.status!=='open')return;
   const member=await guild.members.fetch(userId);
   if(ticket.userId!==userId&&!member.permissions.has(PermissionFlagsBits.ManageChannels)&&(!cfg.supportRoleId||!member.roles.cache.has(cfg.supportRoleId))){await interaction.reply({content:'Neturi teisės uždaryti.',flags:MessageFlags.Ephemeral});return;}
   // Continue into the existing close handler below.
  }
  if(interaction.customId.startsWith('dg_ticket_form:')){
   if(!interaction.isModalSubmit())return;
   const ticketType=decodeURIComponent(interaction.customId.slice('dg_ticket_form:'.length));
   if(!ticketType||ticketType.length>70){await interaction.reply({content:'Netinkama kategorija',flags:MessageFlags.Ephemeral});return;}
   let options:{label:string;questions?:{label:string;style:string;required:boolean}[]}[]=[];
   try{options=JSON.parse(cfg.ticketOptionsJson??'[]');}catch{}
   const questions=options.find(o=>o.label===ticketType)?.questions;
   const fields=(questions?.length?questions:[{label:'Priežastis / Reason',style:'short',required:true},{label:'Aprašyk problemą / Details',style:'paragraph',required:true}]).slice(0,5);
   const answers=fields.map((q,i)=>({name:q.label,value:interaction.fields.getTextInputValue('q'+i)||'—'}));
   const subject=answers[0]?.value??ticketType;
   const details=answers.map(a=>'**'+a.name+'**\n'+a.value).join('\n\n').slice(0,3900);
   if(!cfg.ticketCategoryId){await interaction.reply({content:'Ticket kategorija nenustatyta.',flags:MessageFlags.Ephemeral});return;}
   await interaction.deferReply({flags:MessageFlags.Ephemeral});
   const existing=await db.supportTicket.findFirst({where:{guildId,userId,status:'open'}});
   if(existing){const old=await guild.channels.fetch(existing.channelId).catch(()=>null);if(old){await interaction.editReply('Jau turi atidarytą ticketą: <#'+existing.channelId+'>');return;}await db.supportTicket.update({where:{id:existing.id},data:{status:'closed',closedAt:new Date()}});}
   const me=await guild.members.fetchMe();
   if(!me.permissions.has(PermissionFlagsBits.ManageChannels)){await interaction.editReply('Botui trūksta Manage Channels leidimo.');return;}
   const overwrites=[
    {id:guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel]},
    {id:userId,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]},
    {id:me.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ManageChannels]}
   ];
   if(cfg.supportRoleId)overwrites.push({id:cfg.supportRoleId,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]});
   const channel=await guild.channels.create({name:(ticketType?ticketType.toLowerCase().normalize('NFKD').replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,32)+'-':'ticket-')+userId.slice(-6),type:ChannelType.GuildText,parent:cfg.ticketCategoryId??undefined,permissionOverwrites:overwrites,reason:'DevGuard support ticket'});
   try{await db.supportTicket.create({data:{guildId,userId,channelId:channel.id}});}catch(e){await channel.delete().catch(()=>{});throw e;}
   const row=new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('dg_ticket_claim').setLabel('Priimti / Claim').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('dg_ticket_close').setLabel('Uždaryti / Close').setStyle(ButtonStyle.Danger));
   const ticketContainer=new ContainerBuilder().setAccentColor(0x8066f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('🎫 **'+ticketType.replace(/[*_~`\\]/g,'')+'** • <@'+userId+'> '+(cfg.supportRoleId?'<@&'+cfg.supportRoleId+'>':'')))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**'+subject.replace(/\\*/g,'')+'**\\n\\n'+details.slice(0,3600)))
    .addActionRowComponents(row);
   await channel.send({flags:MessageFlags.IsComponentsV2,components:[ticketContainer],allowedMentions:{users:[userId],roles:cfg.supportRoleId?[cfg.supportRoleId]:[]}});
   await interaction.editReply('Ticketas sukurtas: <#'+channel.id+'>');
   await audit(guildId,'TICKET_OPEN',userId,(ticketType?ticketType+' • ':'')+channel.id);
   return;
  }
  const ticket=interaction.channelId ? await db.supportTicket.findUnique({where:{channelId:interaction.channelId}}) : null;
  if(!ticket||ticket.status!=='open'){await interaction.reply({content:'Ticketas nerastas arba uždarytas.',flags:MessageFlags.Ephemeral});return;}
  const member=await guild.members.fetch(userId);
  if(ticket.userId!==userId&&!member.permissions.has(PermissionFlagsBits.ManageChannels)&&(!cfg.supportRoleId||!member.roles.cache.has(cfg.supportRoleId))){await interaction.reply({content:'Neturi teisės uždaryti šio ticketo.',flags:MessageFlags.Ephemeral});return;}
  if(interaction.customId==='dg_ticket_claim'){
   if(!member.permissions.has(PermissionFlagsBits.ManageChannels)&&(!cfg.supportRoleId||!member.roles.cache.has(cfg.supportRoleId))){await interaction.reply({content:'Tik support komanda gali priskirti ticketą.',flags:MessageFlags.Ephemeral});return;}
   const ch=interaction.channel;
   if(!ch||ch.type!==ChannelType.GuildText){await interaction.reply({content:'Neteisingas kanalas',flags:MessageFlags.Ephemeral});return;}
   if(ch.topic?.startsWith('Claimed by ')){await interaction.reply({content:ch.topic,flags:MessageFlags.Ephemeral});return;}
   await ch.setTopic('Claimed by '+interaction.user.username+' ('+userId+')');
   await interaction.reply({content:'Ticketas priskirtas tau.',flags:MessageFlags.Ephemeral});
   await ch.send({content:'🛠️ Ticketą perėmė <@'+userId+'>',allowedMentions:{users:[userId]}});
   await audit(guildId,'TICKET_CLAIM',userId,ch.id);return;
  }
  if(interaction.customId==='dg_ticket_close'){
   const row=new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('dg_ticket_close_confirm').setLabel('Taip, uždaryti').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId('dg_ticket_close_cancel').setLabel('Atšaukti').setStyle(ButtonStyle.Secondary));
   await interaction.reply({content:'Ar tikrai nori uždaryti šį ticketą?',components:[row],flags:MessageFlags.Ephemeral});return;
  }
  await interaction.deferUpdate();
  const ch=interaction.channel;
  if(!ch||!ch.isTextBased()||!('messages' in ch)){await interaction.followUp({content:'Ticket kanalas nepasiekiamas.',flags:MessageFlags.Ephemeral});return;}
  // Persist transcript before deleting the channel. Include attachments and paginate history.
  const lines:string[]=[];
  let before:string|undefined;
  for(let page=0;page<50;page++){
   const batch=await ch.messages.fetch({limit:100,...(before?{before}:{})});
   if(!batch.size)break;
   for(const msg of batch.values()){
    const content=msg.content||'[embed / attachment / interaction]';
    lines.push(new Date(msg.createdTimestamp).toISOString()+' '+msg.author.tag+' ('+msg.author.id+'): '+content+' '+msg.attachments.map(a=>a.url).join(' '));
   }
   before=batch.last()?.id;
   if(batch.size<100)break;
  }
  const transcript=lines.reverse().join('\n').slice(0,7_000_000)||'No messages.';
  const claimedBy=/^Claimed by .*\((\d+)\)$/.exec(ch.type===ChannelType.GuildText?(ch.topic??''):'')?.[1]??null;
  const updated=await db.supportTicket.updateMany({where:{id:ticket.id,status:'open'},data:{status:'closed',closedAt:new Date(),closedById:userId,claimedById:claimedBy,transcriptText:transcript}});
  if(!updated.count){await interaction.followUp({content:'Ticketas jau uždarytas.',flags:MessageFlags.Ephemeral});return;}
  const file=new AttachmentBuilder(Buffer.from(transcript,'utf8'),{name:'ticket-'+ticket.id+'.txt'});
  {
   const logs=await transcriptDestination(guildId);
   if(logs)await logs.send({content:'📄 Ticket **'+(ch.type===ChannelType.GuildText?ch.name:'Support ticket')+'** uždarytas • <@'+ticket.userId+'> • uždarė <@'+userId+'>',files:[file],allowedMentions:{parse:[]}}).catch(e=>log.error(e,'Transcript channel delivery failed'));
  }
  await audit(guildId,'TICKET_CLOSE',userId,ticket.channelId).catch(e=>log.warn(e,'Ticket audit failed'));
  try{
   const owner=await client.users.fetch(ticket.userId);
   const row=new ActionRowBuilder<ButtonBuilder>().addComponents([1,2,3,4,5].map(n=>new ButtonBuilder().setCustomId('dg_feedback:'+ticket.id+':'+n).setLabel(n+' ⭐').setStyle(n>=4?ButtonStyle.Success:ButtonStyle.Secondary)));
   await owner.send({content:'🎫 Tavo ticketas **'+(ch.type===ChannelType.GuildText?ch.name:'Support ticket')+'** uždarytas. Įvertink pagalbą nuo 1 iki 5 žvaigždučių. Atsakymas bus perduotas support komandai.',components:[row]});
  }catch(e){log.warn({ticketId:ticket.id,error:e},'Could not DM ticket feedback request');}
  await interaction.channel?.delete().catch(e=>log.error(e,'Ticket channel delete failed'));

 }catch(e){log.error(e,'Community panel interaction failed');if(interaction.deferred||interaction.replied)await interaction.editReply('Įvyko klaida. Patikrink boto leidimus.').catch(()=>{});else await interaction.reply({content:'Įvyko klaida. Patikrink boto leidimus.',flags:MessageFlags.Ephemeral}).catch(()=>{});}
});


async function transcriptDestination(guildId:string){
 const guild=await client.guilds.fetch(guildId).catch(()=>null);
 if(!guild)return null;
 const channels=await guild.channels.fetch().catch(()=>null);
 const target=channels?.find(c=>{
  if(c?.type!==ChannelType.GuildText)return false;
  const name=c.name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
  return name.includes('transcript')||name.includes('stenogram');
 });
 if(target?.type===ChannelType.GuildText)return target;
 log.warn({guildId},'Transcript channel not found; transcript remains saved in database');
 return null;
}

async function feedbackDestination(guildId:string,configured:string|null|undefined){
 const guild=await client.guilds.fetch(guildId).catch(()=>null);
 if(!guild){log.warn({guildId},'Feedback guild unavailable');return null;}
 if(configured){
  const selected=await guild.channels.fetch(configured).catch(()=>null);
  if(selected?.type===ChannelType.GuildText)return selected;
  log.warn({guildId,configured},'Configured feedback channel missing or not text');
 }
 const channels=await guild.channels.fetch().catch(()=>null);
 const feedback=channels?.find(c=>{
  if(c?.type!==ChannelType.GuildText)return false;
  const normalized=c.name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
  return normalized.includes('feedback')||normalized.includes('atsiliepim')||normalized.includes('ivertinim');
 });
 if(feedback?.type===ChannelType.GuildText)return feedback;
 log.warn({guildId,configured,channels:channels?.map(c=>c?.name).filter(Boolean)},'No feedback channel found');
 return null;
}

client.on(Events.InteractionCreate,async interaction=>{
 if(!interaction.isButton()||!interaction.customId.startsWith('dg_feedback:'))return;
 try{
  const match=/^dg_feedback:([^:]+):([1-5])$/.exec(interaction.customId);
  if(!match){await interaction.reply({content:'Netinkamas įvertinimas.',flags:MessageFlags.Ephemeral});return;}
  const [,ticketId,ratingText]=match;
  const ticket=await db.supportTicket.findUnique({where:{id:ticketId}});
  if(!ticket||ticket.userId!==interaction.user.id||ticket.status!=='closed'){await interaction.reply({content:'Šio ticketo vertinti negali.',flags:MessageFlags.Ephemeral});return;}
  const rating=Number(ratingText);
  const changed=await db.supportTicket.updateMany({where:{id:ticketId,feedbackRating:null,status:'closed'},data:{feedbackRating:rating,feedbackAt:new Date()}});
  if(!changed.count){await interaction.reply({content:'Šis ticketas jau įvertintas.',flags:MessageFlags.Ephemeral});return;}
  const cfg=await db.communityPanel.findUnique({where:{guildId:ticket.guildId}});
  const channel=await feedbackDestination(ticket.guildId,cfg?.feedbackChannelId);
  let delivered=false;
  if(channel){
   try{
    const reviewer=await client.users.fetch(ticket.userId).catch(()=>null);
    const staff=ticket.claimedById?await client.users.fetch(ticket.claimedById).catch(()=>null):null;
    const staffRatings=ticket.claimedById?await db.supportTicket.findMany({where:{guildId:ticket.guildId,claimedById:ticket.claimedById,feedbackRating:{not:null}},select:{feedbackRating:true}}):[];
    const count=staffRatings.length;
    const average=count?staffRatings.reduce((sum,item)=>sum+(item.feedbackRating??0),0)/count:rating;
    const ticketName='ticket-'+ticket.channelId.slice(-6);
    const card=await reviewCard({name:reviewer?.displayName??reviewer?.username??'Narys',staffName:staff?.displayName??staff?.username??'Support Team',rating,avatarUrl:reviewer?.displayAvatarURL({extension:'png',size:128}),count:count||1,average,ticketName});
    await channel.send({content:'',files:[new AttachmentBuilder(card,{name:'staff-review.png'})],allowedMentions:{parse:[]}});
    delivered=true;
   }catch(e){log.error({error:e,channelId:channel.id,ticketId},'Feedback log delivery failed');}
  }
  await interaction.update({content:delivered?'Ačiū! Įvertinai pagalbą '+rating+'/5 ⭐. Įvertinimas nusiųstas support komandai.':'Įvertinimas '+rating+'/5 ⭐ išsaugotas, bet jo nepavyko išsiųsti į feedback kanalą. Pranešk administratoriui, kad patikrintų kanalo nustatymus ir boto leidimus.',components:[]});
 }catch(e){log.error(e,'Ticket feedback failed');if(!interaction.replied&&!interaction.deferred)await interaction.reply({content:'Nepavyko išsaugoti įvertinimo.',flags:MessageFlags.Ephemeral}).catch(()=>{});}
});


client.on(Events.InteractionCreate,async interaction=>{
 if(!interaction.isButton()||!interaction.inGuild()||!interaction.customId.startsWith('dg_giveaway:'))return;
 try{
  const id=interaction.customId.slice('dg_giveaway:'.length);
  const giveaway=await db.giveaway.findUnique({where:{id}});
  if(!giveaway||giveaway.guildId!==interaction.guildId||giveaway.ended||giveaway.endsAt<=new Date()){await interaction.reply({content:'Šis giveaway jau baigėsi.',flags:MessageFlags.Ephemeral});return;}
  const key={giveawayId_userId:{giveawayId:id,userId:interaction.user.id}};
  const existing=await db.giveawayEntry.findUnique({where:key});
  if(existing){await db.giveawayEntry.delete({where:key});await interaction.reply({content:'Dalyvavimas atšauktas.',flags:MessageFlags.Ephemeral});}
  else{await db.giveawayEntry.create({data:{giveawayId:id,userId:interaction.user.id}});await interaction.reply({content:'Dalyvauji giveaway! 🎉',flags:MessageFlags.Ephemeral});}
  try{
   const count=await db.giveawayEntry.count({where:{giveawayId:id}});
   const channel=await client.channels.fetch(giveaway.channelId);
   if(channel?.isTextBased()&&'messages' in channel){
    const message=await channel.messages.fetch(giveaway.messageId);
    const row=new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('dg_giveaway:'+id).setLabel('🎉 Dalyvauti • '+count).setStyle(ButtonStyle.Primary));
    if(message.flags.has(MessageFlags.IsComponentsV2)){
      const container=message.components.find(component=>component.type===17);
      if(container){
        const data=container.toJSON() as unknown as {type:number;accent_color?:number;components?:Array<Record<string,unknown>>};
        const children=(data.components??[]).map(child=>{
          if(child.type!==1)return child;
          const buttons=(child.components as Array<{type:number;custom_id?:string}>|undefined)??[];
          return buttons.some(button=>button.custom_id==='dg_giveaway:'+id)
            ? {type:1,components:[row.components[0].toJSON()]}:child;
        });
        await message.edit({components:[{type:17,accent_color:data.accent_color,components:children} as unknown as ContainerBuilder]});
      }
    }else await message.edit({components:[row]});
   }
  }catch(e){log.warn({error:e,giveawayId:id},'Could not refresh giveaway participant count');}
 }catch(e){log.error(e,'Giveaway button');if(!interaction.replied)await interaction.reply({content:'Nepavyko. Bandyk dar kartą.',flags:MessageFlags.Ephemeral}).catch(()=>{});}
});
async function finishGiveaways(){
 const due=await db.giveaway.findMany({where:{ended:false,endsAt:{lte:new Date()}},take:20});
 for(const g of due){
  const claimed=await db.giveaway.updateMany({where:{id:g.id,ended:false},data:{ended:true}});
  if(!claimed.count)continue;
  try{
   const entries=await db.giveawayEntry.findMany({where:{giveawayId:g.id}});
   const pool=entries.map(e=>e.userId);
   const winners:string[]=[];
   while(pool.length&&winners.length<g.winnerCount){const i=randomInt(pool.length);winners.push(pool.splice(i,1)[0]);}
   const ch=await client.channels.fetch(g.channelId);
   if(ch?.isTextBased()&&'send' in ch){
    const original=await ch.messages.fetch(g.messageId).catch(()=>null);
    if(original){
      if(original.flags.has(MessageFlags.IsComponentsV2)){
        const container=original.components.find(component=>component.type===17);
        if(container){
          const data=container.toJSON() as unknown as {type:number;accent_color?:number;components?:Array<Record<string,unknown>>};
          const children=(data.components??[]).filter(child=>{
            if(child.type!==1)return true;
            const buttons=(child.components as Array<{custom_id?:string}>|undefined)??[];
            return !buttons.some(button=>button.custom_id==='dg_giveaway:'+g.id);
          });
          children.push({type:10,content:'**🔒 Giveaway baigėsi**'});
          await original.edit({components:[{type:17,accent_color:data.accent_color,components:children} as unknown as ContainerBuilder]}).catch(e=>log.warn(e,'Failed to finish V2 giveaway panel'));
        }
      }else await original.edit({components:[]}).catch(()=>{});
    }
    await ch.send({content:winners.length?'🎉 Giveaway baigėsi! **'+g.prize+'**\nLaimėtojai: '+winners.map(id=>'<@'+id+'>').join(', '):'Giveaway baigėsi: **'+g.prize+'**. Dalyvių nebuvo.',allowedMentions:{users:winners}});
   }
   await audit(g.guildId,'GIVEAWAY_ENDED',undefined,g.prize);
  }catch(e){log.error(e,'Could not announce giveaway result');}
 }
}
// Ticket SLA: one durable reminder per unclaimed ticket; no database migration needed.
async function checkTicketSla(){
 const thresholdMinutes=Math.max(5,Math.min(1440,Number(process.env.TICKET_SLA_MINUTES)||15));
 const cutoff=new Date(Date.now()-thresholdMinutes*60_000);
 const pending=await db.supportTicket.findMany({where:{status:'open',claimedById:null,createdAt:{lte:cutoff}},take:50});
 for(const ticket of pending){
  const marker='SLA:'+ticket.id;
  const sent=await db.auditEvent.findFirst({where:{guildId:ticket.guildId,event:'TICKET_SLA_REMINDER',detail:marker}});
  if(sent)continue;
  const guild=client.guilds.cache.get(ticket.guildId);
  if(!guild)continue;
  const cfg=await db.communityPanel.findUnique({where:{guildId:ticket.guildId}});
  const ch=await guild.channels.fetch(ticket.channelId).catch(()=>null);
  if(!ch?.isTextBased()||!('send' in ch))continue;
  const role=cfg?.supportRoleId?'<@&'+cfg.supportRoleId+'>':'Support komanda';
  const delivered=await ch.send({content:'⏰ **Ticket SLA:** '+role+' — šis ticketas nepriimtas jau '+thresholdMinutes+' min. Paspauskite **Priimti / Claim**.',allowedMentions:{roles:cfg?.supportRoleId?[cfg.supportRoleId]:[]}}).then(()=>true).catch(e=>{log.warn({error:e,ticketId:ticket.id},'Ticket SLA delivery failed');return false;});
  if(delivered)await audit(ticket.guildId,'TICKET_SLA_REMINDER',undefined,marker);
 }
}
client.once(Events.ClientReady,()=>{setInterval(()=>checkTicketSla().catch(e=>log.error(e,'Ticket SLA scheduler')),5*60_000);checkTicketSla().catch(e=>log.error(e,'Ticket SLA initial check'));});
client.once(Events.ClientReady,()=>{setInterval(()=>finishGiveaways().catch(e=>log.error(e,'Giveaway scheduler')),30_000);finishGiveaways().catch(e=>log.error(e));});

// Suggestions Components V2 voting. Votes are stored in existing AuditEvent rows.
client.on(Events.InteractionCreate,async interaction=>{
 if(!interaction.isButton()||!interaction.inGuild()||!['lx_suggest:up','lx_suggest:down'].includes(interaction.customId))return;
 try{
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  const guildId=interaction.guildId,messageId=interaction.message.id;
  if(!interaction.message.flags.has(MessageFlags.IsComponentsV2)||interaction.message.author.id!==client.user?.id){
   await interaction.editReply('Netinkama pasiūlymo panelė.');return;
  }
  const existing=await db.auditEvent.findFirst({where:{guildId,event:'SUGGESTION',detail:messageId},select:{id:true}});
  if(!existing){await interaction.editReply('Šis pasiūlymas nebeaktyvus.');return;}
  const event='SUGGESTION_VOTE:'+messageId;
  const direction=interaction.customId.endsWith(':up')?'up':'down';
  const previous=await db.auditEvent.findFirst({where:{guildId,event,actorId:interaction.user.id},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{detail:true}});
  const vote=previous?.detail===direction?'none':direction;
  await db.auditEvent.create({data:{guildId,event,actorId:interaction.user.id,detail:vote}});
  const records=await db.auditEvent.findMany({where:{guildId,event},orderBy:[{createdAt:'asc'},{id:'asc'}],select:{actorId:true,detail:true}});
  const votes=new Map<string,string>();
  for(const record of records)if(record.actorId)votes.set(record.actorId,record.detail??'none');
  let up=0,down=0;
  for(const result of votes.values()){if(result==='up')up++;else if(result==='down')down++;}
  const message=await interaction.channel?.messages.fetch(messageId).catch(()=>null);
  if(message?.flags.has(MessageFlags.IsComponentsV2)){
   const container=message.components.find(c=>c.type===17);
   if(container){
    const raw=container.toJSON() as unknown as {type:number;accent_color?:number;components?:Array<Record<string,unknown>>};
    const updated=(raw.components??[]).map(child=>{
     if(child.type!==1)return child;
     const items=child.components as Array<Record<string,unknown>>|undefined;
     if(!items?.some(item=>typeof item.custom_id==='string'&&item.custom_id.startsWith('lx_suggest:')))return child;
     return {...child,components:items.map(item=>{
      if(item.custom_id!=='lx_suggest:up'&&item.custom_id!=='lx_suggest:down')return item;
      const count=item.custom_id==='lx_suggest:up'?up:down;
      const label=String(item.label??'Balsuoti').replace(/ · \d+$/,'').slice(0,65);
      return {...item,label:label+' · '+count};
     })};
    });
    await message.edit({components:[{type:17,accent_color:raw.accent_color,components:updated} as unknown as ContainerBuilder]});
   }
  }
  await interaction.editReply(vote==='none'?'Balsas atšauktas.':vote==='up'?'✅ Balsavai už pasiūlymą!':'✅ Balsavai prieš pasiūlymą!');
 }catch(error){
  log.error(error,'Suggestion V2 vote failed');
  if(interaction.deferred||interaction.replied)await interaction.editReply('Nepavyko užregistruoti balso.').catch(()=>{});
  else await interaction.reply({content:'Nepavyko užregistruoti balso.',flags:MessageFlags.Ephemeral}).catch(()=>{});
 }
});

// Orders: only the assigned Discord buyer can accept terms and receive a private file.
client.on(Events.InteractionCreate,async interaction=>{
 if(!interaction.isButton()||!interaction.inGuild()||(!interaction.customId.startsWith('lx_order_accept:')&&!interaction.customId.startsWith('lx_order_decline:')))return;
 const itemId=interaction.customId.slice(interaction.customId.indexOf(':')+1);
 if(!/^c[a-z0-9]{15,35}$/i.test(itemId)){await interaction.reply({content:'Neteisingas produkto identifikatorius.',flags:MessageFlags.Ephemeral});return;}
 if(interaction.customId.startsWith('lx_order_decline:')){
  await interaction.reply({content:'❌ Taisyklių nepriėmei. Failas nebuvo išsiųstas.',flags:MessageFlags.Ephemeral});return;
 }
 await interaction.deferReply({flags:MessageFlags.Ephemeral});
 try{
  const item=await db.digitalOrderItem.findUnique({where:{id:itemId},include:{order:true}});
  if(!item||item.order.guildId!==interaction.guildId||item.order.buyerId!==interaction.user.id){
   await interaction.editReply('Užsakymas nepriskirtas tavo Discord paskyrai.');return;
  }
  if(item.preparationStatus!=='ready'){await interaction.editReply('This order is not ready for delivery yet. Please try again later.');return;}
  if(!item.fileData||!item.fileName){
   await interaction.editReply('Failas dar neįkeltas. Kreipkis į administraciją.');return;
  }
  if(item.deliveredAt){
   await interaction.editReply('Ši prekė jau buvo išsiųsta. Jei failą pametei, kreipkis į administraciją.');return;
  }
  const claim=await db.digitalOrderItem.updateMany({where:{id:item.id,deliveryState:'pending',deliveredAt:null,preparationStatus:'ready'},data:{deliveryState:'sending'}});
  if(claim.count!==1){await interaction.editReply('Ši prekė jau siunčiama arba jau atsiimta.');return;}
  try{
   const dm=await interaction.user.createDM();
   // Safe ASCII attachment names prevent discord.js builder validation failures from spaces/special characters.
   const safeFileName=orderAttachmentName(item.fileName,item.id);
   const attachment=new AttachmentBuilder(Buffer.from(item.fileData),{name:safeFileName});
   const panel=new ContainerBuilder().setAccentColor(0x000000)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**📦 Lextrum Development · Order #'+item.order.orderNumber+'**'))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('✅ **Your product has been delivered!**\n\n**Product:** '+item.productName+'\n**Product number:** '+item.productNumber+'\n\n📎 **Your product file is below.** Use Discord’s file download control or the **Download File** button.\n\n🔐 **Reminder:** Sharing, leaking, publicly distributing or reselling this file without the seller’s permission is strictly prohibited.'))
    .addFileComponents(new FileBuilder().setURL('attachment://'+safeFileName))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('lx_order_download:'+item.id).setLabel('Download File').setEmoji('📥').setStyle(ButtonStyle.Primary)
    ));
   try{
    await dm.send({flags:MessageFlags.IsComponentsV2,components:[panel],files:[attachment],allowedMentions:{parse:[]}});
   }catch(primaryError){
    const info=orderDeliveryErrorInfo(primaryError);
    log.warn({error:info,orderNumber:item.order.orderNumber,productNumber:item.productNumber},'Order V2 file message failed, trying regular Discord file attachment');
    // Retry normal attachment delivery only for payload/validation errors, never when DMs are blocked.
    if(info.code===50007||info.code===50013)throw primaryError;
    await dm.send({
     content:'📦 **Lextrum Development · Order #'+item.order.orderNumber+'**\n✅ **Your product has been delivered!**\n**Product:** '+item.productName+'\n📎 Download your purchased file using the attachment below.\n🔐 Do not redistribute, leak, publicly share or resell this file without permission.',
     files:[new AttachmentBuilder(Buffer.from(item.fileData),{name:safeFileName})],
     components:[new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('lx_order_download:'+item.id).setLabel('Download File').setEmoji('📥').setStyle(ButtonStyle.Primary)
     )],allowedMentions:{parse:[]}
    });
   }
   await db.digitalOrderItem.update({where:{id:item.id},data:{deliveryState:'delivered',deliveredTo:interaction.user.id,deliveredAt:new Date()}});
   await db.auditEvent.create({data:{guildId:item.order.guildId,event:'ORDER_DELIVERED',actorId:interaction.user.id,detail:JSON.stringify({orderNumber:item.order.orderNumber,productNumber:item.productNumber})}}).catch(()=>{});
   await interaction.editReply('✅ Your product has been sent to your Discord **DMs**! Please check your private messages.');
  }catch(error){
   const info=orderDeliveryErrorInfo(error);
   log.warn({error:info,orderNumber:item.order.orderNumber,productNumber:item.productNumber},'Order DM delivery failed');
   await db.digitalOrderItem.updateMany({where:{id:item.id,deliveryState:'sending'},data:{deliveryState:'pending'}}).catch(e=>log.error(e,'Order release failed'));
   const errorMessage=info.code===50007?'❌ Discord blocked the DM (error 50007). Check privacy settings, shared server and whether the bot is blocked.':'❌ Your order could not be delivered due to a technical issue. Please try again or contact support.';
   await interaction.editReply(errorMessage).catch(()=>{});
  }
 }catch(error){
  log.error(error,'Order acceptance failed');
  await interaction.editReply('Nepavyko pristatyti prekės. Kreipkis į administraciją.').catch(()=>{});
 }
});

// Discord DM file-download button. Never expose an unauthenticated public file URL.
client.on(Events.InteractionCreate,async interaction=>{
 if(!interaction.isButton()||!interaction.customId.startsWith('lx_order_download:'))return;
 const itemId=interaction.customId.slice('lx_order_download:'.length);
 if(!/^c[a-z0-9]{15,35}$/i.test(itemId))return void await interaction.reply({content:'Invalid product.',flags:interaction.inGuild()?MessageFlags.Ephemeral:undefined});
 try{
  if(interaction.inGuild()||interaction.message.author.id!==client.user?.id){
   await interaction.reply({content:'Please use the Download File button in your private delivery message.',flags:interaction.inGuild()?MessageFlags.Ephemeral:undefined});return;
  }
  const item=await db.digitalOrderItem.findUnique({where:{id:itemId},include:{order:true}});
  if(!item||!item.deliveredAt||item.deliveryState!=='delivered'||item.deliveredTo!==interaction.user.id||
     item.order.buyerId!==interaction.user.id||!item.fileData||!item.fileName){
   await interaction.reply({content:'This product is not available for your account. Please contact support.'});return;
  }
  const safeFileName=orderAttachmentName(item.fileName,item.id);
  const panel=new ContainerBuilder().setAccentColor(0x000000)
   .addTextDisplayComponents(new TextDisplayBuilder().setContent('**📥 Download File · Order #'+item.order.orderNumber+'**\n\n**Product:** '+item.productName+'\n\nYour purchased file is attached below.'))
   .addFileComponents(new FileBuilder().setURL('attachment://'+safeFileName));
  const attachment=new AttachmentBuilder(Buffer.from(item.fileData),{name:safeFileName});
  try{
   await interaction.reply({flags:MessageFlags.IsComponentsV2,components:[panel],files:[attachment],allowedMentions:{parse:[]}});
  }catch(primaryError){
   log.warn({error:orderDeliveryErrorInfo(primaryError)},'Download V2 reply failed, retrying a normal attachment');
   if(!interaction.replied&&!interaction.deferred)await interaction.reply({
    content:'📥 **Your product file** — '+item.productName,files:[new AttachmentBuilder(Buffer.from(item.fileData),{name:safeFileName})],allowedMentions:{parse:[]}
   });
  }
 }catch(error){
  log.error(error,'Order download button failed');
  if(!interaction.replied&&!interaction.deferred)await interaction.reply({content:'Download failed. Please try again or contact support.'}).catch(()=>{});
 }
});

// Lextrum dashboard self-role buttons and dropdown. Allowed roles are recorded per message in AuditEvent.
client.on(Events.InteractionCreate,async interaction=>{
 if(!interaction.inGuild())return;
 let selectedIds:string[];
 if(interaction.isStringSelectMenu()&&interaction.customId==='lx_selfroles')selectedIds=interaction.values;
 else if(interaction.isButton()&&interaction.customId.startsWith('lx_selfrole:'))selectedIds=[interaction.customId.slice('lx_selfrole:'.length)];
 else return;
 try{
  const guild=interaction.guild!;
  const record=await db.auditEvent.findFirst({where:{guildId:guild.id,event:'SELF_ROLE_PANEL:'+interaction.message.id},select:{detail:true}});
  if(!record?.detail){await interaction.reply({content:'Šis Self-Roles panelis nebeaktyvus. Paprašyk administratoriaus sukurti naują.',flags:MessageFlags.Ephemeral});return;}
  let cfg:unknown;
  try{cfg=JSON.parse(record.detail);}catch{}
  if(!cfg||typeof cfg!=='object'||!Array.isArray((cfg as {roleIds?:unknown}).roleIds)){
   await interaction.reply({content:'Self-Roles konfigūracija sugadinta.',flags:MessageFlags.Ephemeral});return;
  }
  const allowed=(cfg as {roleIds:unknown[]}).roleIds;
  const permitted=new Set(allowed.filter((v):v is string=>typeof v==='string'&&/^\d{17,20}$/.test(v)));
  if(!selectedIds.length||selectedIds.some(id=>!permitted.has(id))){
   await interaction.reply({content:'Neleidžiamas rolės pasirinkimas.',flags:MessageFlags.Ephemeral});return;
  }
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  const member=await guild.members.fetch(interaction.user.id);
  const me=await guild.members.fetchMe();
  if(!me.permissions.has(PermissionFlagsBits.ManageRoles)){
   await interaction.editReply('Botui reikia Manage Roles teisės.');return;
  }
  const updated:string[]=[],removed:string[]=[],failed:string[]=[];
  const dangerous=PermissionFlagsBits.Administrator|PermissionFlagsBits.ManageGuild|PermissionFlagsBits.ManageRoles|PermissionFlagsBits.BanMembers|PermissionFlagsBits.KickMembers|PermissionFlagsBits.ManageChannels|PermissionFlagsBits.ManageWebhooks;
  for(const id of new Set(selectedIds)){
   const role=await guild.roles.fetch(id).catch(()=>null);
   if(!role||role.managed||role.id===guild.id||role.position>=me.roles.highest.position||role.permissions.has(dangerous)){
    failed.push(id);continue;
   }
   try{
    if(member.roles.cache.has(id)){await member.roles.remove(id,'Lextrum self-role selection');removed.push(role.name);}
    else{await member.roles.add(id,'Lextrum self-role selection');updated.push(role.name);}
   }catch(error){failed.push(id);log.warn({error,guildId:guild.id,roleId:id},'Self-role update failed');}
  }
  const lines=[updated.length?'✅ Pridėta: '+updated.join(', '):'',removed.length?'➖ Pašalinta: '+removed.join(', '):'',failed.length?'⚠️ Kai kurių rolių pakeisti nepavyko. Patikrink rolės aukštį ir boto teises.':''].filter(Boolean);
  await interaction.editReply(lines.join('\\n')||'Nieko nepakeista.');
 }catch(error){
  log.error(error,'Self-role selector failed');
  if(interaction.deferred||interaction.replied)await interaction.editReply('Nepavyko pakeisti rolių. Bandyk dar kartą.').catch(()=>{});
  else await interaction.reply({content:'Nepavyko pakeisti rolių. Bandyk dar kartą.',flags:MessageFlags.Ephemeral}).catch(()=>{});
 }
});

const stop=async()=>{client.destroy();await db.$disconnect();process.exit(0);};
process.once('SIGTERM',()=>{void stop();});
process.once('SIGINT',()=>{void stop();});
await db.$connect();
await client.login(DISCORD_TOKEN);
const appId=process.env.DISCORD_CLIENT_ID;
const guildId=process.env.DISCORD_GUILD_ID;
if(appId && guildId){
  try {
    await new REST({version:'10'}).setToken(DISCORD_TOKEN).put(Routes.applicationGuildCommands(appId,guildId),{body:commands});
    log.info({guildId,count:commands.length},'Slash commands registered');
  } catch(error){log.error(error,'Slash command registration failed');}
}else{log.warn('DISCORD_CLIENT_ID or DISCORD_GUILD_ID missing: slash commands not registered');}

