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
 const [cfg,automation,events,guild,channels,roles,emojis]=await Promise.all([
  db.guildConfig.findUnique({where:{guildId}}),
  db.communityAutomation.findUnique({where:{guildId}}),
  db.auditEvent.findMany({where:{guildId},orderBy:{createdAt:'desc'},take:30}),
  discord('/guilds/'+guildId+'?with_counts=true').catch(()=>null),
  discord('/guilds/'+guildId+'/channels').catch(()=>[]),
  discord('/guilds/'+guildId+'/roles').catch(()=>[]),
  discord('/guilds/'+guildId+'/emojis').catch(()=>[])
 ]);
 return <DashboardClient user={user} guildName={guild?.name??'Discord server'} memberCount={guild?.approximate_member_count??null} automation={{welcomeChannelId:automation?.welcomeChannelId??'',goodbyeChannelId:automation?.goodbyeChannelId??'',inviteLogChannelId:automation?.inviteLogChannelId??'',levelChannelId:automation?.levelChannelId??'',welcomeMessage:automation?.welcomeMessage??'👋 Sveikas atvykęs, {user}! Tu esi {count}-asis narys.',goodbyeMessage:automation?.goodbyeMessage??'👋 {username} paliko serverį.',levelMessage:automation?.levelMessage??'🎉 {user} pasiekė {level} lygį!',xpEnabled:automation?.xpEnabled??true,xpPerMessage:automation?.xpPerMessage??5,xpCooldownSeconds:automation?.xpCooldownSeconds??60,levelUpEnabled:automation?.levelUpEnabled??true,inviteTrackingEnabled:automation?.inviteTrackingEnabled??true}} config={{joinThreshold:cfg?.joinThreshold??8,lockdown:cfg?.lockdown??false,logChannelId:cfg?.logChannelId??'',announcementChannelId:cfg?.announcementChannelId??''}} channels={(channels as Channel[]).filter(c=>c.type===0||c.type===5).map(c=>({id:c.id,name:c.name}))} categories={(channels as Channel[]).filter(c=>c.type===4).map(c=>({id:c.id,name:c.name}))} roles={(roles as {id:string;name:string;managed:boolean}[]).filter(r=>!r.managed&&r.id!==guildId).map(r=>({id:r.id,name:r.name}))} emojis={(emojis as {id:string;name:string;animated?:boolean}[]).map(e=>({id:e.id,name:e.name,animated:!!e.animated}))} events={events.map(e=>({id:e.id,event:e.event,detail:e.detail,createdAt:e.createdAt.toISOString()}))}/>;
}
