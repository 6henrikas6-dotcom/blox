import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,validOrigin} from '@/lib/auth';
import {db} from '@/lib/db';
import {discord} from '@/lib/discord';

type SuggestionSettings={
 channelId:string; title:string; upEmoji:string; downEmoji:string;
 upLabel:string;downLabel:string;color:string;pendingLabel:string;
};
const defaults:SuggestionSettings={
 channelId:'',title:'Naujas pasiūlymas',upEmoji:'👍',downEmoji:'👎',
 upLabel:'Pritariu',downLabel:'Nepritariu',color:'#8066f2',pendingLabel:'⏳ Pending'
};
function parseSettings(value:string|null|undefined):Partial<SuggestionSettings>{
 if(!value)return {};
 try{
  const record=JSON.parse(value) as Record<string,unknown>;
  if(!record||typeof record!=='object')return {};
  const parsed:Partial<SuggestionSettings>={};
  for(const key of Object.keys(defaults) as Array<keyof SuggestionSettings>){
   if(typeof record[key]==='string')parsed[key]=record[key] as string;
  }
  return parsed;
 }catch{return {};}
}
export async function GET(){
 const user=await requireAdmin();
 if(!user)return NextResponse.json({error:'Tik administratoriams.'},{status:403});
 const guildId=process.env.DISCORD_GUILD_ID;
 if(!guildId)return NextResponse.json({error:'Serveris nesukonfigūruotas.'},{status:500});
 const [config,record]=await Promise.all([
  db.guildConfig.findUnique({where:{guildId},select:{suggestionChannelId:true}}),
  db.auditEvent.findFirst({where:{guildId,event:'SUGGESTION_SETTINGS'},orderBy:{createdAt:'desc'},select:{detail:true}})
 ]);
 return NextResponse.json({settings:{...defaults,...parseSettings(record?.detail),channelId:config?.suggestionChannelId??''}});
}
export async function POST(request:NextRequest){
 const user=await requireAdmin();
 if(!user)return NextResponse.json({error:'Tik administratoriams.'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Netinkama užklausos kilmė.'},{status:403});
 const guildId=process.env.DISCORD_GUILD_ID;
 if(!guildId)return NextResponse.json({error:'Serveris nesukonfigūruotas.'},{status:500});
 let input:unknown;
 try{input=await request.json();}catch{return NextResponse.json({error:'Neteisingi duomenys.'},{status:400});}
 if(!input||typeof input!=='object')return NextResponse.json({error:'Neteisingi duomenys.'},{status:400});
 const obj=input as Record<string,unknown>;
 const get=(key:keyof SuggestionSettings)=>typeof obj[key]==='string'?(obj[key] as string).trim():'';
 const settings:SuggestionSettings={
  channelId:get('channelId'),title:get('title'),upEmoji:get('upEmoji'),
  downEmoji:get('downEmoji'),upLabel:get('upLabel'),downLabel:get('downLabel'),
  color:get('color'),pendingLabel:get('pendingLabel')
 };
 const emojiPattern=/^(?:<(?:a?):[A-Za-z0-9_]{2,32}:\d{17,20}>|.{1,12})$/u;
 if(!/^\d{17,20}$/.test(settings.channelId))return NextResponse.json({error:'Pasirink Suggestions kanalą.'},{status:400});
 if(!settings.title||settings.title.length>90||!settings.upLabel||!settings.downLabel||settings.upLabel.length>45||settings.downLabel.length>45||!settings.pendingLabel||settings.pendingLabel.length>80)
  return NextResponse.json({error:'Patikrink tekstų ilgį: pavadinimas iki 90, balsų tekstai iki 45 simbolių.'},{status:400});
 if(!emojiPattern.test(settings.upEmoji)||!emojiPattern.test(settings.downEmoji))
  return NextResponse.json({error:'Įrašyk Unicode emoji arba Discord emoji, pvz. <:name:123456789012345678>.'},{status:400});
 if(!/^#[0-9a-fA-F]{6}$/.test(settings.color))return NextResponse.json({error:'Neteisinga spalva.'},{status:400});
 try{
  const channels=await discord('/guilds/'+guildId+'/channels') as Array<{id:string;type:number}>;
  if(!channels.some(ch=>ch.id===settings.channelId&&(ch.type===0||ch.type===5)))return NextResponse.json({error:'Pasirink savo serverio tekstinį kanalą.'},{status:400});
  await db.guildConfig.upsert({where:{guildId},create:{guildId,suggestionChannelId:settings.channelId},update:{suggestionChannelId:settings.channelId}});
  await db.auditEvent.create({data:{guildId,event:'SUGGESTION_SETTINGS',actorId:user.id,detail:JSON.stringify(settings)}});
  return NextResponse.json({ok:true,settings});
 }catch{return NextResponse.json({error:'Nepavyko išsaugoti nustatymų.'},{status:502});}
}
