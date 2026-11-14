import { NextRequest,NextResponse } from 'next/server';
import { requireAdmin,validOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { discord } from '@/lib/discord';
const keys=['welcomeChannelId','goodbyeChannelId','inviteLogChannelId','levelChannelId'] as const;
const texts=['welcomeMessage','goodbyeMessage','levelMessage'] as const;
export async function POST(req:NextRequest){
 const user=await requireAdmin();if(!user)return NextResponse.json({error:'Unauthorized'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Invalid origin'},{status:403});
 let b:Record<string,unknown>;try{b=await req.json();}catch{return NextResponse.json({error:'Invalid JSON'},{status:400});}
 if(!b||typeof b!=='object')return NextResponse.json({error:'Invalid body'},{status:400});
 const guildId=process.env.DISCORD_GUILD_ID!;
 const channels=await discord('/guilds/'+guildId+'/channels') as {id:string;type:number}[];
 const valid=new Set(channels.filter(c=>c.type===0||c.type===5).map(c=>c.id));
 for(const k of keys)if(typeof b[k]!=='string'||(b[k]!==''&&!valid.has(b[k] as string)))return NextResponse.json({error:'Invalid channel: '+k},{status:400});
 for(const k of texts)if(typeof b[k]!=='string'||!(b[k] as string).trim()||(b[k] as string).length>1500)return NextResponse.json({error:'Invalid message: '+k},{status:400});
 for(const k of ['xpEnabled','levelUpEnabled','inviteTrackingEnabled'])if(typeof b[k]!=='boolean')return NextResponse.json({error:'Invalid toggle'},{status:400});
 if(!Number.isInteger(b.xpPerMessage)||Number(b.xpPerMessage)<1||Number(b.xpPerMessage)>100||!Number.isInteger(b.xpCooldownSeconds)||Number(b.xpCooldownSeconds)<15||Number(b.xpCooldownSeconds)>3600)return NextResponse.json({error:'Invalid XP settings'},{status:400});
 const data={welcomeChannelId:(b.welcomeChannelId as string)||null,goodbyeChannelId:(b.goodbyeChannelId as string)||null,inviteLogChannelId:(b.inviteLogChannelId as string)||null,levelChannelId:(b.levelChannelId as string)||null,welcomeMessage:b.welcomeMessage as string,goodbyeMessage:b.goodbyeMessage as string,levelMessage:b.levelMessage as string,xpEnabled:b.xpEnabled as boolean,levelUpEnabled:b.levelUpEnabled as boolean,inviteTrackingEnabled:b.inviteTrackingEnabled as boolean,xpPerMessage:b.xpPerMessage as number,xpCooldownSeconds:b.xpCooldownSeconds as number};
 await db.communityAutomation.upsert({where:{guildId},create:{guildId,...data},update:data});
 await db.auditEvent.create({data:{guildId,actorId:user.id,event:'AUTOMATION_SETTINGS',detail:'Welcome, invites and XP configuration changed'}});
 return NextResponse.json({ok:true});
}
