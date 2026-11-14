import { NextRequest,NextResponse } from 'next/server';
import { requireAdmin,validOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
export async function POST(req:NextRequest){
 const user=await requireAdmin();if(!user)return NextResponse.json({error:'Unauthorized'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Invalid origin'},{status:403});
 let body:unknown;try{body=await req.json();}catch{return NextResponse.json({error:'Invalid JSON'},{status:400});}
 if(!body||typeof body!=='object')return NextResponse.json({error:'Invalid input'},{status:400});
 const b=body as Record<string,unknown>;
 const threshold=b.joinThreshold;
 if(typeof threshold!=='number'||!Number.isInteger(threshold)||threshold<3||threshold>100)return NextResponse.json({error:'Threshold must be 3–100'},{status:400});
 const snowflake=(v:unknown)=>v===''||v===null||typeof v==='string'&&/^\d{17,20}$/.test(v);
 if(!snowflake(b.logChannelId)||!snowflake(b.announcementChannelId))return NextResponse.json({error:'Invalid channel ID'},{status:400});
 const guildId=process.env.DISCORD_GUILD_ID!;
 const data={joinThreshold:threshold,logChannelId:(b.logChannelId||null) as string|null,announcementChannelId:(b.announcementChannelId||null) as string|null};
 await db.guildConfig.upsert({where:{guildId},create:{guildId,...data},update:data});
 await db.auditEvent.create({data:{guildId,actorId:user.id,event:'DASHBOARD_SETTINGS',detail:'Updated raid threshold and channels'}});
 return NextResponse.json({ok:true});
}
