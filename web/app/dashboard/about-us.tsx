'use client';
import {useEffect,useState} from 'react';

type Channel={id:string;name:string};
type Section={heading:string;text:string};
const defaultSections:Section[]=[
 {heading:'Kas mes esame?',text:'Lextrum Development – mūsų Discord bendruomenės ir projektų erdvė.'},
 {heading:'Mūsų tikslas',text:'Kurti ir tobulinti bendruomenei naudingus projektus bei patirtis.'},
 {heading:'Prisijunk prie mūsų',text:'Sek naujienas, dalyvauk diskusijose ir susipažink su bendruomene.'}
];

export function AboutUs({channels}:{channels:Channel[]}){
 const [channel,setChannel]=useState('');
 const [title,setTitle]=useState('🌐 About Us • Lextrum Development');
 const [intro,setIntro]=useState('Sveiki atvykę į Lextrum Development! Sužinok daugiau apie mūsų bendruomenę ir projektus.');
 const [sections,setSections]=useState<Section[]>(defaultSections);
 const [footer,setFooter]=useState('Lextrum Development • About Us');
 const [color,setColor]=useState('#8066f2');
 const [buttonLabel,setButtonLabel]=useState('');
 const [buttonUrl,setButtonUrl]=useState('');
 const [image,setImage]=useState<File|null>(null);
 const [preview,setPreview]=useState('');
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState('');
 const [sentUrl,setSentUrl]=useState('');
 useEffect(()=>{
  try{
   const raw=localStorage.getItem('lextrum-about-us-v1');
   if(!raw)return;
   const data=JSON.parse(raw) as Record<string,unknown>;
   if(typeof data.channel==='string')setChannel(data.channel);
   if(typeof data.title==='string')setTitle(data.title);
   if(typeof data.intro==='string')setIntro(data.intro);
   if(typeof data.footer==='string')setFooter(data.footer);
   if(typeof data.color==='string')setColor(data.color);
   if(typeof data.buttonLabel==='string')setButtonLabel(data.buttonLabel);
   if(typeof data.buttonUrl==='string')setButtonUrl(data.buttonUrl);
   if(Array.isArray(data.sections)&&data.sections.every(s=>s&&typeof s.heading==='string'&&typeof s.text==='string'))setSections(data.sections as Section[]);
  }catch{}
 },[]);
 useEffect(()=>{
  try{localStorage.setItem('lextrum-about-us-v1',JSON.stringify({channel,title,intro,sections,footer,color,buttonLabel,buttonUrl}));}catch{}
 },[channel,title,intro,sections,footer,color,buttonLabel,buttonUrl]);
 useEffect(()=>{
  if(!image){setPreview('');return;}
  const url=URL.createObjectURL(image);
  setPreview(url);
  return ()=>URL.revokeObjectURL(url);
 },[image]);
 const updateSection=(index:number,key:keyof Section,value:string)=>{
  setSections(old=>old.map((s,i)=>i===index?{...s,[key]:value}:s));
 };
 const valid=Boolean(channel&&title.trim()&&(intro.trim()||sections.length)&&sections.every(s=>s.heading.trim()&&s.text.trim())&&Boolean(buttonLabel.trim())===Boolean(buttonUrl.trim()));
 async function publish(){
  if(!valid){setStatus('Patikrink kanalą, tekstą, skyrius ir mygtuko nuorodą.');return;}
  setBusy(true);setStatus('');setSentUrl('');
  try{
   const data=new FormData();
   for(const [key,value] of Object.entries({channelId:channel,title,intro,footer,color,buttonLabel,buttonUrl,sections:JSON.stringify(sections)}))data.set(key,value);
   if(image)data.set('image',image);
   const result=await fetch('/api/about-us',{method:'POST',body:data});
   const response=await result.json() as {error?:string;url?:string};
   setStatus(result.ok?'✅ About Us paskelbta Discord kanale.':response.error??'Nepavyko paskelbti.');
   if(result.ok)setSentUrl(response.url??'');
  }catch{setStatus('Nepavyko pasiekti svetainės serverio.');}
  finally{setBusy(false);}
 }
 return <div className="twocol embed-builder">
  <section className="panel">
   <h3>🌐 About Us · Components V2</h3>
   <p>Sukurk vientisą Discord pranešimą apie Lextrum projektą. Pridėk tekstą, skyrius, banerį iš kompiuterio ir, jei reikia, nuorodos mygtuką.</p>
   <label>Discord kanalas<select value={channel} onChange={e=>setChannel(e.target.value)}><option value="">Pasirink kanalą</option>{channels.map(c=><option key={c.id} value={c.id}>#{c.name}</option>)}</select></label>
   <label>Panelės pavadinimas<input maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
   <label>Įžanga<textarea rows={5} maxLength={2500} value={intro} onChange={e=>setIntro(e.target.value)}/></label>
   <label>Akcento spalva<input type="color" style={{height:54,padding:6}} value={color} onChange={e=>setColor(e.target.value)}/></label>
   <label>Baneris iš kompiuterio (PNG, JPG, WEBP arba GIF, iki 8 MB)<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>{
    const file=e.target.files?.[0]??null;
    if(file&&(file.size>8*1024*1024||!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))){setStatus('Paveikslėlis turi būti PNG, JPG, WEBP arba GIF iki 8 MB.');e.target.value='';return;}
    setImage(file);
   }}/></label>
   {image&&<button type="button" className="secondary" onClick={()=>setImage(null)}>✕ Pašalinti nuotrauką</button>}
   <div className="ticket-sections">
    <h3>Apie mus – skyriai</h3>
    <p>Gali pridėti iki 8 skyrių, pavyzdžiui: „Kas mes esame“, „Mūsų tikslas“, „Projektai“ ar „Komanda“.</p>
    {sections.map((section,i)=><div className="ticket-section-editor" key={i}>
     <div className="ticket-section-header"><strong>Skyrius {i+1}</strong><button type="button" className="secondary" onClick={()=>setSections(old=>old.filter((_,j)=>j!==i))}>✕ Pašalinti</button></div>
     <label>Antraštė<input maxLength={100} value={section.heading} onChange={e=>updateSection(i,'heading',e.target.value)}/></label>
     <label>Aprašymas<textarea rows={5} maxLength={1500} value={section.text} onChange={e=>updateSection(i,'text',e.target.value)}/></label>
    </div>)}
    <button type="button" className="secondary" disabled={sections.length>=8} onClick={()=>setSections(old=>[...old,{heading:'Naujas skyrius',text:''}])}>+ Pridėti skyrių</button>
   </div>
   <label>Nuorodos mygtuko tekstas (nebūtina)<input maxLength={80} placeholder="Apsilankyti svetainėje" value={buttonLabel} onChange={e=>setButtonLabel(e.target.value)}/></label>
   <label>Nuorodos mygtuko HTTPS adresas (nebūtina)<input type="url" placeholder="https://..." value={buttonUrl} onChange={e=>setButtonUrl(e.target.value)}/></label>
   <label>Poraštė<input maxLength={500} value={footer} onChange={e=>setFooter(e.target.value)}/></label>
   <button type="button" className="primary" disabled={busy||!valid} onClick={publish}>{busy?'Skelbiama...':'🚀 Paskelbti About Us Discord kanale'}</button>
   {status&&<p role="status" style={{color:status.startsWith('✅')?'#82ddb2':'#ffc6a5'}}>{status}</p>}
   {sentUrl&&<p><a href={sentUrl} target="_blank" rel="noopener noreferrer" style={{color:'#bba9ff'}}>Atidaryti Discord pranešimą ↗</a></p>}
   <p style={{fontSize:12}}>Tekstas išsaugomas šioje naršyklėje; nuotrauką po perkrovimo reikės pasirinkti iš naujo. Automatiškai nieko neskelbiama.</p>
  </section>
  <section className="panel preview">
   <h3>👁 Discord Components V2 peržiūra</h3>
   <div className="discord-preview">
    <div className="discord-msg-head"><span className="discord-avatar">L</span><strong>Lextrum Bot <small>BOT</small></strong></div>
    <div className="embed rich-embed self-role-embed" style={{borderLeftColor:color}}>
     <strong className="embed-title">{title||'About Us'}</strong>
     {intro&&<p style={{whiteSpace:'pre-wrap'}}>{intro}</p>}
     {preview&&<img className="self-role-top-image" src={preview} alt="About Us baneris"/>}
     {sections.map((section,i)=><div className="embed-field" key={i}><strong>{section.heading||'Skyriaus antraštė'}</strong><p style={{whiteSpace:'pre-wrap'}}>{section.text||'Aprašymas...'}</p></div>)}
     {buttonUrl&&buttonLabel&&<div className="self-role-button-preview"><span className="self-role-preview-button">{buttonLabel} ↗</span></div>}
     {footer&&<small className="embed-footer">{footer}</small>}
    </div>
   </div>
  </section>
 </div>;
}
