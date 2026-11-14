import Link from 'next/link';
import { session } from '@/lib/auth';
export default async function Home({searchParams}:{searchParams:Promise<{error?:string}>}){
 const user=await session(),params=await searchParams;
 return <main className="landing"><div className="hero"><img className="landing-logo" src="/lextrum-logo.png" alt="Lextrum logo"/><div className="eyebrow">PRIVATE DISCORD CONTROL CENTER</div><h1>Dev<span>Guard</span></h1><p>Valdyk Discord serverio saugumą, naujienas ir administravimo veiksmus vienoje vietoje.</p>{params.error&&<p className="error">Prisijungimas nepavyko: {params.error}</p>}<Link className="primary" href={user?'/dashboard':'/api/auth/login'}>{user?'Atidaryti valdymo skydelį':'Prisijungti su Discord'} →</Link><div className="fine">Tik patvirtintiems serverio administratoriams</div></div></main>;
}
