import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, validOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { discord } from '@/lib/discord';

type Section={title:string;body:string};

export async function POST(request:NextRequest){
 const admin=await requireAdmin();
 if(!admin)return NextResponse.json({error:'Tik administratoriams.'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Neleidžiama užklausos kilmė.'},{status:403});
 const guildId=process.env.DISCORD_GUILD_ID;
 const token=process.env.DISCORD_BOT_TOKEN;
 if(!guildId||!token)return NextResponse.json({error:'Discord botas nesukonfigūruotas.'},{status:500});
 let form:FormData;
 try{form=await request.formData();}catch{return NextResponse.json({error:'Neteisinga forma.'},{status:400});}
 const str=(name:string)=>{const value=form.get(name);return typeof value==='string'?value.trim():'';};
 const channelId=str('channelId'),kind=str('kind'),title=str('title'),description=str('description'),footer=str('footer'),color=str('color');
 if(kind!=='rules'&&kind!=='guidelines')return NextResponse.json({error:'Pasirink Rules arba Guidelines.'},{status:400});
 if(!/^\d{17,20}$/.test(channelId))return NextResponse.json({error:'Pasirink Discord kanalą.'},{status:400});
 if(!title||title.length>200||description.length>1800||footer.length>500)return NextResponse.json({error:'Patikrink antraštės, aprašymo ir poraštės ilgį.'},{status:400});
 const image=form.get('image');
 if(image!==null&&(!(image instanceof File)||image.size===0||image.size>8*1024*1024||!['image/png','image/jpeg','image/webp','image/gif'].includes(image.type)))
  return NextResponse.json({error:'Nuotrauka turi būti PNG, JPG, WEBP arba GIF iki 8 MB.'},{status:400});
 let sections:Section[];
 try{
  const parsed:unknown=JSON.parse(str('sections'));
  if(!Array.isArray(parsed)||!parsed.length||parsed.length>15)throw Error();
  sections=parsed.map(value=>{
   if(!value||typeof value!=='object')throw Error();
   const section=value as Record<string,unknown>;
   if(typeof section.title!=='string'||typeof section.body!=='string')throw Error();
   const name=section.title.trim(),body=section.body.trim();
   if(!name||!body||name.length>100||body.length>1200)throw Error();
   return {title:name,body};
  });
 }catch{return NextResponse.json({error:'Sukurk 1–15 taisyklių skyrių. Kiekviename reikia pavadinimo ir teksto.'},{status:400});}
 try{
  const channels=await discord('/guilds/'+guildId+'/channels') as Array<{id:string;type:number}>;
  if(!channels.some(c=>c.id===channelId&&(c.type===0||c.type===5)))
   return NextResponse.json({error:'Kanalas nepriklauso tavo serveriui.'},{status:400});
  const accent=/^#[a-fA-F0-9]{6}$/.test(color)?parseInt(color.slice(1),16):0x8066f2;
  const prefix=kind==='rules'?'📜':'📖';
  const children:Record<string,unknown>[]=[];
  const opener='**'+prefix+' '+title+'**'+(description?'\n\n'+description:'');
  if(opener.length>4000)return NextResponse.json({error:'Įžanga per ilga.'},{status:400});
  children.push({type:10,content:opener});
  if(image instanceof File){
   const ext=image.type==='image/png'?'png':image.type==='image/jpeg'?'jpg':image.type==='image/webp'?'webp':'gif';
   children.push({type:12,items:[{media:{url:'attachment://lextrum-'+kind+'.'+ext}}]});
  }
  // A V2 container supports 10 direct children: group many numbered rules in
  // text displays, instead of creating another Discord message or an embed.
  let sectionText='';
  const chunks:string[]=[];
  for(let i=0;i<sections.length;i++){
   const paragraph='§'+(Math.floor(i/10)+1)+'.'+(i%10);
   const part='**'+paragraph+' '+sections[i].title+'**\n'+sections[i].body;
   if(part.length>3900)return NextResponse.json({error:'Vienas skyrius per ilgas.'},{status:400});
   if(sectionText&&(sectionText.length+part.length+2>3900)){
    chunks.push(sectionText);sectionText=part;
   }else sectionText+=(sectionText?'\n\n':'')+part;
  }
  if(sectionText)chunks.push(sectionText);
  children.push(...chunks.map(content=>({type:10,content})));
  if(footer)children.push({type:10,content:'-# '+footer.replace(/\n/g,' ')});
  if(children.length>10)return NextResponse.json({error:'Per daug teksto vienai panelei. Sutrumpink skyrius.'},{status:400});
  const payload={flags:32768,components:[{type:17,accent_color:accent,components:children}],allowed_mentions:{parse:[]}};
  const multipart=new FormData();
  multipart.set('payload_json',JSON.stringify(payload));
  if(image instanceof File){
   const ext=image.type==='image/png'?'png':image.type==='image/jpeg'?'jpg':image.type==='image/webp'?'webp':'gif';
   multipart.set('files[0]',image,'lextrum-'+kind+'.'+ext);
  }
  const response=await fetch('https://discord.com/api/v10/channels/'+channelId+'/messages',{method:'POST',headers:{Authorization:'Bot '+token},body:multipart,cache:'no-store'});
  if(!response.ok){
   const reason=await response.json().catch(()=>null) as {message?:string}|null;
   return NextResponse.json({error:'Discord atmetė pranešimą ('+response.status+'): '+(reason?.message??'Patikrink boto leidimus.')},{status:502});
  }
  const sent=await response.json() as {id:string};
  await db.auditEvent.create({data:{guildId,actorId:admin.id,event:kind==='rules'?'RULES_PUBLISHED':'GUIDELINES_PUBLISHED',detail:JSON.stringify({messageId:sent.id,channelId})}}).catch(()=>{});
  return NextResponse.json({ok:true,messageId:sent.id,url:'https://discord.com/channels/'+guildId+'/'+channelId+'/'+sent.id});
 }catch{return NextResponse.json({error:'Nepavyko paskelbti. Patikrink Discord kanalo leidimus.'},{status:502});}
}
