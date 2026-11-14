import { NextRequest,NextResponse } from 'next/server';
import { requireAdmin,validOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { discord } from '@/lib/discord';

export async function POST(req:NextRequest){
 const admin=await requireAdmin();
 if(!admin)return NextResponse.json({error:'Unauthorized'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Invalid origin'},{status:403});
 const guildId=process.env.DISCORD_GUILD_ID;
 if(!guildId)return NextResponse.json({error:'Server is not configured'},{status:500});
 const body=await req.json().catch(()=>null);
 const channelId=body?.channelId;
 if(typeof channelId!=='string'||!/^\d{17,20}$/.test(channelId))return NextResponse.json({error:'Pasirink feedback kanalą'},{status:400});
 try{
  const channels=await discord('/guilds/'+guildId+'/channels') as {id:string;type:number}[];
  if(!channels.some(c=>c.id===channelId&&(c.type===0||c.type===5)))return NextResponse.json({error:'Kanalas nerastas serveryje'},{status:400});
  await db.communityPanel.upsert({where:{guildId},create:{guildId,feedbackChannelId:channelId},update:{feedbackChannelId:channelId}});
  return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:'Nepavyko išsaugoti feedback kanalo'},{status:500});}
}
