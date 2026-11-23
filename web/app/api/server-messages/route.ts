import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,validOrigin} from '@/lib/auth';
import {db} from '@/lib/db';

const api='https://discord.com/api/v10';
const allowed=new Set(['image/png','image/jpeg','image/webp','image/gif']);
const read=(form:FormData,key:string)=>{const value=form.get(key);return typeof value==='string'?value.trim():'';};
function imageFile(value:FormDataEntryValue|null){
 return value===null||(value instanceof File&&value.size>0&&value.size<=8*1024*1024&&allowed.has(value.type));
}
function ext(file:File){return file.type==='image/jpeg'?'jpg':file.type==='image/webp'?'webp':file.type==='image/gif'?'gif':'png';}
function validHttps(raw:string){
 if(!raw)return true;
 try{const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password&&raw.length<=1600;}
 catch{return false;}
}
export async function POST(req:NextRequest){
 const user=await requireAdmin();
 if(!user)return NextResponse.json({error:'Tik administratoriui.'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Neteisinga užklausos kilmė.'},{status:403});
 const guildId=process.env.DISCORD_GUILD_ID,token=process.env.DISCORD_BOT_TOKEN;
 if(!guildId||!token)return NextResponse.json({error:'Lextrum botas nesukonfigūruotas.'},{status:500});
 let form:FormData;
 try{form=await req.formData();}catch{return NextResponse.json({error:'Netinkami duomenys.'},{status:400});}
 const channelId=read(form,'channelId'),title=read(form,'title'),body=read(form,'description'),
  intro=read(form,'intro'),footer=read(form,'footer'),color=read(form,'color'),
  bannerUrl=read(form,'bannerUrl'),thumbnailUrl=read(form,'thumbnailUrl'),
  buttonLabel=read(form,'buttonLabel'),buttonUrl=read(form,'buttonUrl'),
  forumTitle=read(form,'forumTitle'),roleId=read(form,'roleId'),mentionAll=read(form,'mentionAll')||'none';
 const banner=form.get('banner'),thumbnail=form.get('thumbnail');
 if(!['none','everyone','here'].includes(mentionAll)||roleId&&!/^\d{17,20}$/.test(roleId))return NextResponse.json({error:'Neteisingas žymėjimo pasirinkimas.'},{status:400});
 if(!/^\d{17,20}$/.test(channelId))return NextResponse.json({error:'Pasirink kanalą.'},{status:400});
 if(title.length>256||body.length>3500||intro.length>1000||footer.length>500||!title&&!body&&!intro)
  return NextResponse.json({error:'Įrašyk tekstą ir neviršyk nustatytų simbolių limitų.'},{status:400});
 if(!imageFile(banner)||!imageFile(thumbnail))return NextResponse.json({error:'Paveikslėliai turi būti PNG, JPG, WEBP arba GIF iki 8 MB kiekvienas.'},{status:400});
 if(!validHttps(bannerUrl)||!validHttps(thumbnailUrl))return NextResponse.json({error:'Nuotraukų URL turi prasidėti https://.'},{status:400});
 if(Boolean(buttonLabel)!==Boolean(buttonUrl)||buttonLabel.length>80||!validHttps(buttonUrl))
  return NextResponse.json({error:'Mygtukui įrašyk ir pavadinimą, ir galiojančią HTTPS nuorodą.'},{status:400});
 if(banner&&bannerUrl||thumbnail&&thumbnailUrl)return NextResponse.json({error:'Vienai nuotraukai rinkis failą ARBA URL.'},{status:400});

 try{
  const channelRes=await fetch(api+'/channels/'+channelId,{headers:{Authorization:'Bot '+token},cache:'no-store'});
  if(!channelRes.ok)return NextResponse.json({error:'Botas negali pasiekti šio kanalo.'},{status:400});
  const channel=await channelRes.json() as {guild_id?:string;type?:number};
  if(channel.guild_id!==guildId||![0,5,15].includes(channel.type??-1))
   return NextResponse.json({error:'Pasirink šio serverio tekstinį arba Forum kanalą.'},{status:400});
  const isForum=channel.type===15;
  if(isForum&&(!forumTitle||forumTitle.length>100))return NextResponse.json({error:'Forum įrašui būtinas pavadinimas iki 100 simbolių.'},{status:400});
  if(roleId){
   const rolesResponse=await fetch(api+'/guilds/'+guildId+'/roles',{headers:{Authorization:'Bot '+token},cache:'no-store'});
   if(!rolesResponse.ok)return NextResponse.json({error:'Nepavyko patikrinti rolės.'},{status:502});
   const guildRoles=await rolesResponse.json() as Array<{id:string}>;
   if(!guildRoles.some(r=>r.id===roleId&&r.id!==guildId))return NextResponse.json({error:'Rolė nerasta šiame serveryje.'},{status:400});
  }
  const mentionText=[mentionAll==='everyone'?'@everyone':mentionAll==='here'?'@here':'',roleId?'<@&'+roleId+'>':''].filter(Boolean).join(' ');
  const introText=[mentionText,intro,title?'**'+title+'**':'',body].filter(Boolean).join('\n\n');
  if(introText.length>4000)return NextResponse.json({error:'Pranešimo tekstas per ilgas vienai V2 teksto daliai.'},{status:400});
  const accent=/^#[0-9a-fA-F]{6}$/.test(color)?parseInt(color.slice(1),16):0x8066f2;
  const children:Record<string,unknown>[]=[];
  const thumb=thumbnail instanceof File?'attachment://lextrum-thumb.'+ext(thumbnail):thumbnailUrl;
  if(thumb)children.push({type:9,components:[{type:10,content:introText}],accessory:{type:11,media:{url:thumb}}});
  else children.push({type:10,content:introText});
  const cover=banner instanceof File?'attachment://lextrum-banner.'+ext(banner):bannerUrl;
  if(cover)children.push({type:12,items:[{media:{url:cover}}]});
  if(buttonUrl)children.push({type:1,components:[{type:2,style:5,label:buttonLabel,url:buttonUrl}]});
  if(footer)children.push({type:10,content:'-# '+footer.replace(/\n/g,' ')});
  const data=new FormData();
  const payload={flags:32768,components:[{type:17,accent_color:accent,components:children}],allowed_mentions:{parse:mentionAll==='none'?[]:['everyone'],roles:roleId?[roleId]:[]}};
  data.set('payload_json',JSON.stringify(isForum?{name:forumTitle,message:payload}:payload));
  if(banner instanceof File)data.set('files[0]',banner,'lextrum-banner.'+ext(banner));
  if(thumbnail instanceof File)data.set('files[1]',thumbnail,'lextrum-thumb.'+ext(thumbnail));
  const response=await fetch(api+'/channels/'+channelId+(isForum?'/threads':'/messages'),{method:'POST',headers:{Authorization:'Bot '+token},body:data,cache:'no-store'});
  if(!response.ok)return NextResponse.json({error:'Discord atmetė pranešimą ('+response.status+'). Patikrink boto leidimus (Forum: Create Public Threads, Send Messages in Threads), nuotraukas ir žymėjimus.'},{status:502});
  const result=await response.json() as {id:string};
  await db.auditEvent.create({data:{guildId,event:isForum?'SERVER_FORUM_PUBLISHED':'SERVER_MESSAGE_PUBLISHED',actorId:user.id,detail:JSON.stringify({channelId,messageId:result.id,title,forumTitle:isForum?forumTitle:undefined})}}).catch(()=>{});
  return NextResponse.json({ok:true,url:'https://discord.com/channels/'+guildId+'/'+(isForum?result.id:channelId+'/'+result.id)});
 }catch{return NextResponse.json({error:'Nepavyko išsiųsti pranešimo į Discord.'},{status:502});}
}
