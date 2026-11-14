export async function discord(path:string,options:RequestInit={}){
 const token=process.env.DISCORD_BOT_TOKEN;
 if(!token)throw new Error('DISCORD_BOT_TOKEN missing');
 const response=await fetch('https://discord.com/api/v10'+path,{...options,headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json',...options.headers},cache:'no-store'});
 if(!response.ok)throw new Error(`Discord API returned ${response.status}`);
 return response.json();
}
