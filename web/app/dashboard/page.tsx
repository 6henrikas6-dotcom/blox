import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { discord } from '@/lib/discord';
import DashboardClient from './ui';
export const dynamic='force-dynamic';
type Channel={id:string;name:string;type:number};
export default async function Dashboard(){
 const user=await requireAdmin();if(!user)redirect('/');
 const guildId=process.env.DISCORD_GUILD_ID!;
 const [cfg,automation,panel,events,guild,channels,roles,emojis,tickets,giveawayCount,activeGiveaways,memberInviteCount]=await Promise.all([
  db.guildConfig.findUnique({where:{guildId}}),
  db.communityAutomation.findUnique({where:{guildId}}),
  db.communityPanel.findUnique({where:{guildId}}),
  db.auditEvent.findMany({where:{guildId},orderBy:{createdAt:'desc'},take:30}),
  discord('/guilds/'+guildId+'?with_counts=true').catch(()=>null),
  discord('/guilds/'+guildId+'/channels').catch(()=>[]),
  discord('/guilds/'+guildId+'/roles').catch(()=>[]),
  discord('/guilds/'+guildId+'/emojis').catch(()=>[]),
  db.supportTicket.findMany({where:{guildId},select:{claimedById:true,closedById:true,createdAt:true,closedAt:true,feedbackRating:true,status:true}}),
  db.giveaway.count({where:{guildId}}),
  db.giveaway.count({where:{guildId,ended:false}}),
  db.memberInvite.count({where:{guildId}})
 ]);
 return <DashboardClient analytics={{ticketTotal:tickets.length,ticketOpen:tickets.filter(t=>t.status==='open').length,ticketClosed:tickets.filter(t=>t.closedAt).length,averageRating:(()=>{const a=tickets.filter(t=>t.feedbackRating!==null);return a.length?Math.round(a.reduce((sum,t)=>sum+(t.feedbackRating??0),0)/a.length*10)/10:null;})(),giveawayCount,activeGiveaways,memberInviteCount,staff:Object.values(tickets.reduce((acc,t)=>{const id=t.claimedById||t.closedById;if(!id)return acc;const row=acc[id]??{id,claimed:0,closed:0,ratingTotal:0,ratingCount:0};if(t.claimedById===id)row.claimed++;if(t.closedAt)row.closed++;if(t.feedbackRating!==null){row.ratingTotal+=t.feedbackRating;row.ratingCount++;}acc[id]=row;return acc;},{} as Record<string,{id:string;claimed:number;closed:number;ratingTotal:number;ratingCount:number}>)).sort((a,b)=>b.closed-a.closed)}} feedbackChannelId={panel?.feedbackChannelId??''} savedTicket={{channelId:panel?.ticketChannelId??'',categoryId:panel?.ticketCategoryId??'',roleId:panel?.supportRoleId??'',message:panel?.ticketMessage??'',optionsJson:panel?.ticketOptionsJson??''}} user={user} guildName={guild?.name??'Discord server'} memberCount={guild?.approximate_member_count??null} automation={{welcomeChannelId:automation?.welcomeChannelId??'',goodbyeChannelId:automation?.goodbyeChannelId??'',inviteLogChannelId:automation?.inviteLogChannelId??'',levelChannelId:automation?.levelChannelId??'',welcomeMessage:automation?.welcomeMessage??'👋 Sveikas atvykęs, {user}! Tu esi {count}-asis narys.',goodbyeMessage:automation?.goodbyeMessage??'👋 {username} paliko serverį.',levelMessage:automation?.levelMessage??'🎉 {user} pasiekė {level} lygį!',xpEnabled:automation?.xpEnabled??true,xpPerMessage:automation?.xpPerMessage??5,xpCooldownSeconds:automation?.xpCooldownSeconds??60,levelUpEnabled:automation?.levelUpEnabled??true,inviteTrackingEnabled:automation?.inviteTrackingEnabled??true}} config={{joinThreshold:cfg?.joinThreshold??8,lockdown:cfg?.lockdown??false,logChannelId:cfg?.logChannelId??'',announcementChannelId:cfg?.announcementChannelId??''}} channels={(channels as Channel[]).filter(c=>c.type===0||c.type===5||c.type===15).map(c=>({id:c.id,name:c.name,type:c.type}))} categories={(channels as Channel[]).filter(c=>c.type===4).map(c=>({id:c.id,name:c.name}))} roles={(roles as {id:string;name:string;managed:boolean}[]).filter(r=>!r.managed&&r.id!==guildId).map(r=>({id:r.id,name:r.name}))} emojis={(emojis as {id:string;name:string;animated?:boolean}[]).map(e=>({id:e.id,name:e.name,animated:!!e.animated}))} events={events.map(e=>({id:e.id,event:e.event,detail:e.detail,createdAt:e.createdAt.toISOString()}))}/>;
}
