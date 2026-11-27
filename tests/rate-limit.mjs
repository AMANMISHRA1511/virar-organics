import { Client, assert, pool } from './helpers.mjs';
import fs from 'node:fs/promises';
const a=new Client(), b=new Client(process.env.TEST_API_SECONDARY || 'http://127.0.0.1:4101');
await a.token();await b.token();const statuses=[];
for(let i=0;i<13;i++){
 const r=await (i%2?a:b).request('/login',{method:'POST',body:{email:'not-an-account@mitti.test',password:'IncorrectPassword123!'}});
 statuses.push(r.status);
 if(i<12)assert.equal(r.status,401,r.text);else{assert.equal(r.status,429,r.text);assert.ok(Number(r.headers.get('Retry-After'))>0);}
}
const result={check:'Shared Redis login rate limit across two API instances',requests:13,allowedInvalidCredentialAttempts:12,throttledRequest:13,statuses,passed:true};
await fs.writeFile(new URL('./results/rate-limit-results.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await pool.end();
