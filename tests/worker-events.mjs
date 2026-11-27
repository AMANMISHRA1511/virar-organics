import { spawn } from 'node:child_process';import fs from 'node:fs/promises';
import { Client, assert, pool, socket, eventPromise, poll, sql, API_SECONDARY, tag } from './helpers.mjs';
const admin=new Client(),visitor=new Client();await admin.login('admin@mitti.test');await visitor.login('customer@mitti.test');const s=await socket(admin,API_SECONDARY);let child;
try{
 const lead=await visitor.ok('/leads',{method:'POST',body:{name:`Worker test ${tag}`,email:`worker-${tag}@mitti.test`,phone:'+91 9000012345',product:'Organic rice',quantity:25,message:'Standalone worker event verification'}});
 const before=await sql('SELECT id,status,attempts FROM notifications WHERE lead_id=?',[lead.id]);assert.equal(before.length,2);assert.ok(before.every(n=>n.attempts===0));const ids=new Set(before.map(n=>n.id));
 const event=eventPromise(s,'notification:updated',x=>ids.has(x.id),15000);
 child=spawn(process.execPath,['worker.js'],{cwd:new URL('../backend/',import.meta.url),env:process.env,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 await event;const sent=await poll(()=>sql('SELECT id,status,attempts FROM notifications WHERE lead_id=?',[lead.id]),x=>x.every(n=>n.status==='simulated'),15000);
 const result={check:'Standalone BullMQ worker publishes private notification events to API instances',leadId:lead.id,notifications:sent,eventReceived:true,passed:true};await fs.writeFile(new URL('./results/worker-results.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{s.disconnect();if(child){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null)child.kill('SIGKILL');}await pool.end();}
