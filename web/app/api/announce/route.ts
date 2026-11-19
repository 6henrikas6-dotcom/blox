import { NextRequest,NextResponse } from 'next/server';
import { requireAdmin,validOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
const discordApi='https://discord.com/api/v10';
const allowed=new Set(['image/png','image/jpeg','image/webp','image/gif']);
const string=(v:FormDataEntryValue|null)=>typeof v==='string'?v:'';
export async function POST(req:NextRequest){
 const user=await requireAdmin();if(!user)return NextResponse.json({error:'Unauthorized'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Invalid origin'},{status:403});
 const guildId=process.env.DISCORD_GUILD_ID;
 const token=process.env.DISCORD_BOT_TOKEN;
 if(!guildId||!token)return NextResponse.json({error:'Botas nesukonfigūruotas'},{status:500});
 let form:FormData;try{form=await req.formData();}catch{return NextResponse.json({error:'Neteisingi formos duomenys'},{status:400});}
 const title=string(form.get('title')).trim(),description=string(form.get('description')).trim(),content=string(form.get('content')).trim(),footer=string(form.get('footer')).trim(),author=string(form.get('author')).trim(),imageUrl=string(form.get('imageUrl')).trim(),thumbnailUrl=string(form.get('thumbnailUrl')).trim(),color=string(form.get('color')).trim();
 const senderName=string(form.get('username')).trim();
 const senderAvatar=string(form.get('avatarUrl')).trim();
 if(senderName.length>80)return NextResponse.json({error:'Siuntėjo vardas per ilgas (iki 80 simbolių).'},{status:400});
 const pingEveryone=string(form.get('everyone'))==='true';
 const roleId=string(form.get('roleId'));
 const requestedChannelId=string(form.get('channelId'));
 const partnershipUrl=string(form.get('partnershipUrl')).trim();
 const buttonLabel=string(form.get('buttonLabel')).trim()||'Join partner server';
 if(partnershipUrl){
  try{
   const u=new URL(partnershipUrl);
   const validHost=['discord.gg','discord.com','www.discord.com','discordapp.com'].includes(u.hostname);
   const segments=u.pathname.split('/').filter(Boolean);
   const code=segments.length===1?segments[0]:segments.length===2&&segments[0]==='invite'?segments[1]:'';
   if(u.protocol!=='https:'||!validHost||!code||!/^[a-zA-Z0-9-]+$/.test(code)||u.username||u.password||u.search||u.hash)throw Error('Invalid invite');
  }catch{return NextResponse.json({error:'Įrašyk teisingą Discord invite nuorodą (https://discord.gg/...)'},{status:400});}
 }
 if(buttonLabel.length>80)return NextResponse.json({error:'Mygtuko tekstas per ilgas'},{status:400});
 if(roleId&&!/^\d{17,20}$/.test(roleId))return NextResponse.json({error:'Netinkamas rolės ID'},{status:400});
 const file=form.get('image');
 if(title.length>256||description.length>4000||content.length>2000||footer.length>2048||author.length>256||(!title&&!description&&!content))return NextResponse.json({error:'Patikrink tekstą ir laukų ilgį'},{status:400});
 const validUrl=(s:string)=>{if(!s)return true;try{const u=new URL(s);return u.protocol==='https:'&&s.length<=1800&&!u.username&&!u.password;}catch{return false;}};
 if(!validUrl(imageUrl)||!validUrl(thumbnailUrl)||!validUrl(senderAvatar))return NextResponse.json({error:'Nuotraukų ir avataro adresai turi būti HTTPS'},{status:400});
 if(file!==null&&(!(file instanceof File)||!allowed.has(file.type)||file.size>8*1024*1024||file.size===0))return NextResponse.json({error:'Įkelk PNG, JPG, WEBP arba GIF iki 8 MB'},{status:400});
 const cfg=await db.guildConfig.findUnique({where:{guildId}});
 const channelId=requestedChannelId||cfg?.announcementChannelId;
 if(!channelId||!/^\d{17,20}$/.test(channelId))return NextResponse.json({error:'Pasirink Discord kanalą'},{status:400});
 try{
  const channelRes=await fetch(discordApi+'/channels/'+channelId,{headers:{Authorization:'Bot '+token},cache:'no-store'});
  if(!channelRes.ok)return NextResponse.json({error:'Botas negali pasiekti pasirinkto kanalo'},{status:400});
  const channel=await channelRes.json() as {guild_id?:string;type?:number};
  if(channel.guild_id!==guildId||![0,5].includes(channel.type??-1))return NextResponse.json({error:'Pasirink tekstinį kanalą šiame serveryje'},{status:400});
 }catch{return NextResponse.json({error:'Nepavyko patikrinti kanalo'},{status:502});}
 const embeds=[] as Record<string,unknown>[];
 if(title||description||file||imageUrl||thumbnailUrl||footer||author){
  const embed:Record<string,unknown>={color:/^#[0-9a-fA-F]{6}$/.test(color)?parseInt(color.slice(1),16):5793266};
  if(title)embed.title=title;
  if(description)embed.description=description;
  if(footer)embed.footer={text:footer};
  if(author)embed.author={name:author};
  if(thumbnailUrl)embed.thumbnail={url:thumbnailUrl};
  if(file instanceof File)embed.image={url:'attachment://'+(file.type==='image/png'?'image.png':file.type==='image/jpeg'?'image.jpg':file.type==='image/webp'?'image.webp':'image.gif')};
  else if(imageUrl)embed.image={url:imageUrl};
  embeds.push(embed);
 }
 let selectedRole='';
 if(roleId){
  try{
   const rolesRes=await fetch(discordApi+'/guilds/'+guildId+'/roles',{headers:{Authorization:'Bot '+token},cache:'no-store'});
   if(!rolesRes.ok)return NextResponse.json({error:'Nepavyko patikrinti rolės'},{status:502});
   const roles=await rolesRes.json() as Array<{id:string}>;
   if(!roles.some(r=>r.id===roleId))return NextResponse.json({error:'Rolė nerasta serveryje'},{status:400});
   selectedRole=roleId;
  }catch{return NextResponse.json({error:'Nepavyko patikrinti rolės'},{status:502});}
 }
 const mentionText=[pingEveryone?'@everyone':'',selectedRole?'<@&'+selectedRole+'>':''].filter(Boolean).join(' ');
 const components=partnershipUrl?[{type:1,components:[{type:2,style:5,label:buttonLabel,url:partnershipUrl}]}]:[];
 const payload={content:[mentionText,content].filter(Boolean).join('\n'),embeds,components,allowed_mentions:{parse:pingEveryone?['everyone']:[],roles:selectedRole?[selectedRole]:[]}};
 const data=new FormData();data.set('payload_json',JSON.stringify(payload));
 if(file instanceof File){const name=file.type==='image/png'?'image.png':file.type==='image/jpeg'?'image.jpg':file.type==='image/webp'?'image.webp':'image.gif';data.set('files[0]',file,name);}
 try{
  // Discord only permits custom sender usernames/avatars through webhooks.
  // Reuse the bot-created channel webhook instead of creating one per message.
  if(senderName||senderAvatar){
   const list=await fetch(discordApi+'/channels/'+channelId+'/webhooks',{headers:{Authorization:'Bot '+token},cache:'no-store'});
   if(!list.ok)return NextResponse.json({error:'Pasirinktame kanale botui reikia Manage Webhooks teisės, kad keistų vardą ir avatarą.'},{status:403});
   const existing=await list.json() as Array<{id:string;token?:string;name:string;type:number}>;
   let hook=existing.find(h=>h.name==='Lextrum Embed Sender'&&h.type===1&&h.token);
   if(!hook){
    const create=await fetch(discordApi+'/channels/'+channelId+'/webhooks',{method:'POST',headers:{Authorization:'Bot '+token,'Content-Type':'application/json'},body:JSON.stringify({name:'Lextrum Embed Sender'}),cache:'no-store'});
    if(!create.ok)return NextResponse.json({error:'Nepavyko sukurti Discord webhook. Patikrink Manage Webhooks leidimą.'},{status:403});
    hook=await create.json() as {id:string;token:string;name:string;type:number};
   }
   if(!hook.token)return NextResponse.json({error:'Discord negrąžino webhook tokeno.'},{status:502});
   const custom={...payload,username:senderName||'Lextrum Development',...(senderAvatar?{avatar_url:senderAvatar}:{})};
   data.set('payload_json',JSON.stringify(custom));
   const sentResponse=await fetch(discordApi+'/webhooks/'+hook.id+'/'+hook.token+'?wait=true',{method:'POST',body:data,cache:'no-store'});
   if(!sentResponse.ok)return NextResponse.json({error:'Discord atmetė webhook pranešimą ('+sentResponse.status+'). Patikrink įvestą nuotrauką.'},{status:502});
   const sent=await sentResponse.json() as {id?:string};
   await db.auditEvent.create({data:{guildId,actorId:user.id,event:'DASHBOARD_EMBED_SENDER',detail:JSON.stringify({channelId,messageId:sent.id??'',senderName:senderName||'Lextrum Development'})}}).catch(()=>{});
   return NextResponse.json({ok:true,messageId:sent.id});
  }
  const res=await fetch(discordApi+'/channels/'+channelId+'/messages',{method:'POST',headers:{Authorization:'Bot '+token},body:data,cache:'no-store'});
  if(!res.ok)return NextResponse.json({error:'Discord atmetė pranešimą ('+res.status+'). Patikrink boto leidimus, failo dydį ir URL.'},{status:502});
  const sent=await res.json() as {id?:string;components?:Array<{components?:Array<{type:number;url?:string}>}>};
  if(partnershipUrl&&!sent.components?.some(row=>row.components?.some(button=>button.type===2&&button.url===partnershipUrl))){
   return NextResponse.json({error:'Discord pranešimą paskelbė, bet Join mygtuko negrąžino. Patikrink kanalą ir pranešimą.',messageId:sent.id},{status:502});
  }
  await db.auditEvent.create({data:{guildId,actorId:user.id,event:partnershipUrl?'PARTNERSHIP_PUBLISHED':'DASHBOARD_ANNOUNCEMENT',detail:JSON.stringify({title:title||'Embed announcement',channelId,messageId:sent.id??'',partnerUrl:partnershipUrl||undefined})}}).catch(()=>{});
  return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:'Nepavyko susisiekti su Discord'},{status:502});}
}
