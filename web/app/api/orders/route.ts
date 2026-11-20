import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,validOrigin} from '@/lib/auth';
import {db} from '@/lib/db';

const orderPattern=/^[A-Za-z0-9_-]{3,40}$/;
const productPattern=/^[A-Za-z0-9_-]{1,30}$/;
const MAX_FILE=8*1024*1024;
const safeName=(name:string)=>name.replace(/[\\/\x00-\x1f\x7f]/g,'_').slice(0,140);
const serialize=(orders:Array<{id:string;orderNumber:string;buyerId:string|null;productName:string;createdAt:Date;items:Array<{id:string;productNumber:string;productName:string;fileName:string|null;deliveredAt:Date|null;deliveredTo:string|null}>}>)=>
 orders.map(o=>({id:o.id,orderNumber:o.orderNumber,buyerId:o.buyerId,productName:o.productName,createdAt:o.createdAt,items:o.items}));
export async function GET(){
 const admin=await requireAdmin();
 if(!admin)return NextResponse.json({error:'Tik administratoriams.'},{status:403});
 const guildId=process.env.DISCORD_GUILD_ID;
 if(!guildId)return NextResponse.json({error:'Discord serveris nesukonfigūruotas.'},{status:500});
 const orders=await db.digitalOrder.findMany({where:{guildId},orderBy:{createdAt:'desc'},take:75,select:{
  id:true,orderNumber:true,buyerId:true,productName:true,createdAt:true,
  items:{select:{id:true,productNumber:true,productName:true,fileName:true,deliveredAt:true,deliveredTo:true},orderBy:{createdAt:'asc'}}
 }});
 return NextResponse.json({orders:serialize(orders)});
}
export async function POST(request:NextRequest){
 const admin=await requireAdmin();
 if(!admin)return NextResponse.json({error:'Tik administratoriams.'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Netinkama užklausos kilmė.'},{status:403});
 const guildId=process.env.DISCORD_GUILD_ID;
 if(!guildId)return NextResponse.json({error:'Discord serveris nesukonfigūruotas.'},{status:500});
 let form:FormData;
 try{form=await request.formData();}catch{return NextResponse.json({error:'Neteisingi formos duomenys.'},{status:400});}
 const str=(field:string)=>{const v=form.get(field);return typeof v==='string'?v.trim():'';};
 const orderNumber=str('orderNumber'),productName=str('productName'),productNumber=str('productNumber'),buyerId=str('buyerId');
 if(!orderPattern.test(orderNumber)||!productPattern.test(productNumber)||!productName||productName.length>150)
  return NextResponse.json({error:'Nurodyk užsakymo numerį (3–40 simbolių), produkto numerį ir pavadinimą.'},{status:400});
 if(buyerId&&!/^\d{17,20}$/.test(buyerId))return NextResponse.json({error:'Pirkėjo Discord ID turi būti 17–20 skaitmenų.'},{status:400});
 const file=form.get('file');
 if(file!==null&&(!(file instanceof File)||!file.size||file.size>MAX_FILE))
  return NextResponse.json({error:'Pridėk failą iki 8 MB. Failai saugomi privačioje duomenų bazėje.'},{status:400});
 let bytes:Uint8Array|undefined;
 if(file instanceof File){bytes=new Uint8Array(await file.arrayBuffer());}
 try{
  const current=await db.digitalOrder.findUnique({where:{guildId_orderNumber:{guildId,orderNumber}},include:{items:true}});
  if(current?.buyerId&&buyerId&&current.buyerId!==buyerId&&current.items.some(item=>item.deliveredAt))
   return NextResponse.json({error:'Negalima pakeisti pirkėjo, kai prekė jau atiduota.'},{status:409});
  const existingItem=current?.items.find(i=>i.productNumber===productNumber);
  if(existingItem?.deliveredAt&&(file||existingItem.productName!==productName))
   return NextResponse.json({error:'Ši prekė jau pristatyta. Jos failo keisti negalima.'},{status:409});
  const order=await db.digitalOrder.upsert({
   where:{guildId_orderNumber:{guildId,orderNumber}},
   create:{guildId,orderNumber,buyerId:buyerId||null,productName},
   update:{productName,...(buyerId?{buyerId}:{})}
  });
  const item=await db.digitalOrderItem.upsert({
   where:{orderId_productNumber:{orderId:order.id,productNumber}},
   create:{orderId:order.id,productNumber,productName,...(file instanceof File?{fileName:safeName(file.name),fileMime:file.type||'application/octet-stream',fileData:bytes}: {})},
   update:{productName,...(file instanceof File?{fileName:safeName(file.name),fileMime:file.type||'application/octet-stream',fileData:bytes,deliveredTo:null,deliveredAt:null}:{})}
  });
  await db.auditEvent.create({data:{guildId,actorId:admin.id,event:'ORDER_ITEM_SAVED',detail:JSON.stringify({orderNumber,productNumber,file:!!file,buyerId:buyerId||null})}}).catch(()=>{});
  return NextResponse.json({ok:true,orderNumber,productNumber,itemId:item.id,fileUploaded:!!file});
 }catch{return NextResponse.json({error:'Nepavyko išsaugoti. Patikrink, ar užsakymo numeris jau naudojamas.'},{status:500});}
}
