import { Client, assert, pool, product, upload, tag } from './helpers.mjs';
import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
const fixtureURL=new URL('./results/persistence-fixture.json',import.meta.url);const c=new Client();
if(process.argv[2]==='write'){
 await c.login('admin@mitti.test');const [url]=await upload(c,['#698555']);const p=await product(c,{name:`Persistent image ${tag}`,images:[url]});const bytes=Buffer.from(await(await fetch(c.base+url)).arrayBuffer());
 await fs.writeFile(fixtureURL,JSON.stringify({productId:p.id,url,sha256:createHash('sha256').update(bytes).digest('hex')}));console.log('Uploaded image and product committed before API restart.');
}else{
 const f=JSON.parse(await fs.readFile(fixtureURL,'utf8'));const p=await c.ok(`/products/${f.productId}`);assert.deepEqual(p.images,[f.url]);const response=await fetch(c.base+f.url);assert.equal(response.status,200);const sha=createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');assert.equal(sha,f.sha256);
 const result={check:'Product/image persistence after both API processes restart',productId:f.productId,sha256:sha,passed:true};await fs.writeFile(new URL('./results/persistence-results.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}await pool.end();
