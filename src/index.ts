import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Client, GatewayIntentBits, Events, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } from 'discord.js';
import pino from 'pino';
import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';

const {DISCORD_TOKEN,DATABASE_URL}=process.env;
if(!DISCORD_TOKEN || !DATABASE_URL) throw new Error('Missing DISCORD_TOKEN or DATABASE_URL');
const db=new PrismaClient();
const log=pino({level:process.env.LOG_LEVEL??'info'});
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]});
const joins=new Map<string,number[]>();
const cooldown=new Map<string,number>();
const inviteCache=new Map<string,Map<string,{uses:number;inviterId:string|null}>>();
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
  if(ch?.isTextBased() && 'send' in ch)await ch.send({content:`[${event}] ${detail??''}`.slice(0,1900),allowedMentions:{parse:[]}}).catch(e=>log.warn(e));
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
      if(auto?.inviteLogChannelId)await sendTo(guildId,auto.inviteLogChannelId,'🔗 '+member.user.username+' joined • inviter: '+(inviterId?'<@'+inviterId+'>':'unknown')+' • code: '+(inviteCode??'unknown'));
    }
    if(auto?.welcomeChannelId)await sendTo(guildId,auto.welcomeChannelId,renderMessage(auto.welcomeMessage,{user:member.user.username,username:member.user.username,count:String(member.guild.memberCount),inviter:inviterId??'unknown',level:'0',invites:'0'}));
    if(member.user.createdTimestamp>now-3*86400_000)await audit(guildId,'NEW_ACCOUNT',member.id);
  }catch(e){log.error(e,'Join handler');}
});
client.on(Events.GuildMemberRemove,async member=>{
 try{const auto=await db.communityAutomation.findUnique({where:{guildId:member.guild.id}});if(auto?.goodbyeChannelId)await sendTo(member.guild.id,auto.goodbyeChannelId,renderMessage(auto.goodbyeMessage,{user:member.user.username,username:member.user.username,count:String(member.guild.memberCount),inviter:'unknown',level:'0',invites:'0'}));await audit(member.guild.id,'MEMBER_LEFT',member.id);}catch(e){log.error(e,'Leave handler');}
});
client.on(Events.MessageCreate,async message=>{
  if(!message.inGuild()||message.author.bot)return;
  try{
    if((message.mentions.everyone || message.mentions.users.size>=8) && !message.member?.permissions.has(PermissionFlagsBits.ManageMessages)){
      if(message.deletable)await message.delete();
      await audit(message.guildId,'MASS_MENTIONS',message.author.id);
      return;
    }
    const key=`${message.guildId}:${message.author.id}`,now=Date.now();
    const auto=await db.communityAutomation.findUnique({where:{guildId:message.guildId}});if(auto?.xpEnabled===false)return;
    if(now-(cooldown.get(key)??0)<(auto?.xpCooldownSeconds??60)*1000)return;
    cooldown.set(key,now);
    const points=auto?.xpPerMessage??5;
    const old=await db.xp.findUnique({where:{guildId_userId:{guildId:message.guildId,userId:message.author.id}}});
    const next=await db.xp.upsert({where:{guildId_userId:{guildId:message.guildId,userId:message.author.id}},create:{guildId:message.guildId,userId:message.author.id,points},update:{points:{increment:points},lastEarnedAt:new Date()}});
    const level=xpLevel(next.points);
    if(auto?.levelUpEnabled!==false&&level>xpLevel(old?.points??0)&&level>0){await sendTo(message.guildId,auto?.levelChannelId??message.channelId,renderMessage(auto?.levelMessage??'🎉 {user} pasiekė {level} lygį!',{user:message.author.username,username:message.author.username,level:String(level),count:'0',inviter:'unknown',invites:'0'}));await audit(message.guildId,'LEVEL_UP',message.author.id,String(level));}
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
    if(cmd==='ticket-config'){
      if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){await interaction.reply({content:'Reikia Manage Server teisės.',flags:MessageFlags.Ephemeral});return;}
      const channel=interaction.options.getChannel('feedback_channel',true);
      await db.communityPanel.upsert({where:{guildId:id},create:{guildId:id,feedbackChannelId:channel.id},update:{feedbackChannelId:channel.id}});
      await interaction.reply({content:'⭐ Transcript ir feedback kanalas nustatytas: <#'+channel.id+'>',flags:MessageFlags.Ephemeral});return;
    }
    if(cmd==='suggestion-config'){
      if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){await interaction.reply({content:'Reikia Manage Server leidimo.',flags:MessageFlags.Ephemeral});return;}
      const channel=interaction.options.getChannel('channel',true);
      await db.guildConfig.upsert({where:{guildId:id},create:{guildId:id,suggestionChannelId:channel.id},update:{suggestionChannelId:channel.id}});
      await interaction.reply({content:'💡 Pasiūlymų kanalas nustatytas: <#'+channel.id+'>',flags:MessageFlags.Ephemeral});return;
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
      const embed=new EmbedBuilder().setTitle('💡 Naujas pasiūlymas').setDescription(idea).addFields({name:'Autorius',value:'<@'+interaction.user.id+'>'}).setColor(0x8066f2).setTimestamp().setFooter({text:'👍 Pritariu • 👎 Nepritariu'});
      if(reason)embed.addFields({name:'Kodėl?',value:reason});
      if(attachment)embed.setImage(attachment.url);
      const posted=await channel.send({embeds:[embed],allowedMentions:{parse:[]}});
      await Promise.allSettled([posted.react('👍'),posted.react('👎')]);
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
      await ch.send({embeds:[new EmbedBuilder().setTitle(interaction.options.getString('title',true)).setDescription(interaction.options.getString('body',true)).setColor(0x5865f2).setTimestamp()],allowedMentions:{parse:[]}});
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
  if(interaction.customId==='dg_ticket_open'||interaction.customId==='dg_ticket_select'){
   const ticketType=interaction.isStringSelectMenu()?interaction.values[0]:'General';
   if(!ticketType.trim()||ticketType.length>70){await interaction.reply({content:'Netinkamas ticket pasirinkimas.',flags:MessageFlags.Ephemeral});return;}
   const existing=await db.supportTicket.findFirst({where:{guildId,userId,status:'open'}});
   if(existing){await interaction.reply({content:'Jau turi atidarytą ticketą: <#'+existing.channelId+'>',flags:MessageFlags.Ephemeral});return;}
   const row=new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('dg_ticket_confirm:'+encodeURIComponent(ticketType)).setLabel('Tęsti / Continue').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('dg_ticket_cancel').setLabel('Atšaukti / Cancel').setStyle(ButtonStyle.Secondary));
   await interaction.reply({content:'🎫 **'+ticketType+'**\nPrieš atidarant ticketą reikės užpildyti pagalbos formą. Ar nori tęsti?',components:[row],flags:MessageFlags.Ephemeral});return;
  }
  if(interaction.customId.startsWith('dg_ticket_confirm:')){
   if(!interaction.isButton())return;
   const ticketType=decodeURIComponent(interaction.customId.slice('dg_ticket_confirm:'.length));
   if(!ticketType||ticketType.length>70)return;
   const existing=await db.supportTicket.findFirst({where:{guildId,userId,status:'open'}});
   if(existing){await interaction.reply({content:'Jau turi atidarytą ticketą.',flags:MessageFlags.Ephemeral});return;}
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
   await channel.send({content:'🎫 **'+ticketType.replace(/[*_~`\\]/g,'')+'** • <@'+userId+'> '+(cfg.supportRoleId?'<@&'+cfg.supportRoleId+'>':''),embeds:[new EmbedBuilder().setTitle(subject).setDescription(details).setColor(0x8066f2)],components:[row],allowedMentions:{users:[userId],roles:cfg.supportRoleId?[cfg.supportRoleId]:[]}});
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
    await channel.send({embeds:[new EmbedBuilder().setTitle('⭐ Ticket feedback').addFields({name:'Ticket',value:'Support ticket • '+ticket.channelId.slice(-6)},{name:'Įvertinimas',value:rating+'/5 ⭐'},{name:'Klientas',value:'<@'+ticket.userId+'>'},{name:'Support',value:ticket.claimedById?'<@'+ticket.claimedById+'>':'Nepriskirtas'}).setColor(0x8066f2).setTimestamp()],allowedMentions:{parse:[]}});
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
   while(pool.length&&winners.length<g.winnerCount){const i=Math.floor(Math.random()*pool.length);winners.push(pool.splice(i,1)[0]);}
   const ch=await client.channels.fetch(g.channelId);
   if(ch?.isTextBased()&&'send' in ch){
    const original=await ch.messages.fetch(g.messageId).catch(()=>null);
    if(original)await original.edit({components:[]}).catch(()=>{});
    await ch.send({content:winners.length?'🎉 Giveaway baigėsi! **'+g.prize+'**\nLaimėtojai: '+winners.map(id=>'<@'+id+'>').join(', '):'Giveaway baigėsi: **'+g.prize+'**. Dalyvių nebuvo.',allowedMentions:{users:winners}});
   }
   await audit(g.guildId,'GIVEAWAY_ENDED',undefined,g.prize);
  }catch(e){log.error(e,'Could not announce giveaway result');}
 }
}
client.once(Events.ClientReady,()=>{setInterval(()=>finishGiveaways().catch(e=>log.error(e,'Giveaway scheduler')),30_000);finishGiveaways().catch(e=>log.error(e));});

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

