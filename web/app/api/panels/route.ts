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
 let sections:{name:string;value:string;inline?:boolean}[]=[];
 let buttons:{label:string;style:number;emoji:string;url:string}[]=[];
 try{const raw=str('buttons');if(raw){const arr:unknown=JSON.parse(raw);if(!Array.isArray(arr)||arr.length>5)throw Error();buttons=arr.map((v:unknown)=>{if(!v||typeof v!=='object')throw Error();const x=v as Record<string,unknown>;if(typeof x.label!=='string'||x.label.length>80||typeof x.style!=='number'||![1,2,3,4,5].includes(x.style)||typeof x.emoji!=='string'||x.emoji.length>100||typeof x.url!=='string')throw Error();if(x.style===5){const u=new URL(x.url);if(u.protocol!=='https:'||u.username||u.password||x.url.length>512)throw Error();}return {label:x.label,style:x.style,emoji:x.emoji,url:x.url};});}}catch{return NextResponse.json({error:'Patikrink mygtukų tekstą, spalvą ir HTTPS nuorodas'},{status:400});}
 let ticketOptions:{label:string;description:string;emoji:string;questions:{label:string;style:'short'|'paragraph';required:boolean}[]}[]=[];
 try{const raw=str('ticketOptions');if(raw){const parsed:unknown=JSON.parse(raw);if(!Array.isArray(parsed)||parsed.length<1||parsed.length>20)throw Error('invalid');ticketOptions=parsed.map((v:unknown)=>{if(!v||typeof v!=='object')throw Error('invalid');const x=v as Record<string,unknown>;if(typeof x.label!=='string'||!x.label.trim()||x.label.length>70||typeof x.description!=='string'||x.description.length>100||typeof x.emoji!=='string'||x.emoji.length>100)throw Error('invalid');const questions=Array.isArray(x.questions)?x.questions:[];if(questions.length>5)throw Error('invalid');const checked=questions.map((q:unknown)=>{if(!q||typeof q!=='object')throw Error('invalid');const f=q as Record<string,unknown>;if(typeof f.label!=='string'||!f.label.trim()||f.label.length>45||!['short','paragraph'].includes(String(f.style))||typeof f.required!=='boolean')throw Error('invalid');return {label:f.label.trim(),style:f.style as 'short'|'paragraph',required:f.required};});return {label:x.label.trim(),description:x.description.trim(),emoji:x.emoji.trim(),questions:checked};});if(new Set(ticketOptions.map(x=>x.label)).size!==ticketOptions.length)throw Error('duplicates');}}catch{return NextResponse.json({error:'Patikrink ticket pasirinkimus (1–20, unikalūs pavadinimai)'},{status:400});}
 try{const raw=str('sections');if(raw){const parsed:unknown=JSON.parse(raw);if(!Array.isArray(parsed)||parsed.length>12)throw Error('invalid');sections=parsed.map((v:unknown)=>{if(!v||typeof v!=='object')throw Error('invalid');const x=v as Record<string,unknown>;if(typeof x.name!=='string'||typeof x.value!=='string'||x.name.length>256||x.value.length>1024)throw Error('invalid');return {name:x.name.trim(),value:x.value.trim(),inline:x.inline===true};}).filter(x=>x.name&&x.value);}}catch{return NextResponse.json({error:'Neteisingos embed sekcijos'},{status:400});}
 if(image!==null&&(!(image instanceof File)||!['image/png','image/jpeg','image/webp','image/gif'].includes(image.type)||image.size>8*1024*1024||image.size===0))return NextResponse.json({error:'Nuotrauka turi būti PNG/JPG/WEBP/GIF iki 8 MB'},{status:400});
 const validUrl=(value:string)=>{if(!value)return true;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&value.length<=1800;}catch{return false;}};
 if(data.title.length>256||data.footer.length>2048||(data.title.length+data.message.length+data.footer.length+sections.reduce((n,x)=>n+x.name.length+x.value.length,0)>5800)||!validUrl(data.imageUrl)||!validUrl(data.thumbnailUrl))return NextResponse.json({error:'Patikrink embed laukus ir nuotraukų URL'},{status:400});
 const mode=data.mode;
 if(mode!=='verify'&&mode!=='ticket')return NextResponse.json({error:'Invalid panel type'},{status:400});
 const channelId=data.channelId,roleId=data.roleId,categoryId=data.categoryId,message=data.message;
 if(!snow(channelId)||!snow(roleId)||(mode==='ticket'&&!snow(categoryId))||typeof message!=='string'||!message.trim()||message.length>1500)return NextResponse.json({error:'Patikrink kanalą, rolę, kategoriją ir tekstą'},{status:400});
 const guildId=process.env.DISCORD_GUILD_ID!;
 await db.communityPanel.upsert({where:{guildId},create:{guildId},update:{}});
 const update=mode==='verify'?{verifyChannelId:channelId as string,verifiedRoleId:roleId as string,verifyMessage:message}:{ticketChannelId:channelId as string,ticketCategoryId:categoryId as string,supportRoleId:roleId as string,ticketMessage:message,ticketOptionsJson:JSON.stringify(ticketOptions)};
 try{
  // Validate the target channel belongs to the configured guild before posting.
  const channels=await discord('/guilds/'+guildId+'/channels') as {id:string;type:number}[];
  if(!channels.some(c=>c.id===channelId&&(c.type===0||c.type===5)))return NextResponse.json({error:'Pasirink Discord teksto kanalą'},{status:400});
  if(mode==='ticket'&&!channels.some(c=>c.id===categoryId&&c.type===4))return NextResponse.json({error:'Pasirink tinkamą ticket kategoriją'},{status:400});
  const roles=await discord('/guilds/'+guildId+'/roles') as {id:string;permissions:string;managed:boolean}[];
  const role=roles.find(r=>r.id===roleId);if(!role||role.managed||((BigInt(role.permissions)&(BigInt(8)|BigInt(32)|BigInt(268435456)|BigInt(2)|BigInt(4)))!==BigInt(0)))return NextResponse.json({error:'Pasirink paprastą, ne administratoriaus rolę'},{status:400});
  const color=/^#[0-9a-fA-F]{6}$/.test(data.color)?parseInt(data.color.slice(1),16):10189055;
  const embed:Record<string,unknown>={title:data.title|| (mode==='verify'?'Server Verification':'Support Tickets'),description:message,color};
  if(sections.length)embed.fields=sections;
  if(data.footer)embed.footer={text:data.footer};
  if(data.thumbnailUrl)embed.thumbnail={url:data.thumbnailUrl};
  if(image instanceof File)embed.image={url:'attachment://'+(image.type==='image/png'?'panel.png':image.type==='image/jpeg'?'panel.jpg':image.type==='image/webp'?'panel.webp':'panel.gif')};
  else if(data.imageUrl)embed.image={url:data.imageUrl};
  const parseEmoji=(value:string)=>{const m=value.match(/^<(a?):([A-Za-z0-9_]+):(\d{17,20})>$/);return m?{id:m[3],name:m[2],animated:m[1]==='a'}:value?{name:value}:undefined;};
  const selector=mode==='ticket'&&ticketOptions.length>0;
  const defaultId=mode==='verify'?'dg_verify':'dg_ticket_open';
  const selected=buttons.length?buttons:[{label:mode==='verify'?'Verify':'Create Ticket',style:mode==='verify'?3:1,emoji:'',url:''}];
  if(selected.filter(b=>b.style!==5).length>1)return NextResponse.json({error:'Viename panelyje gali būti tik vienas veiksmo mygtukas; kiti turi būti nuorodos'},{status:400});
  const actions=selected.map(b=>({type:2,style:b.style,...(b.label?{label:b.label}:{}),...(parseEmoji(b.emoji)?{emoji:parseEmoji(b.emoji)}:{}),...(b.style===5?{url:b.url}:{custom_id:defaultId})}));
  const components:unknown[]=[];
  if(selector)components.push({type:1,components:[{type:3,custom_id:'dg_ticket_select',placeholder:'Choose your option down below',min_values:1,max_values:1,options:ticketOptions.map(o=>({label:o.label,value:o.label,description:o.description,...(parseEmoji(o.emoji)?{emoji:parseEmoji(o.emoji)}:{})}))}]});
  if(!selector||buttons.length)components.push({type:1,components:actions});
  // Ticket and Verification panels use Components V2 containers.
  let payload:Record<string,unknown>={embeds:[embed],components,allowed_mentions:{parse:[]}};
  if(mode==='ticket'){
   const children:Record<string,unknown>[]=[];
   const banner=image instanceof File?'attachment://'+(image.type==='image/png'?'panel.png':image.type==='image/jpeg'?'panel.jpg':image.type==='image/webp'?'panel.webp':'panel.gif'):data.imageUrl;
   if(banner)children.push({type:12,items:[{media:{url:banner}}]});
   let text='**'+(data.title||'🎫 Lextrum Support').replace(/\*/g,'')+'**\n\n'+message;
   for(const section of sections)text+='\n\n**'+section.name.replace(/\*/g,'')+'**\n'+section.value;
   if(text.length>3900)return NextResponse.json({error:'Ticket tekstas per ilgas (iki 3900 simbolių kartu su sekcijomis).'},{status:400});
   if(data.thumbnailUrl){
    children.push({type:9,components:[{type:10,content:text}],accessory:{type:11,media:{url:data.thumbnailUrl}}});
   }else children.push({type:10,content:text});
   children.push(...components as Record<string,unknown>[]);
   if(data.footer)children.push({type:10,content:'-# '+data.footer.slice(0,1000).replace(/\n/g,' ')});
   if(children.length>10)return NextResponse.json({error:'Per daug ticket elementų viename panelyje.'},{status:400});
   payload={flags:32768,components:[{type:17,accent_color:color,components:children}],allowed_mentions:{parse:[]}};
  }
  if(mode==='verify'){
   const children:Record<string,unknown>[]=[];
   const banner=image instanceof File?'attachment://'+(image.type==='image/png'?'panel.png':image.type==='image/jpeg'?'panel.jpg':image.type==='image/webp'?'panel.webp':'panel.gif'):data.imageUrl;
   const title=(data.title||'Lextrum Verification').replace(/\*/g,'');
   const text='**'+title+'**\n\n'+message;
   if(text.length>3900)return NextResponse.json({error:'Verification tekstas per ilgas (maks. 3900 simbolių).'},{status:400});
   // Preserve the original layout: introduction, wide verification banner, then action buttons.
   if(data.thumbnailUrl)children.push({type:9,components:[{type:10,content:text}],accessory:{type:11,media:{url:data.thumbnailUrl}}});
   else children.push({type:10,content:text});
   if(banner)children.push({type:12,items:[{media:{url:banner}}]});
   children.push(...components as Record<string,unknown>[]);
   if(data.footer)children.push({type:10,content:'-# '+data.footer.slice(0,1000).replace(/\n/g,' ')});
   if(children.length>10)return NextResponse.json({error:'Per daug Verification panelio elementų.'},{status:400});
   payload={flags:32768,components:[{type:17,accent_color:color,components:children}],allowed_mentions:{parse:[]}};
  }
  const multipart=new FormData();multipart.set('payload_json',JSON.stringify(payload));
  if(image instanceof File){const ext=image.type==='image/png'?'png':image.type==='image/jpeg'?'jpg':image.type==='image/webp'?'webp':'gif';multipart.set('files[0]',image,'panel.'+ext);}
  const response=await fetch('https://discord.com/api/v10/channels/'+channelId+'/messages',{method:'POST',headers:{Authorization:'Bot '+process.env.DISCORD_BOT_TOKEN},body:multipart,cache:'no-store'});
  if(!response.ok)return NextResponse.json({error:'Discord atmetė panelį ('+response.status+'). Patikrink boto teises.'},{status:502});
  await db.communityPanel.update({where:{guildId},data:update});
  await db.auditEvent.create({data:{guildId,actorId:user.id,event:mode==='verify'?'VERIFY_PANEL_PUBLISHED':'TICKET_PANEL_PUBLISHED',detail:String(channelId)}});
  return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:'Nepavyko paskelbti. Patikrink boto teises ir kanalus.'},{status:502});}
}
