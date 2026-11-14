import { NextRequest,NextResponse } from 'next/server';
import { appUrl,cookieOptions,createSession,sessionCookie } from '@/lib/auth';
export async function GET(req:NextRequest){
 const base=appUrl(),code=req.nextUrl.searchParams.get('code'),state=req.nextUrl.searchParams.get('state');
 const expected=req.cookies.get('devguard_oauth_state')?.value;
 if(!code||!state||!expected||state!==expected)return NextResponse.redirect(base+'/?error=invalid_state');
 const id=process.env.DISCORD_CLIENT_ID,secret=process.env.DISCORD_CLIENT_SECRET;
 if(!id||!secret)return NextResponse.json({error:'OAuth not configured'},{status:500});
 const data=new URLSearchParams({client_id:id,client_secret:secret,grant_type:'authorization_code',code,redirect_uri:base+'/api/auth/callback'});
 const result=await fetch('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:data,cache:'no-store'});
 if(!result.ok)return NextResponse.redirect(base+'/?error=oauth_failed');
 const tokens=await result.json();
 const info=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bearer ${tokens.access_token}`},cache:'no-store'});
 if(!info.ok)return NextResponse.redirect(base+'/?error=user_failed');
 const user=await info.json() as {id:string;username:string;avatar?:string|null};
 const allowed=process.env.ADMIN_USER_IDS?.split(',').map(x=>x.trim()).includes(user.id);
 if(!allowed)return NextResponse.redirect(base+'/?error=not_allowed');
 const guild=process.env.DISCORD_GUILD_ID,bot=process.env.DISCORD_BOT_TOKEN;
 if(!guild||!bot)return NextResponse.redirect(base+'/?error=not_configured');
 const membership=await fetch(`https://discord.com/api/v10/guilds/${guild}/members/${user.id}`,{headers:{Authorization:`Bot ${bot}`},cache:'no-store'});
 if(!membership.ok)return NextResponse.redirect(base+'/?error=not_member');
 const response=NextResponse.redirect(base+'/dashboard');
 response.cookies.set(sessionCookie,await createSession(user),cookieOptions());
 response.cookies.delete('devguard_oauth_state');
 return response;
}
