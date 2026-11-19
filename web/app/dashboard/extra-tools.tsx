'use client';
import {useState} from 'react';
type Item={id:string;name:string};
type Shared={channels:Item[];roles:Item[]};
const inputHint={fontSize:12,color:'#9aa1ba'};
export function EmbedSender({channels}:Shared){
 const [channel,setChannel]=useState(''),[username,setUsername]=useState('Lextrum Development'),[avatar,setAvatar]=useState('');
 const [title,setTitle]=useState(''),[body,setBody]=useState(''),[content,setContent]=useState(''),[footer,setFooter]=useState('');
 const [image,setImage]=useState(''),[thumb,setThumb]=useState(''),[color,setColor]=useState('#8066f2');
 const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
 async function send(){
  setBusy(true);setStatus('');
  try{
   const f=new FormData();for(const [k,v] of Object.entries({channelId:channel,username,avatarUrl:avatar,title,description:body,content,footer,imageUrl:image,thumbnailUrl:thumb,color}))f.set(k,v);
   if(file)f.set('image',file);
   const res=await fetch('/api/announce',{method:'POST',body:f});const json=await res.json();
   setStatus(res.ok?'✅ Pranešimas išsiųstas į Discord':json.error||'Nepavyko išsiųsti');
  }catch{setStatus('Nepavyko prisijungti prie svetainės serverio.');}finally{setBusy(false);}
 }
 return <div className="twocol embed-builder"><section className="panel"><h3>✉️ Embed Sender</h3><p>Sukurk ir išsiųsk Discord pranešimą su pasirinktu siuntėjo vardu, avataru, spalva ir nuotrauka. Vardo ir avataro keitimui botui reikia Manage Webhooks teisės pasirinktame kanale.</p>
 <label>Kanalas<select value={channel} onChange={e=>setChannel(e.target.value)}><option value="">Pasirink kanalą</option>{channels.map(x=><option key={x.id} value={x.id}>#{x.name}</option>)}</select></label>
 <label>Siuntėjo vardas<input maxLength={80} value={username} onChange={e=>setUsername(e.target.value)} placeholder="Lextrum Development"/></label>
 <label>Siuntėjo avataro nuoroda (HTTPS)<input value={avatar} type="url" onChange={e=>setAvatar(e.target.value)} placeholder="https://.../avatar.png"/></label>
 <label>Tekstas virš embed<textarea rows={3} maxLength={2000} value={content} onChange={e=>setContent(e.target.value)}/></label>
 <label>Embed pavadinimas<input maxLength={256} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <label>Embed aprašymas<textarea rows={7} maxLength={4000} value={body} onChange={e=>setBody(e.target.value)}/></label>
 <label>Spalva<input type="color" style={{height:52}} value={color} onChange={e=>setColor(e.target.value)}/></label>
 <label>Didelės nuotraukos nuoroda<input type="url" value={image} onChange={e=>setImage(e.target.value)} placeholder="https://.../banner.png"/></label>
 <label>Arba įkelk nuotrauką<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
 <label>Mažos nuotraukos nuoroda<input type="url" value={thumb} onChange={e=>setThumb(e.target.value)} placeholder="https://.../icon.png"/></label>
 <label>Footer<input maxLength={2048} value={footer} onChange={e=>setFooter(e.target.value)}/></label>
 <button className="primary" disabled={busy||!channel||(!title.trim()&&!body.trim()&&!content.trim())} onClick={send}>{busy?'Siunčiama...':'🚀 Siųsti embed'}</button>
 {status&&<p role="status" className="notice" style={{marginTop:14}}>{status}</p>}</section>
 <section className="panel preview"><h3>👁 Discord peržiūra · Components V2</h3><div className="discord-preview"><div className="discord-msg-head">{avatar?<img src={avatar} alt="" className="discord-avatar" style={{objectFit:'cover'}}/>:<span className="discord-avatar">L</span>}<strong>{username||'Lextrum Development'} <small>BOT</small></strong></div>{content&&<p className="discord-content">{content}</p>}<div className="embed rich-embed self-role-embed" style={{borderLeftColor:color}}>{thumb&&<img className="embed-thumb" src={thumb} alt=""/>}<strong className="embed-title">{title||'Embed title'}</strong><p>{body||'Čia bus tavo pranešimo aprašymas.'}</p>{image&&<img className="self-role-top-image" src={image} alt="Embed banner"/>}{footer&&<small className="embed-footer">{footer}</small>}</div></div><p style={inputHint}>Peržiūra yra apytikslė. Discord atvaizdavimas gali šiek tiek skirtis.</p></section></div>;
}
// Crop uploaded banners into Discord-friendly wide images directly in the browser.
async function cropSelfRoleBanner(file:File,kind:'top'|'bottom'):Promise<File>{
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024||!file.size)throw Error('Rinkis PNG, JPG arba WEBP paveikslėlį iki 8 MB.');
 const url=URL.createObjectURL(file);
 try {
  const picture=new Image();
  picture.src=url;
  await picture.decode();
  const width=1200,height=kind==='top'?390:100;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');if(!context)throw Error('Naršyklė nepalaiko paveikslėlių apdorojimo.');
  const scale=Math.max(width/picture.naturalWidth,height/picture.naturalHeight);
  const dw=picture.naturalWidth*scale,dh=picture.naturalHeight*scale;
  context.drawImage(picture,(width-dw)/2,(height-dh)/2,dw,dh);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Nepavyko apdoroti nuotraukos.')),'image/png'));
  return new File([blob],kind==='top'?'selfroles-top.png':'selfroles-bottom.png',{type:'image/png'});
 }finally{URL.revokeObjectURL(url);}
}
export function SelfRoles({channels,roles}:Shared){
 const [channel,setChannel]=useState(''),[title,setTitle]=useState('🎭 Pasirink savo roles'),[body,setBody]=useState('Pasirink norimus vaidmenis iš sąrašo. Gali pasirinkti kelis ir pakeisti pasirinkimą vėliau.'),[footer,setFooter]=useState('Lextrum Development • Self Roles'),[color,setColor]=useState('#8066f2'),[image,setImage]=useState('');
 const [topImage,setTopImage]=useState<File|null>(null),[bottomImage,setBottomImage]=useState<File|null>(null);
 const [topPreview,setTopPreview]=useState(''),[bottomPreview,setBottomPreview]=useState('');
 const [uploadError,setUploadError]=useState('');
 const chooseBanner=async(event:React.ChangeEvent<HTMLInputElement>,kind:'top'|'bottom')=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
   const cropped=await cropSelfRoleBanner(file,kind);
   const url=URL.createObjectURL(cropped);
   if(kind==='top'){if(topPreview)URL.revokeObjectURL(topPreview);setTopImage(cropped);setTopPreview(url);}
   else{if(bottomPreview)URL.revokeObjectURL(bottomPreview);setBottomImage(cropped);setBottomPreview(url);}
   setUploadError('');
  }catch(error){setUploadError(error instanceof Error?error.message:'Nepavyko įkelti nuotraukos.');}
 };
 const removeBanner=(kind:'top'|'bottom')=>{
  if(kind==='top'){if(topPreview)URL.revokeObjectURL(topPreview);setTopImage(null);setTopPreview('');}
  else{if(bottomPreview)URL.revokeObjectURL(bottomPreview);setBottomImage(null);setBottomPreview('');}
 };
 const [selected,setSelected]=useState<string[]>([]),[labels,setLabels]=useState<Record<string,string>>({}),[emojis,setEmojis]=useState<Record<string,string>>({});
 const [presentation,setPresentation]=useState<'buttons'|'dropdown'>('buttons');
 const [busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const update=(id:string)=>setSelected(old=>old.includes(id)?old.filter(x=>x!==id):old.length>=25?old:[...old,id]);
 async function publish(){
  setBusy(true);setStatus('');
  try{const options=selected.map(id=>({roleId:id,label:labels[id]?.trim()||roles.find(x=>x.id===id)?.name||'Role',emoji:emojis[id]?.trim()||''}));
   const data=new FormData();
   for(const [key,value] of Object.entries({channelId:channel,title,description:body,footer,color,imageUrl:image,presentation,options:JSON.stringify(options)}))data.set(key,value);
   if(topImage)data.set('topImage',topImage);
   if(bottomImage)data.set('bottomImage',bottomImage);
   const res=await fetch('/api/self-roles',{method:'POST',body:data});
   const j=await res.json();setStatus(res.ok?'✅ Self-Roles panelis išsiųstas į Discord':j.error||'Nepavyko paskelbti');
  }catch{setStatus('Ryšio su svetaine klaida');}finally{setBusy(false);}
 }
 return <div className="twocol embed-builder"><section className="panel"><h3>🎭 Self-Roles Builder</h3><p>Sukurk embed su išskleidžiamu vaidmenų sąrašu, su mygtukais kaip tavo pavyzdyje arba išskleidžiamu sąrašu. Paspaudus rolę ji bus suteikta, paspaudus dar kartą – nuimta.</p>
 <label>Kanalas<select value={channel} onChange={e=>setChannel(e.target.value)}><option value="">Pasirink kanalą</option>{channels.map(x=><option key={x.id} value={x.id}>#{x.name}</option>)}</select></label>
 <label>Pavadinimas<input maxLength={256} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <label>Aprašymas<textarea rows={5} maxLength={4000} value={body} onChange={e=>setBody(e.target.value)}/></label>
 <label>Spalva<input type="color" style={{height:52}} value={color} onChange={e=>setColor(e.target.value)}/></label>
 <label>Viršutinis didelis baneris — įkelk iš kompiuterio (1200 × 390 px)
 <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>void chooseBanner(e,'top')}/></label>
 {topImage&&<button type="button" className="secondary" onClick={()=>removeBanner('top')}>Pašalinti viršutinę nuotrauką</button>}
 <label>Apatinis siauras baneris — įkelk iš kompiuterio (1200 × 100 px)
 <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>void chooseBanner(e,'bottom')}/></label>
 {bottomImage&&<button type="button" className="secondary" onClick={()=>removeBanner('bottom')}>Pašalinti apatinę nuotrauką</button>}
 <p>Nuotraukos automatiškai apkerpamos iki pasirinktų proporcijų. Nereikia nuotraukų URL.</p>
 {uploadError&&<p className="error" role="alert">{uploadError}</p>}
 <label>Arba viršutinės nuotraukos URL (nebūtina)<input type="url" value={image} onChange={e=>setImage(e.target.value)}/></label>
 <label>Footer<input value={footer} maxLength={2048} onChange={e=>setFooter(e.target.value)}/></label>
 <label>Pasirinkimo išvaizda<select value={presentation} onChange={e=>setPresentation(e.target.value as 'buttons'|'dropdown')}><option value="buttons">Mygtukai (kaip pavyzdyje)</option><option value="dropdown">Išskleidžiamas sąrašas</option></select></label>
 <div className="ticket-sections"><h3>Vaidmenys ({selected.length}/25)</h3><p>Pažymėk vaidmenis, kuriuos nariai galės pasirinkti. Administratoriaus ir integracijų roles serveris atmes saugumo sumetimais.</p>
 {roles.map(r=><div key={r.id} className="role-option"><label className="ticket-option-toggle" style={{margin:0}}><input type="checkbox" checked={selected.includes(r.id)} onChange={()=>update(r.id)}/><strong>@{r.name}</strong></label>{selected.includes(r.id)&&<div className="twocol"><label>Pasirinkimo tekstas<input maxLength={100} value={labels[r.id]??r.name} onChange={e=>setLabels(old=>({...old,[r.id]:e.target.value}))}/></label><label>Emoji<input value={emojis[r.id]??''} placeholder="🎮" onChange={e=>setEmojis(old=>({...old,[r.id]:e.target.value}))}/></label></div>}</div>)}
 </div><button className="primary" disabled={busy||!channel||!selected.length||!title.trim()} onClick={publish}>{busy?'Publikuojama...':'🚀 Paskelbti Self-Roles'}</button>{status&&<p role="status" className="notice" style={{marginTop:14}}>{status}</p>}</section>
 <section className="panel preview"><h3>👁 Discord peržiūra</h3><div className="discord-preview"><div className="discord-msg-head"><span className="discord-avatar">L</span><strong>Lextrum Bot <small>BOT</small></strong></div><div className="embed rich-embed self-role-embed" style={{borderLeftColor:color}}>
 {(topPreview||image)&&<img className="self-role-top-image" src={topPreview||image} alt="Viršutinis baneris"/>}
 <strong className="embed-title">{title}</strong><p>{body}</p>
 {presentation==='buttons'?<div className="self-role-button-preview">{selected.map(id=><span key={id} className="self-role-preview-button">{emojis[id]||'🎭'} {labels[id]||roles.find(r=>r.id===id)?.name}</span>)}</div>:<div className="ticket-select-preview"><div className="ticket-select-placeholder">Pasirink roles <span>⌄</span></div>{selected.map(id=><div className="ticket-select-option" key={id}><span className="ticket-option-emoji">{emojis[id]||'🎭'}</span><span>{labels[id]||roles.find(r=>r.id===id)?.name}</span></div>)}</div>}
 {bottomPreview&&<img className="self-role-bottom-image" src={bottomPreview} alt="Apatinis baneris"/>}
 {footer&&<small className="embed-footer">{footer}</small>}
 </div></div><p style={inputHint}>Pasirinkti nariai galės turėti kelis iš šio panelio vaidmenų.</p></section></div>;
}
