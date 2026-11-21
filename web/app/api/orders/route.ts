import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,validOrigin} from '@/lib/auth';
import {db} from '@/lib/db';

const orderPattern=/^[A-Za-z0-9_-]{3,40}$/;
const productPattern=/^[A-Za-z0-9_-]{1,30}$/;
const MAX_FILE=8*1024*1024;
const safeName=(name:string)=>name.replace(/[\\/\x00-\x1f\x7f]/g,'_').slice(0,140);
const serialize=(orders:Array<{id:string;orderNumber:string;buyerId:string|null;productName:string;createdAt:Date;items:Array<{id:string;productNumber:string;productName:string;fileName:string|null;deliveredAt:Date|null;deliveredTo:string|null;preparationStatus:string}>}>)=>
 orders.map(o=>({id:o.id,orderNumber:o.orderNumber,buyerId:o.buyerId,productName:o.productName,createdAt:o.createdAt,items:o.items}));
export async function GET(){
 const admin=await requireAdmin();
 if(!admin)return NextResponse.json({error:'Tik administratoriams.'},{status:403});
 const guildId=process.env.DISCORD_GUILD_ID;
 if(!guildId)return NextResponse.json({error:'Discord serveris nesukonfigūruotas.'},{status:500});
 const orders=await db.digitalOrder.findMany({where:{guildId},orderBy:{createdAt:'desc'},take:75,select:{
  id:true,orderNumber:true,buyerId:true,productName:true,createdAt:true,
  items:{select:{id:true,productNumber:true,productName:true,fileName:true,deliveredAt:true,deliveredTo:true,preparationStatus:true},orderBy:{createdAt:'asc'}}
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
 const orderNumber=str('orderNumber'),productName=str('productName'),productNumber=str('productNumber'),buyerId=str('buyerId'),preparationStatus=str('preparationStatus')||'preparing';
 if(!['preparing','reviewing','ready'].includes(preparationStatus))return NextResponse.json({error:'Neteisinga prekės būsena.'},{status:400});
 if(!orderPattern.test(orderNumber)||!productPattern.test(productNumber)||!productName||productName.length>150)
  return NextResponse.json({error:'Nurodyk užsakymo numerį (3–40 simbolių), produkto numerį ir pavadinimą.'},{status:400});
 if(buyerId&&!/^\d{17,20}$/.test(buyerId))return NextResponse.json({error:'Pirkėjo Discord ID turi būti 17–20 skaitmenų.'},{status:400});
 const libraryItemId=str('libraryItemId');
 if(libraryItemId&&!/^c[a-z0-9]{15,35}$/i.test(libraryItemId))return NextResponse.json({error:'Invalid product library selection.'},{status:400});
 const file=form.get('file');
 if(file&&libraryItemId)return NextResponse.json({error:'Choose either a library product or upload a new file, not both.'},{status:400});
 if(file!==null&&(!(file instanceof File)||!file.size||file.size>MAX_FILE))
  return NextResponse.json({error:'Pridėk failą iki 8 MB. Failai saugomi privačioje duomenų bazėje.'},{status:400});
 let bytes:Uint8Array<ArrayBuffer>|undefined;
 let selectedFileName:string|undefined,selectedFileMime:string|undefined;
 if(file instanceof File){
  bytes=new Uint8Array(await file.arrayBuffer());
  selectedFileName=safeName(file.name);selectedFileMime=file.type||'application/octet-stream';
 }else if(libraryItemId){
  const libraryItem=await db.productLibraryItem.findFirst({where:{id:libraryItemId,guildId}});
  if(!libraryItem)return NextResponse.json({error:'Selected product was not found in this server’s library.'},{status:404});
  if(libraryItem.fileSize>MAX_FILE)return NextResponse.json({error:'Library file is too large for Discord delivery.'},{status:400});
  bytes=new Uint8Array(libraryItem.fileData);
  selectedFileName=libraryItem.fileName;
  selectedFileMime=libraryItem.fileMime;
 }
 try{
  const current=await db.digitalOrder.findUnique({where:{guildId_orderNumber:{guildId,orderNumber}},include:{items:true}});
  if(current?.buyerId&&buyerId&&current.buyerId!==buyerId&&current.items.some(item=>item.deliveredAt))
   return NextResponse.json({error:'Negalima pakeisti pirkėjo, kai prekė jau atiduota.'},{status:409});
  const existingItem=current?.items.find(i=>i.productNumber===productNumber);
  if(preparationStatus==='ready'&&!bytes&&!existingItem?.fileName)return NextResponse.json({error:'Negalima pažymėti Ready, kol neįkeltas tikras prekės failas.'},{status:400});
  if(existingItem?.deliveredAt&&(bytes||existingItem.productName!==productName||existingItem.preparationStatus!==preparationStatus))
   return NextResponse.json({error:'Ši prekė jau pristatyta. Jos failo keisti negalima.'},{status:409});
  const order=await db.digitalOrder.upsert({
   where:{guildId_orderNumber:{guildId,orderNumber}},
   create:{guildId,orderNumber,buyerId:buyerId||null,productName},
   update:{productName,...(buyerId?{buyerId}:{})}
  });
  const item=await db.digitalOrderItem.upsert({
   where:{orderId_productNumber:{orderId:order.id,productNumber}},
   create:{orderId:order.id,productNumber,productName,preparationStatus,...(bytes?{fileName:selectedFileName!,fileMime:selectedFileMime!,fileData:bytes}: {})},
   update:{productName,preparationStatus,...(bytes?{fileName:selectedFileName!,fileMime:selectedFileMime!,fileData:bytes,deliveredTo:null,deliveredAt:null}:{})}
  });
  await db.auditEvent.create({data:{guildId,actorId:admin.id,event:'ORDER_ITEM_SAVED',detail:JSON.stringify({orderNumber,productNumber,preparationStatus,file:!!bytes,fromLibrary:!!libraryItemId,buyerId:buyerId||null})}}).catch(()=>{});
  return NextResponse.json({ok:true,orderNumber,productNumber,itemId:item.id,preparationStatus,fileUploaded:!!bytes,fromLibrary:!!libraryItemId});
 }catch{return NextResponse.json({error:'Nepavyko išsaugoti. Patikrink, ar užsakymo numeris jau naudojamas.'},{status:500});}
}


export async function DELETE(request:NextRequest){
 const admin=await requireAdmin();
 if(!admin)return NextResponse.json({error:'Tik administratoriams.'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Netinkama užklausos kilmė.'},{status:403});
 const guildId=process.env.DISCORD_GUILD_ID;
 if(!guildId)return NextResponse.json({error:'Discord serveris nesukonfigūruotas.'},{status:500});
 let data:unknown;
 try{data=await request.json();}catch{return NextResponse.json({error:'Neteisingi duomenys.'},{status:400});}
 if(!data||typeof data!=='object')return NextResponse.json({error:'Neteisingi duomenys.'},{status:400});
 const input=data as Record<string,unknown>;
 const orderId=typeof input.orderId==='string'?input.orderId:'';
 const confirmNumber=typeof input.confirmNumber==='string'?input.confirmNumber.trim():'';
 if(!/^c[a-z0-9]{15,35}$/i.test(orderId)||!orderPattern.test(confirmNumber))
  return NextResponse.json({error:'Netinkamas užsakymo patvirtinimas.'},{status:400});
 try{
  const order=await db.digitalOrder.findFirst({where:{id:orderId,guildId},
   select:{id:true,orderNumber:true,items:{select:{deliveryState:true}}}});
  if(!order)return NextResponse.json({error:'Užsakymas nerastas.'},{status:404});
  if(order.orderNumber!==confirmNumber)
   return NextResponse.json({error:'Patvirtinimo numeris nesutampa.'},{status:400});
  if(order.items.some(item=>item.deliveryState==='sending'))
   return NextResponse.json({error:'Užsakymo negalima ištrinti, kol vyksta failo siuntimas. Bandyk vėliau.'},{status:409});
  const deleted=await db.digitalOrder.deleteMany({where:{id:order.id,guildId}});
  if(!deleted.count)return NextResponse.json({error:'Užsakymas jau ištrintas.'},{status:404});
  await db.auditEvent.create({data:{guildId,actorId:admin.id,event:'ORDER_DELETED',
   detail:JSON.stringify({orderNumber:order.orderNumber,itemCount:order.items.length})}}).catch(()=>{});
  return NextResponse.json({ok:true,orderNumber:order.orderNumber});
 }catch{return NextResponse.json({error:'Nepavyko ištrinti užsakymo.'},{status:500});}
}
