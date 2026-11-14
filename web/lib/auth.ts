import { cookies, headers } from 'next/headers';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { randomBytes, createHash } from 'node:crypto';
const cookieName='devguard_session';
const secret=()=>{const s=process.env.AUTH_SECRET;if(!s||s.length<32)throw new Error('AUTH_SECRET must have at least 32 characters');return createHash('sha256').update(s).digest();};
export const randomState=()=>randomBytes(24).toString('hex');
export const appUrl=()=>{const url=process.env.APP_URL;if(!url)throw new Error('APP_URL is missing');return new URL(url).origin;};
export const cookieOptions=()=>({httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax' as const,path:'/',maxAge:60*60*8});
export async function createSession(user:{id:string;username:string;avatar?:string|null}){
 return new EncryptJWT({username:user.username,avatar:user.avatar??null}).setProtectedHeader({alg:'dir',enc:'A256GCM'}).setSubject(user.id).setIssuedAt().setExpirationTime('8h').encrypt(secret());
}
export async function session(){
 const token=(await cookies()).get(cookieName)?.value;
 if(!token)return null;
 try{const {payload}=await jwtDecrypt(token,secret());if(typeof payload.sub!=='string'||typeof payload.username!=='string')return null;return {id:payload.sub,username:payload.username,avatar:typeof payload.avatar==='string'?payload.avatar:null};}catch{return null;}
}
export const sessionCookie=cookieName;
export async function requireAdmin(){
 const user=await session();
 if(!user || !process.env.ADMIN_USER_IDS?.split(',').map(x=>x.trim()).includes(user.id))return null;
 const guild=process.env.DISCORD_GUILD_ID,token=process.env.DISCORD_BOT_TOKEN;
 if(!guild||!token)return null;
 const r=await fetch(`https://discord.com/api/v10/guilds/${guild}/members/${user.id}`,{headers:{Authorization:`Bot ${token}`},cache:'no-store'});
 return r.ok?user:null;
}
export async function validOrigin(){
 const h=await headers(),origin=h.get('origin');
 return !!origin&&origin===appUrl();
}
