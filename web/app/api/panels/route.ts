import { NextRequest,NextResponse } from 'next/server';
import { requireAdmin,validOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { discord } from '@/lib/discord';
const snow=(x:unknown)=>typeof x==='string'&&/^\d{17,20}$/.test(x);
export async function POST(req:NextRequest){
 const user=await requireAdmin();if(!user)return NextResponse.json({error:'Unauthorized'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Invalid origin'},{status:403});
 let form:FormData;try{form=await req.formData();}catch{return NextResponse.json({error:'Invalid form data'},{status:400});}
 const str=(key:string)=>{const value=form.get(key);return typeof value==='string'?value:'';};
 const data={mode:str('mode'),channelId:str('channelId'),roleId:str('roleId'),categoryId:str('categoryId'),message:str('message'),title:str('title'),color:str('color'),footer:str('footer'),imageUrl:str('imageUrl'),thumbnailUrl:str('thumbnailUrl')};
 const image=form.get('image');
 if(image!==null&&(!(image instanceof File)||!['image/png','image/jpeg','image/webp','image/gif'].includes(image.type)||image.size>8*1024*1024||image.size===0))return NextResponse.json({error:'Nuotrauka turi būti PNG/JPG/WEBP/GIF iki 8 MB'},{status:400});
 const validUrl=(value:string)=>{if(!value)return true;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&value.length<=1800;}catch{return false;}};
 if(data.title.length>256||data.footer.length>2048||!validUrl(data.imageUrl)||!validUrl(data.thumbnailUrl))return NextResponse.json({error:'Patikrink embed laukus ir nuotraukų URL'},{status:400});
 const mode=data.mode;
 if(mode!=='verify'&&mode!=='ticket')return NextResponse.json({error:'Invalid panel type'},{status:400});
 const channelId=data.channelId,roleId=data.roleId,categoryId=data.categoryId,message=data.message;
 if(!snow(channelId)||!snow(roleId)||(mode==='ticket'&&!snow(categoryId))||typeof message!=='string'||!message.trim()||message.length>1500)return NextResponse.json({error:'Patikrink kanalą, rolę, kategoriją ir tekstą'},{status:400});
 const guildId=process.env.DISCORD_GUILD_ID!;
 await db.communityPanel.upsert({where:{guildId},create:{guildId},update:{}});
 const update=mode==='verify'?{verifyChannelId:channelId as string,verifiedRoleId:roleId as string,verifyMessage:message}:{ticketChannelId:channelId as string,ticketCategoryId:categoryId as string,supportRoleId:roleId as string,ticketMessage:message};
 try{
  // Validate the target channel belongs to the configured guild before posting.
  const channels=await discord('/guilds/'+guildId+'/channels') as {id:string;type:number}[];
  if(!channels.some(c=>c.id===channelId&&(c.type===0||c.type===5)))return NextResponse.json({error:'Pasirink Discord teksto kanalą'},{status:400});
  if(mode==='ticket'&&!channels.some(c=>c.id===categoryId&&c.type===4))return NextResponse.json({error:'Pasirink tinkamą ticket kategoriją'},{status:400});
  const roles=await discord('/guilds/'+guildId+'/roles') as {id:string;permissions:string;managed:boolean}[];
  const role=roles.find(r=>r.id===roleId);if(!role||role.managed||((BigInt(role.permissions)&(BigInt(8)|BigInt(32)|BigInt(268435456)|BigInt(2)|BigInt(4)))!==BigInt(0)))return NextResponse.json({error:'Pasirink paprastą, ne administratoriaus rolę'},{status:400});
  const color=/^#[0-9a-fA-F]{6}$/.test(data.color)?parseInt(data.color.slice(1),16):10189055;
  const embed:Record<string,unknown>={title:data.title|| (mode==='verify'?'Server Verification':'Support Tickets'),description:message,color};
  if(data.footer)embed.footer={text:data.footer};
  if(data.thumbnailUrl)embed.thumbnail={url:data.thumbnailUrl};
  if(image instanceof File)embed.image={url:'attachment://'+(image.type==='image/png'?'panel.png':image.type==='image/jpeg'?'panel.jpg':image.type==='image/webp'?'panel.webp':'panel.gif')};
  else if(data.imageUrl)embed.image={url:data.imageUrl};
  const payload={embeds:[embed],components:[{type:1,components:[{type:2,style:mode==='verify'?3:1,label:mode==='verify'?'Verify':'Create Ticket',custom_id:mode==='verify'?'dg_verify':'dg_ticket_open'}]}],allowed_mentions:{parse:[]}};
  const multipart=new FormData();multipart.set('payload_json',JSON.stringify(payload));
  if(image instanceof File){const ext=image.type==='image/png'?'png':image.type==='image/jpeg'?'jpg':image.type==='image/webp'?'webp':'gif';multipart.set('files[0]',image,'panel.'+ext);}
  const response=await fetch('https://discord.com/api/v10/channels/'+channelId+'/messages',{method:'POST',headers:{Authorization:'Bot '+process.env.DISCORD_BOT_TOKEN},body:multipart,cache:'no-store'});
  if(!response.ok)return NextResponse.json({error:'Discord atmetė panelį ('+response.status+'). Patikrink boto teises.'},{status:502});
  await db.communityPanel.update({where:{guildId},data:update});
  await db.auditEvent.create({data:{guildId,actorId:user.id,event:mode==='verify'?'VERIFY_PANEL_PUBLISHED':'TICKET_PANEL_PUBLISHED',detail:String(channelId)}});
  return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:'Nepavyko paskelbti. Patikrink boto teises ir kanalus.'},{status:502});}
}
