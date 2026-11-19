import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, validOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { discord } from '@/lib/discord';

export async function POST(req: NextRequest) {
 const user=await requireAdmin();
 if(!user)return NextResponse.json({error:'Prisijunk prie Lextrum administravimo.'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Netinkama užklausos kilmė.'},{status:403});
 const guildId=process.env.DISCORD_GUILD_ID,token=process.env.DISCORD_BOT_TOKEN;
 if(!guildId||!token)return NextResponse.json({error:'Trūksta Discord boto nustatymų.'},{status:500});
 let form:FormData;
 try{form=await req.formData();}catch{return NextResponse.json({error:'Netinkami formos duomenys.'},{status:400});}
 const str=(key:string)=>{const value=form.get(key);return typeof value==='string'?value.trim():'';};
 const topImage=form.get('topImage'),bottomImage=form.get('bottomImage');
 const validImage=(v:FormDataEntryValue|null)=>v===null||(v instanceof File&&v.size>0&&v.size<=8*1024*1024&&['image/png','image/jpeg','image/webp'].includes(v.type));
 if(!validImage(topImage)||!validImage(bottomImage))return NextResponse.json({error:'Įkelk PNG, JPG arba WEBP nuotraukas iki 8 MB.'},{status:400});
 let rawOptions:unknown;
 try{rawOptions=JSON.parse(str('options'));}catch{return NextResponse.json({error:'Neteisingi rolių duomenys.'},{status:400});}
 const channelId=str('channelId'),title=str('title'),description=str('description'),footer=str('footer'),color=str('color'),imageUrl=str('imageUrl');
 const presentation=str('presentation')==='dropdown'?'dropdown':'buttons';
 const validSnow=(s:string)=>/^\d{17,20}$/.test(s);
 if(!validSnow(channelId)||!title||title.length>256||!description||description.length>4000||footer.length>2048||title.length+description.length+footer.length>5800)
  return NextResponse.json({error:'Pasirink kanalą ir užpildyk embed tekstą (iki Discord limitų).'},{status:400});
 if(imageUrl){try{const url=new URL(imageUrl);if(url.protocol!=='https:'||url.username||url.password||imageUrl.length>1800)throw Error();}catch{return NextResponse.json({error:'Nuotrauka turi būti HTTPS nuoroda.'},{status:400});}}
 if(!Array.isArray(rawOptions)||rawOptions.length<1||rawOptions.length>25)return NextResponse.json({error:'Pasirink 1–25 roles.'},{status:400});
 const options:{roleId:string;label:string;emoji:string}[]=[];
 for(const entry of rawOptions){
  if(!entry||typeof entry!=='object')return NextResponse.json({error:'Netinkamas rolės pasirinkimas.'},{status:400});
  const item=entry as Record<string,unknown>;
  const roleId=typeof item.roleId==='string'?item.roleId:'';
  const label=typeof item.label==='string'?item.label.trim():'';
  const emoji=typeof item.emoji==='string'?item.emoji.trim():'';
  if(!validSnow(roleId)||!label||label.length>100||emoji.length>80)return NextResponse.json({error:'Patikrink vaidmenų pavadinimus ir emoji.'},{status:400});
  options.push({roleId,label,emoji});
 }
 if(new Set(options.map(x=>x.roleId)).size!==options.length)return NextResponse.json({error:'Vaidmenys negali kartotis.'},{status:400});
 try{
  const [channels,roles,botUser]=await Promise.all([
   discord('/guilds/'+guildId+'/channels') as Promise<Array<{id:string;type:number}>>,
   discord('/guilds/'+guildId+'/roles') as Promise<Array<{id:string;position:number;permissions:string;managed:boolean}>>,
   discord('/users/@me') as Promise<{id:string}>,
  ]);
  if(!channels.some(c=>c.id===channelId&&(c.type===0||c.type===5)))return NextResponse.json({error:'Kanalas nepriklauso Lextrum serveriui.'},{status:400});
  const guild=await discord('/guilds/'+guildId+'/members/'+botUser.id) as {roles:string[]};
  const dangerous=BigInt(8)|BigInt(32)|BigInt(268435456)|BigInt(2)|BigInt(4)|BigInt(16)|BigInt(536870912);
  const highest=Math.max(0,...roles.filter(r=>guild.roles.includes(r.id)).map(r=>r.position));
  for(const option of options){
   const role=roles.find(r=>r.id===option.roleId);
   if(!role||role.managed||role.id===guildId||role.position>=highest||(BigInt(role.permissions)&dangerous)!==BigInt(0))
    return NextResponse.json({error:'Rolė '+option.label+' yra valdoma, per aukšta arba turi pavojingas teises. Perkelk boto rolę aukščiau ir pasirink paprastą rolę.'},{status:400});
  }
  const parseEmoji=(value:string)=>{const m=value.match(/^<(a?):([A-Za-z0-9_]+):(\d{17,20})>$/);return m?{id:m[3],name:m[2],animated:m[1]==='a'}:value?{name:value}:undefined;};
  // Three ordered embeds keep the wide top banner, text and narrow footer together in one Discord message.
  const embeds:Record<string,unknown>[]=[];
  const accent=/^#[0-9a-fA-F]{6}$/.test(color)?parseInt(color.slice(1),16):0x8066f2;
  if(topImage instanceof File||imageUrl){
   embeds.push({color:accent,image:{url:topImage instanceof File?'attachment://selfroles-top.png':imageUrl}});
  }
  const embed:Record<string,unknown>={title,description,color:accent};
  if(footer)embed.footer={text:footer};
  embeds.push(embed);
  if(bottomImage instanceof File)embeds.push({color:accent,image:{url:'attachment://selfroles-bottom.png'}});
  const components:unknown[]=presentation==='dropdown'
   ?[{type:1,components:[{type:3,custom_id:'lx_selfroles',placeholder:'🎭 Pasirink / nuimk roles',min_values:1,max_values:Math.min(25,options.length),options:options.map(o=>({label:o.label,value:o.roleId,...(parseEmoji(o.emoji)?{emoji:parseEmoji(o.emoji)}:{})}))}]}]
   :Array.from({length:Math.ceil(options.length/5)},(_,row)=>({type:1,components:options.slice(row*5,row*5+5).map(o=>({type:2,style:2,label:o.label.slice(0,80),custom_id:'lx_selfrole:'+o.roleId,...(parseEmoji(o.emoji)?{emoji:parseEmoji(o.emoji)}:{})}))}));
  const message=new FormData();
  message.set('payload_json',JSON.stringify({embeds,components,allowed_mentions:{parse:[]}}));
  if(topImage instanceof File)message.set('files[0]',topImage,'selfroles-top.png');
  if(bottomImage instanceof File)message.set('files[1]',bottomImage,'selfroles-bottom.png');
  const result=await fetch('https://discord.com/api/v10/channels/'+channelId+'/messages',{method:'POST',headers:{Authorization:'Bot '+token},body:message,cache:'no-store'});
  if(!result.ok)return NextResponse.json({error:'Discord atmetė Self-Roles panelį ('+result.status+'). Patikrink boto leidimus.'},{status:502});
  const sent=await result.json() as {id:string};
  try{
   await db.auditEvent.create({data:{guildId,event:'SELF_ROLE_PANEL:'+sent.id,actorId:user.id,detail:JSON.stringify({channelId,roleIds:options.map(o=>o.roleId)})}});
  }catch{
   await fetch('https://discord.com/api/v10/channels/'+channelId+'/messages/'+sent.id,{method:'DELETE',headers:{Authorization:'Bot '+token}}).catch(()=>{});
   return NextResponse.json({error:'Nepavyko išsaugoti panelio. Pranešimas atšauktas.'},{status:500});
  }
  return NextResponse.json({ok:true,messageId:sent.id});
 }catch{return NextResponse.json({error:'Nepavyko patikrinti Discord rolių arba paskelbti panelio.'},{status:502});}
}
