import { NextRequest,NextResponse } from 'next/server';
import { requireAdmin,validOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { discord } from '@/lib/discord';
export async function POST(req:NextRequest){
 const user=await requireAdmin();if(!user)return NextResponse.json({error:'Unauthorized'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Invalid origin'},{status:403});
 let body:unknown;try{body=await req.json();}catch{return NextResponse.json({error:'Invalid JSON'},{status:400});}
 const b=body as {title?:unknown;description?:unknown};
 if(typeof b?.title!=='string'||!b.title.trim()||b.title.length>256||typeof b.description!=='string'||!b.description.trim()||b.description.length>4000)return NextResponse.json({error:'Invalid title or message'},{status:400});
 const guildId=process.env.DISCORD_GUILD_ID!;
 const cfg=await db.guildConfig.findUnique({where:{guildId}});
 if(!cfg?.announcementChannelId)return NextResponse.json({error:'Configure announcement channel first'},{status:400});
 try{
  await discord(`/channels/${cfg.announcementChannelId}/messages`,{method:'POST',body:JSON.stringify({embeds:[{title:b.title,description:b.description,color:5793266}],allowed_mentions:{parse:[]}})});
  await db.auditEvent.create({data:{guildId,actorId:user.id,event:'DASHBOARD_ANNOUNCEMENT',detail:b.title}});
  return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:'Discord rejected the message; check bot channel permissions'},{status:502});}
}
