'use client';
import {useEffect,useState} from 'react';

type Channel={id:string;name:string};
type Settings={channelId:string;title:string;upEmoji:string;downEmoji:string;upLabel:string;downLabel:string;color:string;pendingLabel:string};
const initial:Settings={channelId:'',title:'Naujas pasiūlymas',upEmoji:'👍',downEmoji:'👎',upLabel:'Pritariu',downLabel:'Nepritariu',color:'#8066f2',pendingLabel:'⏳ Pending'};
export function Suggestions({channels}:{channels:Channel[]}){
 const [settings,setSettings]=useState<Settings>(initial);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const change=(key:keyof Settings,value:string)=>setSettings(old=>({...old,[key]:value}));
 useEffect(()=>{
  let active=true;
  (async()=>{
   try{
    const response=await fetch('/api/suggestions',{cache:'no-store'});
    const json=await response.json() as {settings?:Settings;error?:string};
    if(!active)return;
    if(response.ok&&json.settings)setSettings(json.settings);
    else setStatus(json.error??'Nepavyko nuskaityti Suggestions nustatymų.');
   }catch{if(active)setStatus('Nepavyko prisijungti prie serverio.');}
   finally{if(active)setLoading(false);}
  })();
  return()=>{active=false;};
 },[]);
 async function save(){
  setBusy(true);setStatus('');
  try{
   const response=await fetch('/api/suggestions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});
   const data=await response.json() as {error?:string};
   setStatus(response.ok?'✅ Nustatymai išsaugoti! Nauji /suggestion pranešimai turės V2 mygtukus.':data.error??'Nepavyko išsaugoti.');
  }catch{setStatus('Nepavyko prisijungti prie serverio.');}
  finally{setBusy(false);}
 }
 return <div className="twocol embed-builder">
  <section className="panel">
   <h3>💡 Suggestions · Components V2</h3>
   <p>Keisk pasiūlymų kanalo, mygtukų, emoji ir spalvų nustatymus. Nariai pasiūlymus pateikia Discord komanda <strong>/suggestion</strong>, o mygtukai rodysis toje pačioje V2 panelėje.</p>
   <label>Suggestions kanalas<select value={settings.channelId} onChange={e=>change('channelId',e.target.value)} disabled={loading}><option value="">Pasirink kanalą</option>{channels.map(c=><option key={c.id} value={c.id}>#{c.name}</option>)}</select></label>
   <label>Panelės pavadinimas<input maxLength={90} value={settings.title} onChange={e=>change('title',e.target.value)}/></label>
   <label>Panelės spalva<input type="color" style={{height:54,padding:6}} value={settings.color} onChange={e=>change('color',e.target.value)}/></label>
   <label>Pradinė būsena<input maxLength={80} value={settings.pendingLabel} onChange={e=>change('pendingLabel',e.target.value)}/></label>
   <div className="ticket-sections"><h3>👍 Balsavimo mygtukai</h3>
    <p>Galima naudoti įprastus emoji arba serverio emoji, pvz. <code>{'<:emoji:123456789012345678>'}</code>.</p>
    <label>„Pritariu“ emoji<input value={settings.upEmoji} onChange={e=>change('upEmoji',e.target.value)} maxLength={80}/></label>
    <label>„Pritariu“ tekstas<input value={settings.upLabel} onChange={e=>change('upLabel',e.target.value)} maxLength={45}/></label>
    <label>„Nepritariu“ emoji<input value={settings.downEmoji} onChange={e=>change('downEmoji',e.target.value)} maxLength={80}/></label>
    <label>„Nepritariu“ tekstas<input value={settings.downLabel} onChange={e=>change('downLabel',e.target.value)} maxLength={45}/></label>
   </div>
   <button type="button" className="primary" disabled={loading||busy||!settings.channelId} onClick={save}>{busy?'Saugoma...':'💾 Išsaugoti Suggestions nustatymus'}</button>
   {status&&<p role="status" style={{color:status.startsWith('✅')?'#82ddb2':'#ffc6a5'}}>{status}</p>}
   <p style={{fontSize:12}}>Pakeitimai taikomi naujiems pasiūlymams. Senos žinutės ir jų reakcijos išlieka nepakeistos. Vieną balsą galima pakeisti arba atšaukti.</p>
  </section>
  <section className="panel preview">
   <h3>👁 Discord V2 peržiūra</h3>
   <div className="discord-preview"><div className="discord-msg-head"><span className="discord-avatar">L</span><strong>Lextrum Bot <small>BOT</small></strong></div>
    <div className="embed rich-embed self-role-embed" style={{borderLeftColor:settings.color}}>
     <strong className="embed-title">💡 {settings.title}</strong>
     <p>Čia bus nario pasiūlymas...</p>
     <p><strong>Autorius:</strong> @Narys</p>
     <p><strong>Kodėl?</strong></p><p>Naudinga bendruomenei.</p>
     <div className="embed-field"><strong>Būsena: {settings.pendingLabel}</strong></div>
     <div className="self-role-button-preview">
      <span className="self-role-preview-button" style={{background:'#248046'}}>{settings.upEmoji} {settings.upLabel} · 0</span>
      <span className="self-role-preview-button" style={{background:'#da373c'}}>{settings.downEmoji} {settings.downLabel} · 0</span>
     </div>
    </div>
   </div>
  </section>
 </div>;
}
