import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,validOrigin} from '@/lib/auth';
import {db} from '@/lib/db';

const MAX_FILE=8*1024*1024;
const MAX_FILES=8;
const MAX_TOTAL=24*1024*1024;
const safeName=(name:string)=>name.replace(/[\\/\x00-\x1f\x7f]/g,'_').slice(0,140);

export async function GET(){
 const admin=await requireAdmin();
 if(!admin)return NextResponse.json({error:'Only administrators can view the product library.'},{status:403});
 const guildId=process.env.DISCORD_GUILD_ID;
 if(!guildId)return NextResponse.json({error:'Guild is not configured.'},{status:500});
 try{
  const items=await db.productLibraryItem.findMany({
   where:{guildId},orderBy:{createdAt:'desc'},take:150,
   select:{id:true,name:true,fileName:true,fileSize:true,createdAt:true}
  });
  return NextResponse.json({items});
 }catch{return NextResponse.json({error:'Failed to load the product library.'},{status:500});}
}

export async function POST(request:NextRequest){
 const admin=await requireAdmin();
 if(!admin)return NextResponse.json({error:'Only administrators can upload products.'},{status:403});
 if(!await validOrigin())return NextResponse.json({error:'Invalid origin.'},{status:403});
 const guildId=process.env.DISCORD_GUILD_ID;
 if(!guildId)return NextResponse.json({error:'Guild is not configured.'},{status:500});
 let form:FormData;
 try{form=await request.formData();}catch{return NextResponse.json({error:'Invalid multipart upload.'},{status:400});}
 const files=form.getAll('files');
 if(!files.length||files.length>MAX_FILES||files.some(value=>!(value instanceof File)||!value.size||value.size>MAX_FILE))
  return NextResponse.json({error:'Choose 1–8 files, up to 8 MB per file.'},{status:400});
 const uploads=files as File[];
 if(uploads.reduce((total,file)=>total+file.size,0)>MAX_TOTAL)
  return NextResponse.json({error:'Upload up to 24 MB total in one batch.'},{status:400});
 const nameField=form.get('name');
 const singleName=typeof nameField==='string'?nameField.trim():'';
 if(singleName.length>150)return NextResponse.json({error:'Product name is too long.'},{status:400});
 try{
  const created=[];
  for(const file of uploads){
   const fallback=file.name.replace(/\.[^.]+$/,'').trim();
   const name=(uploads.length===1&&singleName?singleName:fallback).slice(0,150);
   if(!name)return NextResponse.json({error:'Product name cannot be empty.'},{status:400});
   const row=await db.productLibraryItem.create({data:{
    guildId,name,fileName:safeName(file.name),fileMime:file.type||'application/octet-stream',
    fileSize:file.size,fileData:new Uint8Array(await file.arrayBuffer())
   },select:{id:true,name:true,fileName:true,fileSize:true,createdAt:true}});
   created.push(row);
  }
  await db.auditEvent.create({data:{guildId,event:'PRODUCT_LIBRARY_UPLOAD',actorId:admin.id,detail:JSON.stringify({count:created.length,ids:created.map(x=>x.id)})}}).catch(()=>{});
  return NextResponse.json({ok:true,items:created});
 }catch{return NextResponse.json({error:'Failed to save product files. Files already uploaded in this batch may be present in the library.'},{status:500});}
}
