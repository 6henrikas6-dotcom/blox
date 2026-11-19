'use client';
import {useEffect,useState} from 'react';
type Channel={id:string;name:string};
type Section={title:string;body:string};
const initialRules:Section[]=[
 {title:'Pagarba bendruomenei',body:'Gerbk kitus narius, venk įžeidinėjimų ir patyčių.'},
 {title:'Jokio šlamšto',body:'Nesiųsk pasikartojančių žinučių, reklamos ar nepageidaujamų nuorodų.'},
 {title:'Laikykis Discord taisyklių',body:'Laikykis Discord naudojimo sąlygų ir serverio administratorių nurodymų.'}
];
export function RulesGuidelines({channels}:{channels:Channel[]}){
 const [kind,setKind]=useState<'rules'|'guidelines'>('rules');
 const [channel,setChannel]=useState('');
 const [title,setTitle]=useState('Lextrum Server Rules');
 const [intro,setIntro]=useState('Prieš dalyvaudamas mūsų bendruomenėje perskaityk šias taisykles.');
 const [sections,setSections]=useState<Section[]>(initialRules);
 const [footer,setFooter]=useState('Lextrum Development • Rules & Guidelines');
 const [color,setColor]=useState('#8066f2');
 const [image,setImage]=useState<File|null>(null);
 const [preview,setPreview]=useState('');
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState('');
 const [url,setUrl]=useState('');
 useEffect(()=>{
  try{
   const saved=localStorage.getItem('lextrum-rules-guidelines-v1');
   if(!saved)return;
   const obj=JSON.parse(saved) as Record<string,unknown>;
   if(obj.kind==='rules'||obj.kind==='guidelines')setKind(obj.kind);
   if(typeof obj.channel==='string')setChannel(obj.channel);
   if(typeof obj.title==='string')setTitle(obj.title);
   if(typeof obj.intro==='string')setIntro(obj.intro);
   if(typeof obj.footer==='string')setFooter(obj.footer);
   if(typeof obj.color==='string')setColor(obj.color);
   if(Array.isArray(obj.sections)&&obj.sections.every(x=>x&&typeof x.title==='string'&&typeof x.body==='string'))setSections(obj.sections as Section[]);
  }catch{}
 },[]);
 useEffect(()=>{
  try{localStorage.setItem('lextrum-rules-guidelines-v1',JSON.stringify({kind,channel,title,intro,footer,color,sections}));}catch{}
 },[kind,channel,title,intro,footer,color,sections]);
 useEffect(()=>{
  if(!image){setPreview('');return;}
  const objectUrl=URL.createObjectURL(image);
  setPreview(objectUrl);
  return ()=>URL.revokeObjectURL(objectUrl);
 },[image]);
 const update=(index:number,key:keyof Section,value:string)=>setSections(before=>before.map((section,i)=>i===index?{...section,[key]:value}:section));
 const changeKind=(next:'rules'|'guidelines')=>{
  setKind(next);
  setTitle(next==='rules'?'Lextrum Server Rules':'Lextrum Community Guidelines');
  setIntro(next==='rules'?'Prieš dalyvaudamas mūsų bendruomenėje perskaityk šias taisykles.':'Mūsų bendruomenės elgesio ir bendravimo gairės.');
 };
 async function publish(){
  if(!channel||!title.trim()||!sections.length||sections.some(s=>!s.title.trim()||!s.body.trim())){setStatus('Pasirink kanalą ir užpildyk visas taisykles.');return;}
  setBusy(true);setStatus('');setUrl('');
  try{
   const form=new FormData();
   for(const [key,value] of Object.entries({kind,channelId:channel,title,description:intro,footer,color,sections:JSON.stringify(sections)}))form.set(key,value);
   if(image)form.set('image',image);
   const result=await fetch('/api/rules',{method:'POST',body:form});
   const data=await result.json() as {error?:string;url?:string};
   setStatus(result.ok?'✅ '+(kind==='rules'?'Rules':'Guidelines')+' paskelbta Discord kanale.':data.error??'Nepavyko paskelbti.');
   if(result.ok&&data.url)setUrl(data.url);
  }catch{setStatus('Nepavyko prisijungti prie svetainės serverio.');}
  finally{setBusy(false);}
 }
 return <div className="twocol embed-builder">
  <section className="panel">
   <h3>📜 Rules & Guidelines · Components V2</h3>
   <p>Sukurk serverio taisykles arba bendruomenės gaires vienoje Discord panelėje. Skyrius, spalvą ir banerį gali keisti prieš paskelbdamas.</p>
   <label>Pranešimo tipas<select value={kind} onChange={e=>changeKind(e.target.value as 'rules'|'guidelines')}><option value="rules">📜 Rules / Taisyklės</option><option value="guidelines">📖 Guidelines / Gairės</option></select></label>
   <label>Discord kanalas<select value={channel} onChange={e=>setChannel(e.target.value)}><option value="">Pasirink kanalą</option>{channels.map(c=><option key={c.id} value={c.id}>#{c.name}</option>)}</select></label>
   <label>Panelės pavadinimas<input maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
   <label>Įžanga<textarea maxLength={1800} rows={4} value={intro} onChange={e=>setIntro(e.target.value)}/></label>
   <label>Panelės spalva<input type="color" style={{height:54,padding:6}} value={color} onChange={e=>setColor(e.target.value)}/></label>
   <label>Įkelti banerį iš kompiuterio (PNG, JPG, WEBP, GIF, iki 8 MB)
    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>{
     const file=e.target.files?.[0]??null;
     if(file&&(file.size>8*1024*1024||!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))){setStatus('Nuotrauka turi būti PNG, JPG, WEBP arba GIF iki 8 MB.');e.target.value='';return;}
     setImage(file);
    }}/></label>
   {image&&<button type="button" className="secondary" onClick={()=>setImage(null)}>✕ Pašalinti banerį</button>}
   <div className="ticket-sections"><h3>📋 Taisyklės ir gairės</h3>
    <p>Gali pridėti iki 15 skyrių. Punktai numeruojami §1.0, §1.1 ... §1.9, §2.0 vienoje V2 panelėje.</p>
    {sections.map((section,index)=><div className="ticket-section-editor" key={index}>
     <div className="ticket-section-header"><strong>§{Math.floor(index/10)+1}.{index%10} skyrius</strong><button type="button" className="secondary" disabled={sections.length<=1} onClick={()=>setSections(before=>before.filter((_,i)=>i!==index))}>✕ Pašalinti</button></div>
     <label>Pavadinimas<input maxLength={100} value={section.title} onChange={e=>update(index,'title',e.target.value)}/></label>
     <label>Tekstas<textarea rows={4} maxLength={1200} value={section.body} onChange={e=>update(index,'body',e.target.value)}/></label>
    </div>)}
    <button type="button" className="secondary" disabled={sections.length>=15} onClick={()=>setSections(before=>[...before,{title:'Nauja taisyklė',body:''}])}>+ Pridėti skyrių</button>
   </div>
   <label>Poraštė<input maxLength={500} value={footer} onChange={e=>setFooter(e.target.value)}/></label>
   <button type="button" className="primary" disabled={busy||!channel||!title.trim()||!sections.length||sections.some(s=>!s.title.trim()||!s.body.trim())} onClick={publish}>{busy?'Skelbiama...':'🚀 Paskelbti Discord kanale'}</button>
   {status&&<p role="status" style={{color:status.startsWith('✅')?'#82ddb2':'#ffc6a5'}}>{status}</p>}
   {url&&<p><a href={url} target="_blank" rel="noopener noreferrer" style={{color:'#bba9ff'}}>Atidaryti paskelbtą pranešimą Discord ↗</a></p>}
   <p style={{fontSize:12}}>Juodraštis išsaugomas tavo naršyklėje. Nuotrauką po perkrovimo reikės įkelti iš naujo. Skelbiant sukuriamas naujas pranešimas.</p>
  </section>
  <section className="panel preview">
   <h3>👁 Discord Components V2 peržiūra</h3>
   <div className="discord-preview"><div className="discord-msg-head"><span className="discord-avatar">L</span><strong>Lextrum Bot <small>BOT</small></strong></div>
    <div className="embed rich-embed self-role-embed" style={{borderLeftColor:color}}>
     <strong className="embed-title">{kind==='rules'?'📜 ':'📖 '}{title||'Rules & Guidelines'}</strong>
     {intro&&<p style={{whiteSpace:'pre-wrap'}}>{intro}</p>}
     {preview&&<img className="self-role-top-image" src={preview} alt="Rules banner"/>}
     {sections.map((section,index)=><div key={index} className="embed-field">
      <strong>§{Math.floor(index/10)+1}.{index%10} {section.title||'Skyriaus pavadinimas'}</strong><p style={{whiteSpace:'pre-wrap'}}>{section.body||'Skyriaus tekstas...'}</p>
     </div>)}
     {footer&&<small className="embed-footer">{footer}</small>}
    </div>
   </div>
  </section>
 </div>;
}
