import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Client, GatewayIntentBits, Events, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
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
client.once(Events.ClientReady,c=>log.info({bot:c.user.tag},'Bot online'));
client.on(Events.GuildMemberAdd,async member=>{
  try{
    const now=Date.now(),guildId=member.guild.id;
    const recent=(joins.get(guildId)??[]).filter(t=>now-t<60_000);recent.push(now);joins.set(guildId,recent);
    const cfg=await db.guildConfig.findUnique({where:{guildId}});
    if(recent.length>=(cfg?.joinThreshold??8) && !cfg?.lockdown){
      await audit(guildId,'RAID_ALERT',undefined,`${recent.length} members joined within one minute`);
      await lockdown(guildId,true,'system');
    }
    if(member.user.createdTimestamp>now-3*86400_000)await audit(guildId,'NEW_ACCOUNT',member.id);
  }catch(e){log.error(e,'Join handler');}
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
    if(now-(cooldown.get(key)??0)<60_000)return;
    cooldown.set(key,now);
    await db.xp.upsert({where:{guildId_userId:{guildId:message.guildId,userId:message.author.id}},create:{guildId:message.guildId,userId:message.author.id,points:5},update:{points:{increment:5},lastEarnedAt:new Date()}});
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
 if(!interaction.isButton()||!interaction.inGuild())return;
 if(!['dg_verify','dg_ticket_open','dg_ticket_close'].includes(interaction.customId))return;
 try{
  const guild=interaction.guild!,guildId=guild.id,userId=interaction.user.id;
  const cfg=await db.communityPanel.findUnique({where:{guildId}});
  if(!cfg){await interaction.reply({content:'Sistema dar nesukonfigūruota.',flags:MessageFlags.Ephemeral});return;}
  if(interaction.customId==='dg_verify'){
   if(!cfg.verifiedRoleId){await interaction.reply({content:'Verify rolė nenustatyta.',flags:MessageFlags.Ephemeral});return;}
   const member=await guild.members.fetch(userId);
   await member.roles.add(cfg.verifiedRoleId,'DevGuard verification');
   await interaction.reply({content:'Patvirtinta! Rolė suteikta.',flags:MessageFlags.Ephemeral});
   await audit(guildId,'VERIFY',userId);
   return;
  }
  if(interaction.customId==='dg_ticket_open'){
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
   const channel=await guild.channels.create({name:'ticket-'+userId.slice(-6),type:ChannelType.GuildText,parent:cfg.ticketCategoryId,permissionOverwrites:overwrites,reason:'DevGuard support ticket'});
   try{await db.supportTicket.create({data:{guildId,userId,channelId:channel.id}});}catch(e){await channel.delete().catch(()=>{});throw e;}
   const row=new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('dg_ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger));
   await channel.send({content:'Support ticket • <@'+userId+'>' +(cfg.supportRoleId?' <@&'+cfg.supportRoleId+'>':''),components:[row],allowedMentions:{users:[userId],roles:cfg.supportRoleId?[cfg.supportRoleId]:[]}});
   await interaction.editReply('Ticketas sukurtas: <#'+channel.id+'>');
   await audit(guildId,'TICKET_OPEN',userId,channel.id);
   return;
  }
  const ticket=await db.supportTicket.findUnique({where:{channelId:interaction.channelId}});
  if(!ticket||ticket.status!=='open'){await interaction.reply({content:'Ticketas nerastas arba uždarytas.',flags:MessageFlags.Ephemeral});return;}
  const member=await guild.members.fetch(userId);
  if(ticket.userId!==userId&&!member.permissions.has(PermissionFlagsBits.ManageChannels)&&(!cfg.supportRoleId||!member.roles.cache.has(cfg.supportRoleId))){await interaction.reply({content:'Neturi teisės uždaryti šio ticketo.',flags:MessageFlags.Ephemeral});return;}
  await interaction.reply({content:'Ticketas uždaromas.',flags:MessageFlags.Ephemeral});
  await db.supportTicket.update({where:{id:ticket.id},data:{status:'closed',closedAt:new Date()}});
  await audit(guildId,'TICKET_CLOSE',userId,ticket.channelId);
  await interaction.channel?.delete().catch(e=>log.error(e,'Ticket channel delete failed'));
 }catch(e){log.error(e,'Community panel interaction failed');if(interaction.deferred||interaction.replied)await interaction.editReply('Įvyko klaida. Patikrink boto leidimus.').catch(()=>{});else await interaction.reply({content:'Įvyko klaida. Patikrink boto leidimus.',flags:MessageFlags.Ephemeral}).catch(()=>{});}
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

