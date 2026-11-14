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
 const pingEveryone=string(form.get('everyone'))==='true';
 const roleId=string(form.get('roleId'));
 if(roleId&&!/^\d{17,20}$/.test(roleId))return NextResponse.json({error:'Netinkamas rolės ID'},{status:400});
 const file=form.get('image');
 if(title.length>256||description.length>4000||content.length>2000||footer.length>2048||author.length>256||(!title&&!description&&!content))return NextResponse.json({error:'Patikrink tekstą ir laukų ilgį'},{status:400});
 const validUrl=(s:string)=>{if(!s)return true;try{const u=new URL(s);return u.protocol==='https:'&&s.length<=1800&&!u.username&&!u.password;}catch{return false;}};
 if(!validUrl(imageUrl)||!validUrl(thumbnailUrl))return NextResponse.json({error:'Nuotraukų adresai turi būti HTTPS'},{status:400});
 if(file!==null&&(!(file instanceof File)||!allowed.has(file.type)||file.size>8*1024*1024||file.size===0))return NextResponse.json({error:'Įkelk PNG, JPG, WEBP arba GIF iki 8 MB'},{status:400});
 const cfg=await db.guildConfig.findUnique({where:{guildId}});
 if(!cfg?.announcementChannelId)return NextResponse.json({error:'Pirmiausia Security nustatymuose pasirink Announcements kanalą'},{status:400});
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
 const payload={content:[mentionText,content].filter(Boolean).join('\\n'),embeds,allowed_mentions:{parse:pingEveryone?['everyone']:[],roles:selectedRole?[selectedRole]:[]}};
 const data=new FormData();data.set('payload_json',JSON.stringify(payload));
 if(file instanceof File){const name=file.type==='image/png'?'image.png':file.type==='image/jpeg'?'image.jpg':file.type==='image/webp'?'image.webp':'image.gif';data.set('files[0]',file,name);}
 try{
  const res=await fetch(discordApi+'/channels/'+cfg.announcementChannelId+'/messages',{method:'POST',headers:{Authorization:'Bot '+token},body:data,cache:'no-store'});
  if(!res.ok)return NextResponse.json({error:'Discord atmetė pranešimą ('+res.status+'). Patikrink boto leidimus, failo dydį ir URL.'},{status:502});
  await db.auditEvent.create({data:{guildId,actorId:user.id,event:'DASHBOARD_ANNOUNCEMENT',detail:title||'Embed announcement'}}).catch(()=>{});
  return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:'Nepavyko susisiekti su Discord'},{status:502});}
}
