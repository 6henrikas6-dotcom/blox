'use client';
import {useEffect,useState} from 'react';
type Item={id:string;productNumber:string;productName:string;fileName:string|null;deliveredAt:string|null;deliveredTo:string|null};
type Order={id:string;orderNumber:string;buyerId:string|null;productName:string;createdAt:string;items:Item[]};
export function Orders(){
 const [orders,setOrders]=useState<Order[]>([]);
 const [number,setNumber]=useState(''),[productNumber,setProductNumber]=useState('1'),[productName,setProductName]=useState('');
 const [buyerId,setBuyerId]=useState(''),[file,setFile]=useState<File|null>(null);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[status,setStatus]=useState('');
 async function refresh(){
  try{
   const response=await fetch('/api/orders',{cache:'no-store'});
   const data=await response.json() as {orders?:Order[];error?:string};
   if(response.ok)setOrders(data.orders??[]);
   else setStatus(data.error??'Nepavyko gauti užsakymų.');
  }catch{setStatus('Nepavyko susisiekti su svetaine.');}
  finally{setLoading(false);}
 }
 useEffect(()=>{void refresh();},[]);
 async function save(){
  setBusy(true);setStatus('');
  try{
   const data=new FormData();
   for(const [key,value] of Object.entries({orderNumber:number,productNumber,productName,buyerId}))data.set(key,value);
   if(file)data.set('file',file);
   const response=await fetch('/api/orders',{method:'POST',body:data});
   const json=await response.json() as {error?:string};
   if(response.ok){setStatus('✅ Užsakymas / prekė išsaugota!');setFile(null);await refresh();}
   else setStatus(json.error??'Nepavyko išsaugoti.');
  }catch{setStatus('Nepavyko įkelti failo. Bandyk mažesnį nei 8 MB failą.');}
  finally{setBusy(false);}
 }
 return <div className="twocol embed-builder">
  <section className="panel">
   <h3>📦 Orders · Lextrum Delivery</h3>
   <p>Sukurk užsakymą, priskirk <strong>pirkėjo Discord ID</strong> ir įkelk prekę iš savo kompiuterio. Failą atiduoda tik botas per privatų DM, nariui patvirtinus neplatinimo taisykles.</p>
   <label>Order Number (užsakymo numeris)<input maxLength={40} value={number} placeholder="LEX-1001" onChange={e=>setNumber(e.target.value)}/></label>
   <label>Product Number (prekės numeris)<input maxLength={30} value={productNumber} placeholder="1" onChange={e=>setProductNumber(e.target.value)}/></label>
   <label>Product Name (prekės pavadinimas)<input maxLength={150} value={productName} placeholder="Roblox Police Vehicle" onChange={e=>setProductName(e.target.value)}/></label>
   <label>Pirkėjo Discord User ID<input value={buyerId} maxLength={20} placeholder="123456789012345678" onChange={e=>setBuyerId(e.target.value.replace(/\s/g,''))}/></label>
   <p style={{fontSize:12}}>Be pirkėjo ID užsakymas nebus atiduodamas – taip apsaugosime prekę nuo svetimų asmenų. Galima sukurti užsakymą, o ID įrašyti vėliau.</p>
   <label>Prekės failas (.rbxm, .rbxmx, .zip, .pdf ir kt.; iki 8 MB)<input type="file" onChange={e=>{
    const f=e.target.files?.[0]??null;
    if(f&&f.size>8*1024*1024){setStatus('Failas per didelis. Maksimaliai 8 MB.');e.target.value='';return;}
    setFile(f);
   }}/></label>
   {file&&<p>📎 Pasirinkta: <strong>{file.name}</strong> ({(file.size/1024/1024).toFixed(2)} MB)</p>}
   <button className="primary" type="button" disabled={busy||!number.trim()||!productNumber.trim()||!productName.trim()} onClick={save}>{busy?'Saugoma...':'💾 Išsaugoti užsakymą ir failą'}</button>
   {status&&<p role="status" style={{color:status.startsWith('✅')?'#82ddb2':'#ffc6a5'}}>{status}</p>}
   <p style={{fontSize:12}}>Įrašius esamą Order Number ir naują Product Number galima pridėti dar vieną prekę prie to paties užsakymo. Failai laikomi privačioje PostgreSQL duomenų bazėje, o ne viešame GitHub ar svetainės kataloge.</p>
  </section>
  <section className="panel">
   <h3>📋 Užsakymai</h3>
   <button type="button" className="secondary" onClick={()=>void refresh()}>↻ Atnaujinti sąrašą</button>
   {loading&&<p>Kraunami užsakymai...</p>}
   {!loading&&!orders.length&&<p>Kol kas nėra užsakymų.</p>}
   {orders.map(order=><div key={order.id} className="ticket-section-editor" style={{marginTop:14}}>
    <h3>📦 #{order.orderNumber}</h3>
    <p><strong>{order.productName}</strong></p>
    <p>Pirkėjas: {order.buyerId?'Discord ID '+order.buyerId:'⚠️ Nepriskirtas'}</p>
    {order.items.map(item=><div key={item.id} style={{padding:'8px 0',borderTop:'1px solid #34364b'}}>
     <strong>Produktas #{item.productNumber} — {item.productName}</strong>
     <p style={{fontSize:12}}>📎 {item.fileName??'Failas dar neįkeltas'}</p>
     <p style={{fontSize:12}}>{item.deliveredAt?'✅ Išsiųsta į DM ('+new Date(item.deliveredAt).toLocaleString('lt-LT')+')':'⏳ Neatsiimta'}</p>
     <button type="button" className="secondary" onClick={()=>{setNumber(order.orderNumber);setBuyerId(order.buyerId??'');setProductNumber(item.productNumber);setProductName(item.productName);setFile(null);}}>Redaguoti / įkelti failą</button>
    </div>)}
    <button type="button" className="secondary" onClick={()=>{setNumber(order.orderNumber);setBuyerId(order.buyerId??'');setProductNumber(String(order.items.length+1));setProductName('');setFile(null);}}>+ Naujas produktas</button>
   </div>)}
  </section>
 </div>;
}
