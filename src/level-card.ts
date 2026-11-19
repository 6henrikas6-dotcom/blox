import sharp from 'sharp';
import { drawText } from './review-card.js';

// Same 1200 × 280 grid design as the Lextrum welcome card, for level-up events.
export async function levelUpCard(name:string,level:number,avatarUrl:string):Promise<Buffer>{
 const width=1200,height=280;
 const grid=Array.from({length:Math.ceil(width/40)+1},(_,i)=>'<path d="M '+(i*40)+' 0 V '+height+'"/>').join('')
  +Array.from({length:Math.ceil(height/40)+1},(_,i)=>'<path d="M 0 '+(i*40)+' H '+width+'"/>').join('');
 const displayName=Array.from(name).slice(0,22).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
 <rect width="1200" height="280" rx="22" fill="#050505"/>
 <g stroke="#292929" stroke-width="1.4" opacity=".85">${grid}</g>
 <circle cx="150" cy="140" r="106" fill="#202020" stroke="#777" stroke-width="3"/>
 ${drawText('Level Up - Lextrum Production',300,91,28,'#bfbfbf')}
 ${drawText(displayName,300,166,60,'#fff',true)}
 ${drawText('Level '+Math.max(0,Math.trunc(level)).toLocaleString('en-US'),300,225,28,'#aaa')}
 </svg>`;
 const base=sharp(Buffer.from(svg));
 try{
  const response=await fetch(avatarUrl,{signal:AbortSignal.timeout(3500)});
  if(!response.ok)return base.png().toBuffer();
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>2_000_000)return base.png().toBuffer();
  const avatar=await sharp(bytes).resize(204,204).png().toBuffer();
  const mask=Buffer.from('<svg width="204" height="204"><circle cx="102" cy="102" r="102" fill="white"/></svg>');
  const circle=await sharp(avatar).composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
  return base.composite([{input:circle,left:48,top:38}]).png().toBuffer();
 }catch{return base.png().toBuffer();}
}
