import { NextResponse } from 'next/server';
import { appUrl,sessionCookie,validOrigin } from '@/lib/auth';
export async function POST(){
 if(!await validOrigin())return NextResponse.json({error:'Invalid origin'},{status:403});
 const response=NextResponse.redirect(appUrl()+'/',{status:303});
 response.cookies.delete(sessionCookie);
 return response;
}
