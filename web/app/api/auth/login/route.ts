import { NextResponse } from 'next/server';
import { appUrl,cookieOptions,randomState } from '@/lib/auth';
export async function GET(){
 const clientId=process.env.DISCORD_CLIENT_ID;
 if(!clientId)return NextResponse.json({error:'Discord client ID missing'},{status:500});
 const state=randomState();
 const url=new URL('https://discord.com/oauth2/authorize');
 url.searchParams.set('client_id',clientId);
 url.searchParams.set('redirect_uri',appUrl()+'/api/auth/callback');
 url.searchParams.set('response_type','code');
 url.searchParams.set('scope','identify');
 url.searchParams.set('state',state);
 const response=NextResponse.redirect(url);
 response.cookies.set('devguard_oauth_state',state,{...cookieOptions(),maxAge:600});
 return response;
}
