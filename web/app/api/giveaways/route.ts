import { NextRequest,NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireAdmin,validOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { discord } from '@/lib/discord';
export async function POST(req:NextRequest){
 const admin=await requireAdmin();if(!admin)return NextResponse.json({error:'Unauthorized'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Invalid origin'},{status:403});
 let form:FormData;try{form=await req.formData();}catch{return NextResponse.json({error:'Invalid form data'},{status:400});}
 const val=(k:string)=>{const v=form.get(k);return typeof v==='string'?v:'';};
 const channelId=val('channelId'),prize=val('prize'),durationHours=Number(val('durationHours')),winnerCount=Number(val('winnerCount'));
 const title=val('title'),description=val('description'),footer=val('footer'),color=val('color'),imageUrl=val('imageUrl'),thumbnailUrl=val('thumbnailUrl');
 const image=form.get('image');
 const validUrl=(value:string)=>{if(!value)return true;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&value.length<=1800;}catch{return false;}};
 if(title.length>256||description.length>1500||footer.length>2048||!validUrl(imageUrl)||!validUrl(thumbnailUrl))return NextResponse.json({error:'Patikrink embed laukus'},{status:400});
 if(image!==null&&(!(image instanceof File)||!['image/png','image/jpeg','image/webp','image/gif'].includes(image.type)||image.size>8*1024*1024||image.size===0))return NextResponse.json({error:'Nuotrauka turi būti PNG/JPG/WEBP/GIF iki 8 MB'},{status:400});
 if(typeof channelId!=='string'||!/^\d{17,20}$/.test(channelId)||typeof prize!=='string'||!prize.trim()||prize.length>150||typeof durationHours!=='number'||!Number.isInteger(durationHours)||durationHours<1||durationHours>720||typeof winnerCount!=='number'||!Number.isInteger(winnerCount)||winnerCount<1||winnerCount>20)return NextResponse.json({error:'Patikrink prizą, kanalą, trukmę ir laimėtojų skaičių'},{status:400});
 const guildId=process.env.DISCORD_GUILD_ID!;
 try{
  const channels=await discord('/guilds/'+guildId+'/channels') as {id:string;type:number}[];
  if(!channels.some(c=>c.id===channelId&&(c.type===0||c.type===5)))return NextResponse.json({error:'Neteisingas kanalas'},{status:400});
  const id=randomUUID(),endsAt=new Date(Date.now()+durationHours*3600000);
  const accent=/^#[0-9a-fA-F]{6}$/.test(color)?parseInt(color.slice(1),16):10189055;
  const children:Record<string,unknown>[]=[];
  const content='**'+(title||'🎉 GIVEAWAY').replace(/\*/g,'')+'**\n\n'+(description?description+'\n\n':'')+'**'+prize.trim().replace(/\*/g,'')+'**\n\nLaimėtojų: '+winnerCount+'\nBaigsis: <t:'+Math.floor(endsAt.getTime()/1000)+':R>';
  if(content.length>4000)return NextResponse.json({error:'Giveaway tekstas per ilgas.'},{status:400});
  if(thumbnailUrl)children.push({type:9,components:[{type:10,content}],accessory:{type:11,media:{url:thumbnailUrl}}});
  else children.push({type:10,content});
  const ext=image instanceof File?(image.type==='image/png'?'png':image.type==='image/jpeg'?'jpg':image.type==='image/webp'?'webp':'gif'):'';
  const banner=image instanceof File?'attachment://giveaway.'+ext:imageUrl;
  if(banner)children.push({type:12,items:[{media:{url:banner}}]});
  children.push({type:1,components:[{type:2,style:1,label:'🎉 Dalyvauti • 0',custom_id:'dg_giveaway:'+id}]});
  if(footer)children.push({type:10,content:'-# '+footer.slice(0,1000).replace(/\n/g,' ')});
  const payload={flags:32768,components:[{type:17,accent_color:accent,components:children}],allowed_mentions:{parse:[]}};
  const multipart=new FormData();multipart.set('payload_json',JSON.stringify(payload));
  if(image instanceof File){const ext=image.type==='image/png'?'png':image.type==='image/jpeg'?'jpg':image.type==='image/webp'?'webp':'gif';multipart.set('files[0]',image,'giveaway.'+ext);}
  const response=await fetch('https://discord.com/api/v10/channels/'+channelId+'/messages',{method:'POST',headers:{Authorization:'Bot '+process.env.DISCORD_BOT_TOKEN},body:multipart,cache:'no-store'});
  if(!response.ok)return NextResponse.json({error:'Discord atmetė giveaway ('+response.status+')'},{status:502});
  const msg=await response.json() as {id:string};
  try{await db.giveaway.create({data:{id,guildId,channelId,messageId:msg.id,prize:prize.trim(),winnerCount,endsAt}});}
  catch(e){await discord('/channels/'+channelId+'/messages/'+msg.id,{method:'DELETE'}).catch(()=>{});throw e;}
  await db.auditEvent.create({data:{guildId,actorId:admin.id,event:'GIVEAWAY_CREATED',detail:prize.trim()}});
  return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:'Nepavyko paskelbti giveaway. Patikrink boto leidimus ir duomenų bazę.'},{status:502});}
}
