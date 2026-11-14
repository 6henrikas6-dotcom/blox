import sharp from 'sharp';
import { drawText } from './review-card.js';

const trim=(s:string,max:number)=>Array.from(s).slice(0,max).join('');
export async function welcomeCard(name:string,count:number,avatarUrl:string):Promise<Buffer>{
 const grid=Array.from({length:31},(_,i)=>'<path d="M '+(i*40)+' 0 V 510"/>').join('')+Array.from({length:14},(_,i)=>'<path d="M 0 '+(i*40)+' H 1200"/>').join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="510" viewBox="0 0 1200 510">
 <rect width="1200" height="510" rx="26" fill="#050505"/>
 <g stroke="#333" stroke-width="1.4" opacity=".9">${grid}</g>
 <rect x="32" y="30" width="1136" height="450" rx="22" fill="#090909" fill-opacity=".3"/>
 ${drawText('WELCOME TO LEXTRUM',600,130,65,'#fff',true,'middle')}
 ${drawText('PRODUCTION',600,190,65,'#fff',true,'middle')}
 <circle cx="194" cy="325" r="106" fill="#202020" stroke="#777" stroke-width="3"/>
 ${drawText('Welcome to Lextrum Production',362,284,28,'#bfbfbf')}
 ${drawText(trim(name,22),362,363,60,'#fff',true)}
 ${drawText('Member #'+count.toLocaleString('en-US'),362,419,28,'#aaa')}
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
  return base.composite([{input:circle,left:92,top:223}]).png().toBuffer();
 }catch{return base.png().toBuffer();}
}
