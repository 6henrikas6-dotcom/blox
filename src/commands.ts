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
 new SlashCommandBuilder().setName('giveaway-reroll').setDescription('Išrinkti naują pasibaigusio giveaway laimėtoją').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o=>o.setName('message_id').setDescription('Pasibaigusio giveaway Discord žinutės ID').setRequired(true))
  .addIntegerOption(o=>o.setName('winners').setDescription('Kiek naujų laimėtojų (1–20)').setMinValue(1).setMaxValue(20)),
 new SlashCommandBuilder().setName('faq-set').setDescription('Sukurti arba pakeisti automatinį atsakymą').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o=>o.setName('trigger').setDescription('Tikslus klausimas / frazė').setMinLength(3).setMaxLength(100).setRequired(true))
  .addStringOption(o=>o.setName('answer').setDescription('Automatinis atsakymas').setMinLength(1).setMaxLength(1500).setRequired(true)),
 new SlashCommandBuilder().setName('faq-remove').setDescription('Išjungti automatinį atsakymą').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o=>o.setName('trigger').setDescription('Klausimas / frazė').setRequired(true)),
 new SlashCommandBuilder().setName('faq-list').setDescription('Peržiūrėti automatinio atsakiklio taisykles').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
 new SlashCommandBuilder().setName('dm').setDescription('Siųsti asmeninę žinutę nariui per botą').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption(o=>o.setName('user').setDescription('Kam siųsti žinutę').setRequired(true))
  .addStringOption(o=>o.setName('message').setDescription('Žinutės tekstas').setMinLength(1).setMaxLength(1800).setRequired(true)),
 new SlashCommandBuilder().setName('dm-history').setDescription('Peržiūrėti boto DM siuntimo istoriją').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addIntegerOption(o=>o.setName('limit').setDescription('Įrašų skaičius (1–15)').setMinValue(1).setMaxValue(15)),
 new SlashCommandBuilder().setName('dm-update').setDescription('Siųsti atnaujinimą DM užsiprenumeravusiems nariams').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(o=>o.setName('title').setDescription('Atnaujinimo pavadinimas').setMinLength(3).setMaxLength(100).setRequired(true))
  .addStringOption(o=>o.setName('message').setDescription('Atnaujinimo tekstas').setMinLength(5).setMaxLength(1500).setRequired(true)),
 new SlashCommandBuilder().setName('createorder').setDescription('Sukurti skaitmeninį užsakymą (administratoriams)').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o=>o.setName('ordernumber').setDescription('Užsakymo numeris').setMinLength(3).setMaxLength(40).setRequired(true))
  .addStringOption(o=>o.setName('product_name').setDescription('Produkto pavadinimas').setMinLength(1).setMaxLength(150).setRequired(true))
  .addUserOption(o=>o.setName('buyer').setDescription('Pirkėjas (rekomenduojama)'))
  .addStringOption(o=>o.setName('productnumber').setDescription('Prekės numeris (numatyta: 1)').setMaxLength(30)),
 new SlashCommandBuilder().setName('giveproduct').setDescription('Send a Product Library file to a server member (admin only)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption(o=>o.setName('user').setDescription('Member who will receive the product via DM').setRequired(true))
  .addStringOption(o=>o.setName('product').setDescription('Select a product from your library').setRequired(true).setAutocomplete(true)),
 new SlashCommandBuilder().setName('recieveorder').setDescription('Receive your purchased product in DMs')
  .addStringOption(o=>o.setName('ordernumber').setDescription('Your order number').setRequired(true))
  .addStringOption(o=>o.setName('productname').setDescription('Exact product name').setRequired(true)),
 new SlashCommandBuilder().setName('rank').setDescription('Show your activity XP')
].map(command=>command.toJSON());
