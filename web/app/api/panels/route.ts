import { NextRequest,NextResponse } from 'next/server';
import { requireAdmin,validOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { discord } from '@/lib/discord';
const snow=(x:unknown)=>typeof x==='string'&&/^\d{17,20}$/.test(x);
export async function POST(req:NextRequest){
 const user=await requireAdmin();if(!user)return NextResponse.json({error:'Unauthorized'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Invalid origin'},{status:403});
 let data:Record<string,unknown>;
 try{data=await req.json();}catch{return NextResponse.json({error:'Invalid JSON'},{status:400});}
 const mode=data.mode;
 if(mode!=='verify'&&mode!=='ticket')return NextResponse.json({error:'Invalid panel type'},{status:400});
 const channelId=data.channelId,roleId=data.roleId,categoryId=data.categoryId,message=data.message;
 if(!snow(channelId)||!snow(roleId)||(mode==='ticket'&&!snow(categoryId))||typeof message!=='string'||!message.trim()||message.length>1500)return NextResponse.json({error:'Patikrink kanalą, rolę, kategoriją ir tekstą'},{status:400});
 const guildId=process.env.DISCORD_GUILD_ID!;
 const cfg=await db.communityPanel.upsert({where:{guildId},create:{guildId},update:{}});
 const update=mode==='verify'?{verifyChannelId:channelId as string,verifiedRoleId:roleId as string,verifyMessage:message}:{ticketChannelId:channelId as string,ticketCategoryId:categoryId as string,supportRoleId:roleId as string,ticketMessage:message};
 try{
  // Validate the target channel belongs to the configured guild before posting.
  const channels=await discord('/guilds/'+guildId+'/channels') as {id:string;type:number}[];
  if(!channels.some(c=>c.id===channelId&&(c.type===0||c.type===5)))return NextResponse.json({error:'Pasirink Discord teksto kanalą'},{status:400});
  if(mode==='ticket'&&!channels.some(c=>c.id===categoryId&&c.type===4))return NextResponse.json({error:'Pasirink tinkamą ticket kategoriją'},{status:400});
  const roles=await discord('/guilds/'+guildId+'/roles') as {id:string;permissions:string;managed:boolean}[];
  const role=roles.find(r=>r.id===roleId);if(!role||role.managed||((BigInt(role.permissions)&(8n|32n|268435456n|2n|4n))!==0n))return NextResponse.json({error:'Pasirink paprastą, ne administratoriaus rolę'},{status:400});
  await db.communityPanel.update({where:{guildId},data:update});
  await discord('/channels/'+channelId+'/messages',{method:'POST',body:JSON.stringify({embeds:[{title:mode==='verify'?'Server Verification':'Support Tickets',description:message,color:10189055}],components:[{type:1,components:[{type:2,style:mode==='verify'?3:1,label:mode==='verify'?'Verify':'Create Ticket',custom_id:mode==='verify'?'dg_verify':'dg_ticket_open'}]}],allowed_mentions:{parse:[]}})});
  await db.auditEvent.create({data:{guildId,actorId:user.id,event:mode==='verify'?'VERIFY_PANEL_PUBLISHED':'TICKET_PANEL_PUBLISHED',detail:String(channelId)}});
  return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:'Nepavyko paskelbti. Patikrink boto teises ir kanalus.'},{status:502});}
}
