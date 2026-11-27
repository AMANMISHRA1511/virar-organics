import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.BUILD_BASE_URL||'http://127.0.0.1:4000';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('Use a local server for the build smoke test.');
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']}: {})});
const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
try{
 for(const route of ['/','/shop','/about','/login','/register']){
  const r=await page.goto(base+route,{waitUntil:'networkidle'});assert.equal(r.status(),200);
  assert.match(r.headers()['content-security-policy'],/default-src 'self'/);assert.equal(r.headers()['x-content-type-options'],'nosniff');
  await page.locator('h1').first().waitFor();assert.equal(await page.locator('script[src*="/@vite/"]').count(),0);checks.push({route,status:'passed'});
 }
 await page.goto(base+'/admin',{waitUntil:'networkidle'});await page.waitForURL(/\/admin\/login$/);checks.push({route:'/admin',status:'passed',detail:'Unauthenticated visitor redirected to staff sign-in'});
 assert.deepEqual(errors,[]);
 const result={status:'passed',checks,errors,browser:browser.version(),timestamp:new Date().toISOString(),note:'Production Vite assets served by Express under its CSP; NODE_ENV=development for plain localhost. HTTPS production deployment itself is not claimed.'};await fs.writeFile('tests/results/build-smoke.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
