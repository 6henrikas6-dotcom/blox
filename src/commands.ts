import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
export const commands = [
 new SlashCommandBuilder().setName('ping').setDescription('Check bot status'),
 new SlashCommandBuilder().setName('setup').setDescription('Configure server channels').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption(o=>o.setName('log_channel').setDescription('Audit log channel'))
  .addChannelOption(o=>o.setName('announcement_channel').setDescription('Update announcements channel')),
 new SlashCommandBuilder().setName('security').setDescription('Server protection').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(s=>s.setName('status').setDescription('Show protection status'))
  .addSubcommand(s=>s.setName('lockdown').setDescription('Restrict @everyone from sending messages'))
  .addSubcommand(s=>s.setName('unlock').setDescription('Restore saved permission overwrites')),
 new SlashCommandBuilder().setName('mod').setDescription('Moderation tools').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addSubcommand(s=>s.setName('warn').setDescription('Record a warning').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)))
  .addSubcommand(s=>s.setName('timeout').setDescription('Timeout a member').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addIntegerOption(o=>o.setName('minutes').setDescription('1 to 40320').setMinValue(1).setMaxValue(40320).setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason'))),
 new SlashCommandBuilder().setName('announce').setDescription('Publish a product update').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o=>o.setName('title').setDescription('Title').setMaxLength(256).setRequired(true))
  .addStringOption(o=>o.setName('body').setDescription('Announcement text').setMaxLength(4000).setRequired(true))
  .addBooleanOption(o=>o.setName('everyone').setDescription('Mention @everyone (requires Mention Everyone permission)'))
  .addRoleOption(o=>o.setName('role').setDescription('Role to mention in announcement')),

 new SlashCommandBuilder().setName('updates').setDescription('Manage update DM subscriptions')
  .addSubcommand(s=>s.setName('subscribe').setDescription('Opt in to future update DMs'))
  .addSubcommand(s=>s.setName('unsubscribe').setDescription('Opt out of update DMs')),
 new SlashCommandBuilder().setName('ticket-config').setDescription('Nustatyti ticket transcript ir feedback kanalą').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption(o=>o.setName('feedback_channel').setDescription('Kanalas transcriptams ir įvertinimams').addChannelTypes(0).setRequired(true)),
 new SlashCommandBuilder().setName('suggestion').setDescription('Pasiūlyk idėją su pasirenkama nuotrauka')
  .addStringOption(o=>o.setName('idea').setDescription('Tavo pasiūlymas').setMinLength(5).setMaxLength(1800).setRequired(true))
  .addAttachmentOption(o=>o.setName('image').setDescription('Pasirenkama nuotrauka / pavyzdys'))
  .addStringOption(o=>o.setName('reason').setDescription('Kodėl tai būtų naudinga?').setMaxLength(800)),
 new SlashCommandBuilder().setName('suggestion-config').setDescription('Nustatyti pasiūlymų kanalą').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption(o=>o.setName('channel').setDescription('Kur publikuoti pasiūlymus').addChannelTypes(0).setRequired(true)),
 new SlashCommandBuilder().setName('apply').setDescription('Pateikti staff paraišką (forma)'),
 new SlashCommandBuilder().setName('applications').setDescription('Peržiūrėti naujausias staff paraiškas').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addIntegerOption(o=>o.setName('limit').setDescription('Kiek paraiškų rodyti (1–15)').setMinValue(1).setMaxValue(15)),
 new SlashCommandBuilder().setName('suggestion-status').setDescription('Pakeisti pasiūlymo būseną').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o=>o.setName('message_id').setDescription('Pasiūlymo Discord žinutės ID').setRequired(true))
  .addStringOption(o=>o.setName('status').setDescription('Nauja būsena').setRequired(true)
   .addChoices({name:'Pending',value:'pending'},{name:'Accepted',value:'accepted'},{name:'In Progress',value:'in_progress'},{name:'Implemented',value:'implemented'},{name:'Denied',value:'denied'}))
  .addStringOption(o=>o.setName('note').setDescription('Staff komentaras (nebūtina)').setMaxLength(500)),
 new SlashCommandBuilder().setName('rank').setDescription('Show your activity XP')
].map(command=>command.toJSON());
