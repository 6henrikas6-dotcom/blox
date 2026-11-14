import sharp from 'sharp';

const escapeXml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const shorten=(value:string,max:number)=>value.length>max?value.slice(0,max-1)+'…':value;
export async function reviewCard(data:{name:string;staffName:string;rating:number;avatarUrl?:string|null;count:number;average:number;ticketName:string}):Promise<Buffer>{
 const width=1200,height=390;
 const grid=Array.from({length:31},(_,i)=>'<path d="M '+(i*40)+' 0 V 390" />').join('')+Array.from({length:11},(_,i)=>'<path d="M 0 '+(i*40)+' H 390" />').join('');
 const stars='★'.repeat(data.rating)+'☆'.repeat(5-data.rating);
 const averageStars='★'.repeat(Math.round(data.average))+'☆'.repeat(5-Math.round(data.average));
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="390" viewBox="0 0 1200 390">
 <defs><linearGradient id="shade" x2="1" y2="1"><stop stop-color="#10191b"/><stop offset="1" stop-color="#052a26"/></linearGradient><clipPath id="avatar"><circle cx="101" cy="159" r="49"/></clipPath></defs>
 <rect width="1200" height="390" rx="26" fill="url(#shade)"/>
 <g stroke="#5b6467" stroke-width="1.2" opacity=".42">${grid}</g>
 <rect width="1200" height="390" rx="26" fill="#002c26" opacity=".40"/>
 <text x="54" y="63" font-family="DejaVu Sans,Arial,sans-serif" font-size="22" fill="#b8d6d0">Lextrum • Support Reviews</text>
 <text x="1170" y="63" text-anchor="end" font-family="DejaVu Sans,Arial,sans-serif" font-size="21" fill="#b8d6d0">Staff Review</text>
 <circle cx="101" cy="159" r="50" fill="#158f83"/>
 <text x="101" y="173" text-anchor="middle" font-size="43" font-family="DejaVu Sans,Arial,sans-serif" fill="#fff">★</text>
 <text x="176" y="159" font-family="DejaVu Sans,Arial,sans-serif" font-weight="bold" font-size="38" fill="#fff">${escapeXml(shorten(data.name,22))}</text>
 <text x="176" y="195" font-family="DejaVu Sans,Arial,sans-serif" font-size="21" fill="#b6d5d0">Įvertino pagalbą • ${escapeXml(shorten(data.ticketName,35))}</text>
 <text x="54" y="280" font-family="DejaVu Sans,Arial,sans-serif" font-size="42" fill="#ffd16b">${stars}</text>
 <text x="318" y="278" font-family="DejaVu Sans,Arial,sans-serif" font-size="23" fill="#fff">${data.rating} iš 5</text>
 <text x="54" y="329" font-family="DejaVu Sans,Arial,sans-serif" font-size="21" fill="#c5dbd5">Įvertintas darbuotojas: ${escapeXml(shorten(data.staffName,32))}</text>
 <rect x="792" y="92" width="358" height="249" rx="25" fill="#ffffff" fill-opacity=".085"/>
 <text x="826" y="139" font-family="DejaVu Sans,Arial,sans-serif" font-size="20" fill="#c4ded8">Staff average rating</text>
 <text x="826" y="218" font-family="DejaVu Sans,Arial,sans-serif" font-size="72" font-weight="bold" fill="#fff">${data.average.toFixed(1)}</text>
 <text x="826" y="261" font-family="DejaVu Sans,Arial,sans-serif" font-size="34" fill="#ffd16b">${averageStars}</text>
 <text x="826" y="304" font-family="DejaVu Sans,Arial,sans-serif" font-size="19" fill="#c4ded8">Iš ${data.count} įvertinimų</text>
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
