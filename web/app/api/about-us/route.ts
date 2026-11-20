import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,validOrigin} from '@/lib/auth';
import {discord} from '@/lib/discord';
import {db} from '@/lib/db';

type AboutSection={heading:string;text:string};
export async function POST(request:NextRequest){
 const user=await requireAdmin();
 if(!user)return NextResponse.json({error:'Tik administratoriui.'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Netinkama užklausos kilmė.'},{status:403});
 const guildId=process.env.DISCORD_GUILD_ID,token=process.env.DISCORD_BOT_TOKEN;
 if(!guildId||!token)return NextResponse.json({error:'Discord botas nesukonfigūruotas.'},{status:500});
 let form:FormData;
 try{form=await request.formData();}catch{return NextResponse.json({error:'Neteisingi formos duomenys.'},{status:400});}
 const str=(key:string)=>{const value=form.get(key);return typeof value==='string'?value.trim():'';};
 const channelId=str('channelId'),title=str('title'),intro=str('intro'),footer=str('footer'),color=str('color');
 const buttonLabel=str('buttonLabel'),buttonUrl=str('buttonUrl');
 if(!/^\d{17,20}$/.test(channelId))return NextResponse.json({error:'Pasirink Discord kanalą.'},{status:400});
 if(!title||title.length>200||intro.length>2500||footer.length>500)return NextResponse.json({error:'Patikrink pavadinimo, aprašymo ir poraštės ilgį.'},{status:400});
 if(Boolean(buttonLabel)!==Boolean(buttonUrl)||buttonLabel.length>80)return NextResponse.json({error:'Nuorodos mygtukui nurodyk pavadinimą ir HTTPS adresą.'},{status:400});
 if(buttonUrl){
  try{const url=new URL(buttonUrl);if(url.protocol!=='https:'||url.username||url.password||buttonUrl.length>500)throw Error();}catch{
   return NextResponse.json({error:'Mygtuko adresas turi būti galiojanti HTTPS nuoroda.'},{status:400});
  }
 }
 const image=form.get('image');
 if(image!==null&&(!(image instanceof File)||!image.size||image.size>8*1024*1024||!['image/png','image/jpeg','image/webp','image/gif'].includes(image.type)))
  return NextResponse.json({error:'Nuotrauka turi būti PNG, JPG, WEBP arba GIF iki 8 MB.'},{status:400});
 let sections:AboutSection[];
 try{
  const data:unknown=JSON.parse(str('sections'));
  if(!Array.isArray(data)||data.length>8)throw Error();
  sections=data.map(item=>{
   if(!item||typeof item!=='object')throw Error();
   const value=item as Record<string,unknown>;
   if(typeof value.heading!=='string'||typeof value.text!=='string')throw Error();
   const heading=value.heading.trim(),text=value.text.trim();
   if(!heading||!text||heading.length>100||text.length>1500)throw Error();
   return {heading,text};
  });
 }catch{return NextResponse.json({error:'Patikrink skyrius: iki 8 skyrių su pavadinimu ir aprašymu.'},{status:400});}
 if(!intro&&!sections.length)return NextResponse.json({error:'Įrašyk bent aprašymą arba vieną skyrių.'},{status:400});
 try{
  const channels=await discord('/guilds/'+guildId+'/channels') as Array<{id:string;type:number}>;
  if(!channels.some(c=>c.id===channelId&&(c.type===0||c.type===5)))
   return NextResponse.json({error:'Kanalas nepriklauso Lextrum serveriui.'},{status:400});
  const accent=/^#[0-9a-fA-F]{6}$/.test(color)?parseInt(color.slice(1),16):0x8066f2;
  const children:Record<string,unknown>[]=[];
  children.push({type:10,content:'**'+title+'**'+(intro?'\n\n'+intro:'')});
  if(image instanceof File){
   const ext=image.type==='image/png'?'png':image.type==='image/jpeg'?'jpg':image.type==='image/webp'?'webp':'gif';
   children.push({type:12,items:[{media:{url:'attachment://lextrum-about.'+ext}}]});
  }
  let current='';
  const chunks:string[]=[];
  for(const section of sections){
   const part='**'+section.heading+'**\n'+section.text;
   if(part.length>3900)return NextResponse.json({error:'Skyriaus tekstas per ilgas.'},{status:400});
   if(current&&current.length+part.length+2>3900){chunks.push(current);current=part;}
   else current+=(current?'\n\n':'')+part;
  }
  if(current)chunks.push(current);
  children.push(...chunks.map(content=>({type:10,content})));
  if(buttonUrl)children.push({type:1,components:[{type:2,style:5,label:buttonLabel,url:buttonUrl}]});
  if(footer)children.push({type:10,content:'-# '+footer.replace(/\n/g,' ')});
  if(children.length>10)return NextResponse.json({error:'Per daug elementų viename V2 pranešime.'},{status:400});
  const formData=new FormData();
  formData.set('payload_json',JSON.stringify({flags:32768,components:[{type:17,accent_color:accent,components:children}],allowed_mentions:{parse:[]}}));
  if(image instanceof File){
   const ext=image.type==='image/png'?'png':image.type==='image/jpeg'?'jpg':image.type==='image/webp'?'webp':'gif';
   formData.set('files[0]',image,'lextrum-about.'+ext);
  }
  const res=await fetch('https://discord.com/api/v10/channels/'+channelId+'/messages',{method:'POST',headers:{Authorization:'Bot '+token},body:formData,cache:'no-store'});
  if(!res.ok)return NextResponse.json({error:'Discord atmetė pranešimą ('+res.status+'). Patikrink kanalo leidimus ir turinį.'},{status:502});
  const posted=await res.json() as {id:string};
  await db.auditEvent.create({data:{guildId,actorId:user.id,event:'ABOUT_US_PUBLISHED',detail:JSON.stringify({channelId,messageId:posted.id})}}).catch(()=>{});
  return NextResponse.json({ok:true,url:'https://discord.com/channels/'+guildId+'/'+channelId+'/'+posted.id});
 }catch{return NextResponse.json({error:'Nepavyko susisiekti su Discord arba patikrinti kanalo.'},{status:502});}
}
