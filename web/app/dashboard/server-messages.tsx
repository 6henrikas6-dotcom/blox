'use client';
import {useEffect,useState} from 'react';

type Channel={id:string;name:string};
type Draft={channel:string;title:string;description:string;intro:string;footer:string;color:string;bannerUrl:string;thumbnailUrl:string;buttonLabel:string;buttonUrl:string};
const initial:Draft={channel:'',title:'',description:'',intro:'',footer:'Lextrum Development',color:'#8066f2',bannerUrl:'',thumbnailUrl:'',buttonLabel:'',buttonUrl:''};
export function ServerMessages({channels}:{channels:Channel[]}){
 const [draft,setDraft]=useState<Draft>(initial);
 const [banner,setBanner]=useState<File|null>(null),[thumbnail,setThumbnail]=useState<File|null>(null);
 const [bannerPreview,setBannerPreview]=useState(''),[thumbPreview,setThumbPreview]=useState('');
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[resultUrl,setResultUrl]=useState('');
 const set=(key:keyof Draft,value:string)=>setDraft(prev=>({...prev,[key]:value}));
 useEffect(()=>{
  try{
   const saved=localStorage.getItem('lextrum-server-messages-v1');
   if(!saved)return;
   const data=JSON.parse(saved) as Partial<Draft>;
   const next={...initial};
   for(const key of Object.keys(initial) as Array<keyof Draft>){
    if(typeof data[key]==='string')next[key]=data[key];
   }
   setDraft(next);
  }catch{}
 },[]);
 useEffect(()=>{try{localStorage.setItem('lextrum-server-messages-v1',JSON.stringify(draft));}catch{}},[draft]);
 useEffect(()=>{
  if(!banner){setBannerPreview('');return;}
  const url=URL.createObjectURL(banner);setBannerPreview(url);
  return()=>URL.revokeObjectURL(url);
 },[banner]);
 useEffect(()=>{
  if(!thumbnail){setThumbPreview('');return;}
  const url=URL.createObjectURL(thumbnail);setThumbPreview(url);
  return()=>URL.revokeObjectURL(url);
 },[thumbnail]);
 const fileChanged=(value:File|null,kind:'banner'|'thumb')=>{
  if(value&&(value.size>8*1024*1024||!['image/png','image/jpeg','image/webp','image/gif'].includes(value.type))){
   setStatus('Paveikslėlis turi būti PNG, JPG, WEBP arba GIF iki 8 MB.');return;
  }
  setStatus('');
  if(kind==='banner'){setBanner(value);if(value)set('bannerUrl','');}
  else{setThumbnail(value);if(value)set('thumbnailUrl','');}
 };
 async function publish(){
  setBusy(true);setStatus('');setResultUrl('');
  try{
   const form=new FormData();
   for(const [key,value] of Object.entries({
    channelId:draft.channel,title:draft.title,description:draft.description,intro:draft.intro,footer:draft.footer,
    color:draft.color,bannerUrl:draft.bannerUrl,thumbnailUrl:draft.thumbnailUrl,
    buttonLabel:draft.buttonLabel,buttonUrl:draft.buttonUrl
   }))form.set(key,value);
   if(banner)form.set('banner',banner);
   if(thumbnail)form.set('thumbnail',thumbnail);
   const response=await fetch('/api/server-messages',{method:'POST',body:form});
   const result=await response.json() as {error?:string;url?:string};
   setStatus(response.ok?'✅ Pranešimas išsiųstas kaip Lextrum botas.':result.error??'Nepavyko išsiųsti.');
   if(response.ok)setResultUrl(result.url??'');
  }catch{setStatus('Nepavyko susisiekti su serveriu.');}
  finally{setBusy(false);}
 }
 return <div className="twocol embed-builder">
  <section className="panel">
   <h3>💬 Server Messages · Lextrum Bot</h3>
   <p>Siųsk pranešimus tiesiogiai iš tikrosios Lextrum boto paskyros, su jo vardu ir avataru. Čia nereikia įvesti ar keisti siuntėjo vardo. Įvairius siuntėjo vardus ir toliau gali naudoti atskiroje „Embed Sender“ skiltyje.</p>
   <label>Discord kanalas<select value={draft.channel} onChange={e=>set('channel',e.target.value)}><option value="">Pasirink kanalą</option>{channels.map(c=><option key={c.id} value={c.id}>#{c.name}</option>)}</select></label>
   <label>Tekstas virš pavadinimo (nebūtina)<textarea maxLength={1000} rows={3} value={draft.intro} onChange={e=>set('intro',e.target.value)}/></label>
   <label>Pavadinimas<input maxLength={256} value={draft.title} onChange={e=>set('title',e.target.value)} placeholder="Serverio naujienos"/></label>
   <label>Pranešimo tekstas<textarea maxLength={3500} rows={7} value={draft.description} onChange={e=>set('description',e.target.value)} placeholder="Įrašyk pranešimą..."/></label>
   <label>Panelės spalva<input type="color" style={{height:52}} value={draft.color} onChange={e=>set('color',e.target.value)}/></label>
   <label>Didelis baneris (PNG, JPG, WEBP, GIF iki 8 MB)<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>fileChanged(e.target.files?.[0]??null,'banner')}/></label>
   {banner&&<button type="button" className="secondary" onClick={()=>setBanner(null)}>✕ Pašalinti didelę nuotrauką</button>}
   <label>Arba didelio banerio HTTPS nuoroda<input type="url" disabled={!!banner} placeholder="https://..." value={draft.bannerUrl} onChange={e=>set('bannerUrl',e.target.value)}/></label>
   <label>Maža nuotrauka šalia teksto (nebūtina)<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>fileChanged(e.target.files?.[0]??null,'thumb')}/></label>
   {thumbnail&&<button type="button" className="secondary" onClick={()=>setThumbnail(null)}>✕ Pašalinti mažą nuotrauką</button>}
   <label>Arba mažos nuotraukos HTTPS nuoroda<input type="url" disabled={!!thumbnail} placeholder="https://..." value={draft.thumbnailUrl} onChange={e=>set('thumbnailUrl',e.target.value)}/></label>
   <label>Nuorodos mygtuko tekstas (nebūtina)<input maxLength={80} value={draft.buttonLabel} onChange={e=>set('buttonLabel',e.target.value)} placeholder="Atidaryti svetainę"/></label>
   <label>Nuorodos mygtuko HTTPS adresas (nebūtina)<input type="url" value={draft.buttonUrl} onChange={e=>set('buttonUrl',e.target.value)} placeholder="https://..."/></label>
   <label>Poraštė<input maxLength={500} value={draft.footer} onChange={e=>set('footer',e.target.value)}/></label>
   <button type="button" className="primary" disabled={busy||!draft.channel||(!draft.title.trim()&&!draft.description.trim()&&!draft.intro.trim())} onClick={publish}>{busy?'Siunčiama...':'🚀 Siųsti kaip Lextrum botą'}</button>
   {status&&<p role="status" style={{color:status.startsWith('✅')?'#82ddb2':'#ffc6a5'}}>{status}</p>}
   {resultUrl&&<p><a href={resultUrl} target="_blank" rel="noopener noreferrer" style={{color:'#bba9ff'}}>Atidaryti pranešimą Discord ↗</a></p>}
   <p style={{fontSize:12}}>Tai vienas Discord Components V2 pranešimas. Teksto juodraštis išsaugomas tavo naršyklėje, o paveikslėlį po atnaujinimo reikės pasirinkti iš naujo.</p>
  </section>
  <section className="panel preview">
   <h3>👁 Discord peržiūra · Components V2</h3>
   <div className="discord-preview">
    <div className="discord-msg-head"><img className="discord-avatar" src="/lextrum-logo.png" alt="Lextrum" style={{objectFit:'cover'}}/><strong>Lextrum <small>APP</small></strong></div>
    <div className="embed rich-embed self-role-embed" style={{borderLeftColor:draft.color}}>
     {thumbPreview||draft.thumbnailUrl?<img className="embed-thumb" src={thumbPreview||draft.thumbnailUrl} alt="Maža nuotrauka"/>:null}
     {draft.intro&&<p style={{whiteSpace:'pre-wrap'}}>{draft.intro}</p>}
     {draft.title&&<strong className="embed-title">{draft.title}</strong>}
     <p style={{whiteSpace:'pre-wrap'}}>{draft.description||'Čia bus tavo Lextrum serverio pranešimas.'}</p>
     {(bannerPreview||draft.bannerUrl)&&<img className="self-role-top-image" src={bannerPreview||draft.bannerUrl} alt="Baneris"/>}
     {draft.buttonUrl&&draft.buttonLabel&&<div className="self-role-button-preview"><span className="self-role-preview-button">{draft.buttonLabel} ↗</span></div>}
     {draft.footer&&<small className="embed-footer">{draft.footer}</small>}
    </div>
   </div>
   <p style={{fontSize:12}}>Peržiūroje naudojamas svetainės Lextrum logotipas; Discord pranešime automatiškai bus rodomas tikrasis boto vardas ir avataras.</p>
  </section>
 </div>;
}
