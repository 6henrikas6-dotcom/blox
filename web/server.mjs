import { spawn } from 'node:child_process';
const port=String(process.env.PORT||3000);
const proc=spawn('node',['node_modules/next/dist/bin/next','start','-H','0.0.0.0','-p',port],{stdio:'inherit',env:process.env});
proc.on('exit',code=>process.exit(code??1));
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>proc.kill(sig));
