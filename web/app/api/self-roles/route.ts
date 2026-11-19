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
 let input:unknown;
 try {input=await req.json();}catch{return NextResponse.json({error:'Netinkami duomenys.'},{status:400});}
 if(!input||typeof input!=='object')return NextResponse.json({error:'Netinkami duomenys.'},{status:400});
 const data=input as Record<string,unknown>;
 const str=(key:string)=>typeof data[key]==='string'?(data[key] as string).trim():'';
 const channelId=str('channelId'),title=str('title'),description=str('description'),footer=str('footer'),color=str('color'),imageUrl=str('imageUrl');
 const validSnow=(s:string)=>/^\d{17,20}$/.test(s);
 if(!validSnow(channelId)||!title||title.length>256||!description||description.length>4000||footer.length>2048||title.length+description.length+footer.length>5800)
  return NextResponse.json({error:'Pasirink kanalą ir užpildyk embed tekstą (iki Discord limitų).'},{status:400});
 if(imageUrl){try{const url=new URL(imageUrl);if(url.protocol!=='https:'||url.username||url.password||imageUrl.length>1800)throw Error();}catch{return NextResponse.json({error:'Nuotrauka turi būti HTTPS nuoroda.'},{status:400});}}
 if(!Array.isArray(data.options)||data.options.length<1||data.options.length>25)return NextResponse.json({error:'Pasirink 1–25 roles.'},{status:400});
 const options:{roleId:string;label:string;emoji:string}[]=[];
 for(const entry of data.options){
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
  const embed:Record<string,unknown>={title,description,color:/^#[0-9a-fA-F]{6}$/.test(color)?parseInt(color.slice(1),16):0x8066f2};
  if(footer)embed.footer={text:footer};
  if(imageUrl)embed.image={url:imageUrl};
  const components=[{type:1,components:[{type:3,custom_id:'lx_selfroles',placeholder:'🎭 Pasirink / nuimk roles',min_values:1,max_values:Math.min(25,options.length),options:options.map(o=>({label:o.label,value:o.roleId,...(parseEmoji(o.emoji)?{emoji:parseEmoji(o.emoji)}:{})}))}]}];
  const result=await fetch('https://discord.com/api/v10/channels/'+channelId+'/messages',{method:'POST',headers:{Authorization:'Bot '+token,'Content-Type':'application/json'},body:JSON.stringify({embeds:[embed],components,allowed_mentions:{parse:[]}}),cache:'no-store'});
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
