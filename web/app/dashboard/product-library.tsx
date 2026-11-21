'use client';
import {useEffect,useState} from 'react';

type LibraryItem={id:string;name:string;fileName:string;fileSize:number;createdAt:string};
export function ProductLibrary(){
 const [items,setItems]=useState<LibraryItem[]>([]);
 const [files,setFiles]=useState<File[]>([]);
 const [name,setName]=useState('');
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 async function refresh(){
  try{
   const response=await fetch('/api/product-library',{cache:'no-store'});
   const result=await response.json() as {items?:LibraryItem[];error?:string};
   if(response.ok)setItems(result.items??[]);
   else setMessage(result.error??'Failed to load products.');
  }catch{setMessage('Cannot connect to the product library.');}
  finally{setLoading(false);}
 }
 useEffect(()=>{void refresh();},[]);
 async function upload(){
  if(!files.length)return;
  if(files.some(f=>f.size>8*1024*1024)||files.reduce((sum,f)=>sum+f.size,0)>24*1024*1024){
   setMessage('Upload up to 8 files, 8 MB each, and 24 MB in total.');return;
  }
  setBusy(true);setMessage('');
  try{
   const data=new FormData();
   files.forEach(file=>data.append('files',file));
   if(files.length===1&&name.trim())data.set('name',name.trim());
   const res=await fetch('/api/product-library',{method:'POST',body:data});
   const json=await res.json() as {error?:string;items?:LibraryItem[]};
   if(!res.ok){setMessage(json.error??'Could not upload products.');return;}
   setMessage('✅ '+(json.items?.length??files.length)+' product file(s) added to your private library.');
   setFiles([]);setName('');
   await refresh();
  }catch{setMessage('Upload failed. Please try smaller files.');}
  finally{setBusy(false);}
 }
 return <div className="twocol embed-builder">
  <section className="panel">
   <h3>🗃️ Product Library</h3>
   <p>Įkelk parduodamų produktų failus <strong>iš anksto</strong>. Gavęs užsakymą, „Orders“ skiltyje pasirink produktą iš bibliotekos, užuot įkėlęs tą patį failą iš naujo.</p>
   <label>Pasirink kelis failus iš kompiuterio
    <input type="file" multiple onChange={e=>{
     const next=Array.from(e.target.files??[]);
     if(next.length>8||next.some(f=>!f.size||f.size>8*1024*1024)||next.reduce((sum,f)=>sum+f.size,0)>24*1024*1024){
      setMessage('Vienu kartu rinkis 1–8 failus, iki 8 MB kiekvieną ir 24 MB iš viso.');e.target.value='';return;
     }
     setFiles(next);setMessage('');
    }}/>
   </label>
   <p style={{fontSize:12}}>Palaikomi .rbxm, .rbxmx, .zip, .pdf ir kiti skaitmeninių produktų failai. Vienu kartu iki 8 failų, kiekvienas iki 8 MB (bendrai iki 24 MB). Daugiau failų gali įkelti kitais kartais.</p>
   {files.length===1&&<label>Produkto pavadinimas<input maxLength={150} value={name} placeholder={files[0].name.replace(/\.[^.]+$/,'')} onChange={e=>setName(e.target.value)}/></label>}
   {files.length>0&&<div className="ticket-section-editor"><strong>Paruošta įkelti: {files.length}</strong>
    {files.map((file,i)=><p key={i} style={{fontSize:12}}>📎 {file.name} — {(file.size/1024/1024).toFixed(2)} MB</p>)}
   </div>}
   <button type="button" className="primary" disabled={busy||files.length===0} onClick={upload}>{busy?'Įkeliama...':'⬆️ Įkelti į Product Library'}</button>
   {message&&<p role="status" style={{color:message.startsWith('✅')?'#82ddb2':'#ffc6a5'}}>{message}</p>}
   <p style={{fontSize:12}}>Failai nėra viešai atsisiunčiami. Juos gali pasirinkti tik svetainės administracija. Pirkėjui bus išsiųsta tik patvirtintam užsakymui priskirta failo kopija.</p>
  </section>
  <section className="panel">
   <h3>📦 Išsaugoti produktai ({items.length})</h3>
   <button type="button" className="secondary" onClick={()=>void refresh()}>↻ Atnaujinti sąrašą</button>
   {loading&&<p>Kraunami produktai...</p>}
   {!loading&&!items.length&&<p>Biblioteka tuščia. Įkelk pirmą produktą.</p>}
   {items.map(item=><div key={item.id} className="ticket-section-editor" style={{marginTop:12}}>
    <strong>📦 {item.name}</strong>
    <p style={{fontSize:12}}>📎 {item.fileName} — {(item.fileSize/1024/1024).toFixed(2)} MB</p>
    <p style={{fontSize:12}}>Įkelta: {new Date(item.createdAt).toLocaleString('lt-LT')}</p>
    <p style={{fontSize:12}}>Norėdamas priskirti produktą pirkėjui, atidaryk <strong>Orders</strong>.</p>
   </div>)}
  </section>
 </div>;
}
