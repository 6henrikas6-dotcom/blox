import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import opentype from 'opentype.js';
const require=createRequire(import.meta.url);
const font=opentype.parse(readFileSync(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff')).buffer);
const fontBold=opentype.parse(readFileSync(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff')).buffer);
const fontExt=opentype.parse(readFileSync(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff')).buffer);
const fontExtBold=opentype.parse(readFileSync(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-ext-700-normal.woff')).buffer);
function drawText(value:string,x:number,y:number,size:number,color:string,bold=false,anchor:'start'|'end'|'middle'='start'){
 const basic=bold?fontBold:font,extra=bold?fontExtBold:fontExt;
 const chars=Array.from(value);
 const widths=chars.map(c=>(c.codePointAt(0)!>127?extra:basic).getAdvanceWidth(c,size));
 const total=widths.reduce((a,b)=>a+b,0);
 let pos=x-(anchor==='end'?total:anchor==='middle'?total/2:0);
 let paths='';
 for(let i=0;i<chars.length;i++){const f=chars[i].codePointAt(0)!>127?extra:basic;paths+=f.getPath(chars[i],pos,y,size).toPathData(2);pos+=widths[i];}
 return '<path fill="'+color+'" d="'+paths+'"/>';
}


const escapeXml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const shorten=(value:string,max:number)=>value.length>max?value.slice(0,max-1)+'…':value;
export async function reviewCard(data:{name:string;staffName:string;rating:number;avatarUrl?:string|null;count:number;average:number;ticketName:string}):Promise<Buffer>{
 const width=1200,height=390;
 const grid=Array.from({length:31},(_,i)=>'<path d="M '+(i*40)+' 0 V 390" />').join('')+Array.from({length:11},(_,i)=>'<path d="M 0 '+(i*40)+' H 1200" />').join('');
 const stars='★'.repeat(data.rating)+'☆'.repeat(5-data.rating);
 const averageStars='★'.repeat(Math.round(data.average))+'☆'.repeat(5-Math.round(data.average));
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="390" viewBox="0 0 1200 390">
 <defs><linearGradient id="shade" x2="1" y2="1"><stop stop-color="#10191b"/><stop offset="1" stop-color="#052a26"/></linearGradient><clipPath id="avatar"><circle cx="101" cy="159" r="49"/></clipPath></defs>
 <rect width="1200" height="390" rx="26" fill="url(#shade)"/>
 <g stroke="#5b6467" stroke-width="1.2" opacity=".42">${grid}</g>
 <rect width="1200" height="390" rx="26" fill="#002c26" opacity=".40"/>
 ${drawText("Lextrum • Support Reviews",54,63,22,"#b8d6d0",false,"start")}
 ${drawText("Staff Review",1170,63,21,"#b8d6d0",false,"end")}
 <circle cx="101" cy="159" r="50" fill="#158f83"/>
 <text x="101" y="173" text-anchor="middle" font-size="43" font-family="DejaVu Sans,Arial,sans-serif" fill="#fff">★</text>
 ${drawText(`${escapeXml(shorten(data.name,22))}`,176,159,38,"#fff",true,"start")}
 ${drawText(`Įvertino pagalbą • ${escapeXml(shorten(data.ticketName,35))}`,176,195,21,"#b6d5d0",false,"start")}
 ${drawText(`${stars}`,54,280,42,"#ffd16b",false,"start")}
 ${drawText(`${data.rating} iš 5`,318,278,23,"#fff",false,"start")}
 ${drawText(`Įvertintas darbuotojas: ${escapeXml(shorten(data.staffName,32))}`,54,329,21,"#c5dbd5",false,"start")}
 <rect x="792" y="92" width="358" height="249" rx="25" fill="#ffffff" fill-opacity=".085"/>
 ${drawText("Staff average rating",826,139,20,"#c4ded8",false,"start")}
 <text x="826" y="218" font-family="DejaVu Sans,Arial,sans-serif" font-size="72" font-weight="bold" fill="#fff">${data.average.toFixed(1)}</text>
 ${drawText(`${averageStars}`,826,261,34,"#ffd16b",false,"start")}
 ${drawText(`Iš ${data.count} įvertinimų`,826,304,19,"#c4ded8",false,"start")}
 <path d="M0 372 Q270 342 520 364 T1200 367" stroke="#1ae1a7" stroke-width="8" fill="none" opacity=".8"/>
 </svg>`;
 const base=sharp(Buffer.from(svg));
 if(!data.avatarUrl)return base.png().toBuffer();
 try{
  const res=await fetch(data.avatarUrl,{signal:AbortSignal.timeout(3500)});
  if(!res.ok)return base.png().toBuffer();
  const bytes=Buffer.from(await res.arrayBuffer());
  if(bytes.length>2_000_000)return base.png().toBuffer();
  const avatar=await sharp(bytes).resize(98,98).png().toBuffer();
  const mask=Buffer.from('<svg width="98" height="98"><circle cx="49" cy="49" r="49" fill="white"/></svg>');
  const circle=await sharp(avatar).composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
  return base.composite([{input:circle,left:52,top:110}]).png().toBuffer();
 }catch{return base.png().toBuffer();}
}
