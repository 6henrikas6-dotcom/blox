import { NextRequest,NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireAdmin,validOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { discord } from '@/lib/discord';
export async function POST(req:NextRequest){
 const admin=await requireAdmin();if(!admin)return NextResponse.json({error:'Unauthorized'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Invalid origin'},{status:403});
 let input:{channelId?:string;prize?:string;durationHours?:number;winnerCount?:number};
 try{input=await req.json();}catch{return NextResponse.json({error:'Invalid JSON'},{status:400});}
 const {channelId,prize,durationHours,winnerCount}=input;
 if(typeof channelId!=='string'||!/^\d{17,20}$/.test(channelId)||typeof prize!=='string'||!prize.trim()||prize.length>150||typeof durationHours!=='number'||!Number.isInteger(durationHours)||durationHours<1||durationHours>720||typeof winnerCount!=='number'||!Number.isInteger(winnerCount)||winnerCount<1||winnerCount>20)return NextResponse.json({error:'Patikrink prizą, kanalą, trukmę ir laimėtojų skaičių'},{status:400});
 const guildId=process.env.DISCORD_GUILD_ID!;
 try{
  const channels=await discord('/guilds/'+guildId+'/channels') as {id:string;type:number}[];
  if(!channels.some(c=>c.id===channelId&&(c.type===0||c.type===5)))return NextResponse.json({error:'Neteisingas kanalas'},{status:400});
  const id=randomUUID(),endsAt=new Date(Date.now()+durationHours*3600000);
  const msg=await discord('/channels/'+channelId+'/messages',{method:'POST',body:JSON.stringify({embeds:[{title:'🎉 GIVEAWAY',description:'**'+prize.trim()+'**\n\nLaimėtojų: '+winnerCount+'\nBaigsis: <t:'+Math.floor(endsAt.getTime()/1000)+':R>',color:10189055}],components:[{type:1,components:[{type:2,style:1,label:'🎉 Dalyvauti',custom_id:'dg_giveaway:'+id}]}],allowed_mentions:{parse:[]}})}) as {id:string};
  try{await db.giveaway.create({data:{id,guildId,channelId,messageId:msg.id,prize:prize.trim(),winnerCount,endsAt}});}
  catch(e){await discord('/channels/'+channelId+'/messages/'+msg.id,{method:'DELETE'}).catch(()=>{});throw e;}
  await db.auditEvent.create({data:{guildId,actorId:admin.id,event:'GIVEAWAY_CREATED',detail:prize.trim()}});
  return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:'Nepavyko paskelbti giveaway. Patikrink boto leidimus ir duomenų bazę.'},{status:502});}
}
