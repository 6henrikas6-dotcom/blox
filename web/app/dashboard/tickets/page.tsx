import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
export const dynamic='force-dynamic';
export default async function TicketHistory({searchParams}:{searchParams:Promise<{ticket?:string}>}){
 const user=await requireAdmin();if(!user)redirect('/');
 const guildId=process.env.DISCORD_GUILD_ID!;
 const {ticket:ticketId}=await searchParams;
 const tickets=await db.supportTicket.findMany({where:{guildId},orderBy:{createdAt:'desc'},take:100});
 const selected=ticketId?tickets.find(t=>t.id===ticketId):undefined;
 return <main style={{maxWidth:1100,margin:'32px auto',padding:24,color:'#eee',fontFamily:'system-ui'}}>
 <Link href="/dashboard" style={{color:'#bba9ff'}}>← Dashboard</Link>
 <h1>🎫 Ticket istorija ir įvertinimai</h1><p>Uždaryti ticketai ir jų transcriptai saugomi duomenų bazėje. Tik serverio administratoriams.</p>
 <div style={{display:'grid',gridTemplateColumns:'minmax(260px,1fr) 2fr',gap:20}}>
 <section>{tickets.map(t=><div key={t.id} style={{background:'#242430',padding:14,marginBottom:8,borderRadius:8}}>
 <Link href={'/dashboard/tickets?ticket='+encodeURIComponent(t.id)} style={{color:'#ddd',fontWeight:700}}>{t.id.slice(0,14)}</Link>
 <div>Klientas: {t.userId}</div><div>{t.status==='closed'?'🔒 Uždarytas':'🟢 Atidarytas'} • {t.feedbackRating? t.feedbackRating+'/5 ⭐':'Neįvertintas'}</div>
 <small>{t.createdAt.toLocaleString('lt-LT')}</small></div>)}</section>
 <section style={{background:'#242430',padding:20,borderRadius:10}}>
 {selected?<><h2>Ticket {selected.id}</h2><p>Klientas: {selected.userId} • Support: {selected.claimedById??'Nepriskirtas'} • Uždaryta: {selected.closedAt?.toLocaleString('lt-LT')??'Ne'}</p>
 <p>Įvertinimas: {selected.feedbackRating?selected.feedbackRating+'/5 ⭐':'Dar nėra'}</p>
 <h3>Transcript</h3><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:13,lineHeight:1.5}}>{selected.transcriptText??'Transcript dar nėra (ticketas atidarytas arba uždarytas prieš šią funkciją).'}</pre>
 </>:<p>Pasirink ticketą, kad matytum jo istoriją ir transcriptą.</p>}
 </section></div></main>;
}
