import {test,before,after} from 'node:test';
import {spawn,spawnSync} from 'node:child_process';
import {Client,assert,pool,sql,poll,tag,delay} from './helpers.mjs';
const users=Array.from({length:6},()=>new Client()),sales=new Client(),anonymous=new Client();
let googleServer,googleLogs='',internalDb;
const phone=i=>`+91900100${String(i).padStart(4,'0')}`;
const request=(c,n)=>c.request('/account/phone/request',{method:'POST',body:{phone:n}});
const verify=(c,id,code)=>c.request('/account/phone/verify',{method:'POST',body:{challengeId:id,code}});
const unwrap=r=>r.body.user||r.body;
before(async()=>{for(let i=0;i<users.length;i++)await users[i].register(`otp-${i}-${tag}@mitti.test`,`OTP Customer ${i}`);await sales.login('sales@mitti.test');await anonymous.token();});
after(async()=>{if(googleServer&&googleServer.exitCode===null){googleServer.kill('SIGTERM');await Promise.race([new Promise(r=>googleServer.once('exit',r)),delay(5000)]);if(googleServer.exitCode===null&&googleServer.signalCode===null)googleServer.kill('SIGKILL');}if(internalDb)await internalDb.db.end();await pool.end();});

test('OTP is customer-only, CSRF-protected and invalid telephone input is rejected',async()=>{
 assert.equal((await request(anonymous,phone(1))).status,401);assert.equal((await request(sales,phone(1))).status,403);
 assert.equal((await users[0].request('/account/phone/request',{method:'POST',body:{phone:phone(1)},csrf:false})).status,403);
 assert.equal((await request(users[0],'not-a-phone')).status,422);
 const cfg=await users[0].ok('/config');assert.equal(cfg.auth.phone.mode,'simulated');assert.equal(cfg.auth.phone.expiresIn,300);assert.equal(cfg.auth.phone.retryAfter,60);
});

test('Simulation returns a practice code, stores only a hash, enforces cooldown and never claims SMS verification',async()=>{
 const c=users[0];const r=await request(c,'9001000001');assert.ok([200,201].includes(r.status),r.text);assert.equal(r.body.mode,'simulated');assert.equal(r.body.phone,phone(1));assert.match(r.body.demoCode,/^\d{6}$/);assert.match(r.body.message,/simulat|practice/i);
 const [row]=await sql('SELECT * FROM phone_verifications WHERE id=?',[r.body.challengeId]);assert.equal(row.user_id,c.user.id);assert.equal(row.phone,phone(1));assert.equal(row.mode,'simulated');assert.match(row.code_hash,/^[a-f0-9]{64}$/);assert.notEqual(row.code_hash,r.body.demoCode);assert.ok(!JSON.stringify(row).includes(`"${r.body.demoCode}"`));
 assert.equal((await request(c,phone(1))).status,429);
 const v=await verify(c,r.body.challengeId,r.body.demoCode);assert.equal(v.status,200,v.text);const u=unwrap(v);assert.equal(u.phone_verification_method,'simulated');assert.equal(u.phone_verified,false);assert.equal(u.phone,phone(1));
 assert.ok([400,409,410,422].includes((await verify(c,r.body.challengeId,r.body.demoCode)).status));assert.ok((await sql('SELECT consumed_at FROM phone_verifications WHERE id=?',[r.body.challengeId]))[0].consumed_at);
});

test('OTP expiry is enforced against the persisted challenge timestamp',async()=>{
 const c=users[1];const r=await request(c,phone(2));assert.ok([200,201].includes(r.status),r.text);
 await sql('UPDATE phone_verifications SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND WHERE id=?',[r.body.challengeId]);
 const v=await verify(c,r.body.challengeId,r.body.demoCode);assert.ok([400,409,410,422].includes(v.status),v.text);assert.equal((await c.ok('/account')).phone_verified,false);
});

test('Five incorrect OTP attempts are committed and the correct code cannot revive an exhausted challenge',async()=>{
 const c=users[2];const r=await request(c,phone(3));assert.ok([200,201].includes(r.status),r.text);const wrong=r.body.demoCode==='000000'?'000001':'000000';
 for(let i=0;i<5;i++){const v=await verify(c,r.body.challengeId,wrong);assert.ok([400,409,410,422,429].includes(v.status),v.text);const [row]=await sql('SELECT attempts FROM phone_verifications WHERE id=?',[r.body.challengeId]);assert.equal(row.attempts,i+1);}
 assert.ok([400,409,410,422,429].includes((await verify(c,r.body.challengeId,r.body.demoCode)).status));const u=await c.ok('/account');assert.equal(u.phone_verified,false);assert.equal(u.phone_verification_method,null);
});

test('OTP is bound to its account and is invalidated when the saved phone changes',async()=>{
 const c=users[3];const r=await request(c,phone(4));assert.ok([200,201].includes(r.status),r.text);
 assert.ok([400,403,404].includes((await verify(users[4],r.body.challengeId,r.body.demoCode)).status));
 assert.equal((await sql('SELECT attempts FROM phone_verifications WHERE id=?',[r.body.challengeId]))[0].attempts,0);
 await c.ok('/account',{method:'PATCH',body:{name:'Changed phone account',phone:phone(44)}});
 assert.ok([400,409,410,422].includes((await verify(c,r.body.challengeId,r.body.demoCode)).status));const saved=await c.ok('/account');assert.equal(saved.phone,phone(44));assert.equal(saved.phone_verified,false);assert.equal(saved.phone_verification_method,null);
});

test('Concurrent OTP submissions consume a challenge exactly once',async()=>{
 const c=users[4];const r=await request(c,phone(5));assert.ok([200,201].includes(r.status),r.text);
 const results=await Promise.all(Array.from({length:8},()=>verify(c,r.body.challengeId,r.body.demoCode)));assert.equal(results.filter(x=>x.status===200).length,1);assert.ok(results.filter(x=>x.status!==200).every(x=>[400,409,410,422].includes(x.status)));
 const u=await c.ok('/account');assert.equal(u.phone_verified,false);assert.equal(u.phone_verification_method,'simulated');
});

test('Hourly OTP request cap persists beyond cooldown and prior codes are invalidated',async()=>{
 const c=users[5];let previous;
 for(let i=0;i<5;i++){
  const r=await request(c,phone(6));assert.ok([200,201].includes(r.status),r.text);
  if(previous)assert.ok((await sql('SELECT consumed_at FROM phone_verifications WHERE id=?',[previous]))[0].consumed_at);
  previous=r.body.challengeId;await sql('UPDATE phone_verifications SET created_at=UTC_TIMESTAMP()-INTERVAL 61 SECOND WHERE id=?',[previous]);
 }
 assert.equal((await request(c,phone(6))).status,429);
});

test('Changing only the name preserves simulated status; changing phone clears it',async()=>{
 const c=users[0];const before=await c.ok('/account');assert.equal(before.phone_verification_method,'simulated');
 await c.ok('/account',{method:'PATCH',body:{name:'Changed name',phone:before.phone}});assert.equal((await c.ok('/account')).phone_verification_method,'simulated');
 await c.ok('/account',{method:'PATCH',body:{name:'Changed name',phone:phone(99)}});const after=await c.ok('/account');assert.equal(after.phone_verified,false);assert.equal(after.phone_verification_method,null);assert.equal(after.phone_verified_at,null);
});

test('Google without client configuration rejects sign-in/profile forgery and creates no account',async()=>{
 const c=new Client();await c.token();const cfg=await c.ok('/config');assert.equal(cfg.auth.google.enabled,false);
 const before=(await sql('SELECT COUNT(*) n FROM users'))[0].n;
 assert.equal((await c.request('/auth/google/challenge',{method:'POST',body:{purpose:'signin'}})).status,503);
 const r=await c.request('/auth/google',{method:'POST',body:{credential:'forged-google-id-token',email:'admin@mitti.test',role:'admin',sub:'fake'}});assert.ok([400,401,422,503].includes(r.status),r.text);
 assert.equal((await sql('SELECT COUNT(*) n FROM users'))[0].n,before);assert.equal((await c.request('/me')).status,401);
});

test('Configured Google challenge protects nonce/CSRF binding, expiry and malformed tokens',async()=>{
 const base=new URL(users[0].base);base.port=String(Number(base.port)+2);const c=new Client(base.origin);const backendURL=new URL('../backend/',import.meta.url);
 googleServer=spawn(process.execPath,['server.js'],{cwd:backendURL,env:{...process.env,PORT:base.port,GOOGLE_CLIENT_ID:'1234567890-local-invalid.apps.googleusercontent.com',EMBEDDED_WORKER:'false'},stdio:['ignore','pipe','pipe']});googleServer.stdout.on('data',d=>googleLogs+=d);googleServer.stderr.on('data',d=>googleLogs+=d);
 await poll(async()=>{try{return (await c.request('/health')).status;}catch{return 0;}},x=>x===200,20000);await c.token();
 const staff=sales.clone(base.origin);assert.equal((await staff.request('/auth/google/challenge',{method:'POST',body:{purpose:'link'}})).status,403);assert.equal((await c.request('/auth/google/challenge',{method:'POST',body:{purpose:'link'}})).status,401);
 const challenge=await c.request('/auth/google/challenge',{method:'POST',body:{purpose:'signin'}});assert.ok([200,201].includes(challenge.status),challenge.text);assert.ok(challenge.body.nonce);assert.equal(challenge.body.expiresIn,300);assert.ok(challenge.headers.getSetCookie().some(x=>/HttpOnly/i.test(x)));
 const before=(await sql('SELECT COUNT(*) n FROM users'))[0].n;
 const fake=await c.request('/auth/google',{method:'POST',body:{credential:'notbase64header.notbase64payload.notbase64signature000000000000',email:'admin@mitti.test'}});assert.equal(fake.status,401,fake.text);
 assert.equal((await sql('SELECT COUNT(*) n FROM users'))[0].n,before);assert.equal((await c.request('/me')).status,401);
 assert.equal((await sql("SELECT role,google_sub FROM users WHERE email='admin@mitti.test'"))[0].google_sub,null);
 const challengeId=c.cookies.get('google_challenge');const [stored]=await sql('SELECT * FROM google_challenges WHERE id=?',[challengeId]);assert.match(stored.nonce_hash,/^[a-f0-9]{64}$/);assert.notEqual(stored.nonce_hash,challenge.body.nonce);assert.equal(stored.attempts,1);assert.equal(stored.consumed_at,null);
 const other=new Client(base.origin);await other.token();other.cookies.set('google_challenge',challengeId);const rebound=await other.request('/auth/google',{method:'POST',body:{credential:'notbase64header.notbase64payload.notbase64signature000000000000'}});assert.equal(rebound.status,400);assert.equal(rebound.body.code,'GOOGLE_CHALLENGE');
 await sql('UPDATE google_challenges SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND WHERE id=?',[challengeId]);const expired=await c.request('/auth/google',{method:'POST',body:{credential:'notbase64header.notbase64payload.notbase64signature000000000000'}});assert.equal(expired.status,400);assert.equal(expired.body.code,'GOOGLE_CHALLENGE');
});


test('Verified Google-profile service refuses staff collision and requires explicit matching-email linking',async()=>{
 const {resolveGoogleProfile}=await import('../backend/src/identity.js');internalDb=await import('../backend/src/db.js');
 const claims={sub:`trusted-fixture-${tag}`,email:'admin@mitti.test',email_verified:true,name:'Trusted fixture'};
 await assert.rejects(()=>resolveGoogleProfile(claims),e=>e.status===403&&e.code==='GOOGLE_STAFF_BLOCKED');
 await assert.rejects(()=>resolveGoogleProfile({...claims,email:users[1].user.email}),e=>e.status===409&&e.code==='GOOGLE_LINK_REQUIRED');
 await assert.rejects(()=>resolveGoogleProfile({...claims,email:users[2].user.email},{purpose:'link',userId:users[1].user.id}),e=>e.status===409&&e.code==='GOOGLE_EMAIL_MISMATCH');
 await assert.rejects(()=>resolveGoogleProfile({...claims,email:users[1].user.email,email_verified:false}),e=>e.status===401&&e.code==='GOOGLE_UNVERIFIED');
 const linked=await resolveGoogleProfile({...claims,email:users[1].user.email},{purpose:'link',userId:users[1].user.id});assert.equal(linked.id,users[1].user.id);assert.equal(linked.role,'customer');assert.equal(linked.google_sub,claims.sub);
 const repeated=await resolveGoogleProfile({...claims,email:users[1].user.email});assert.equal(repeated.id,users[1].user.id);
});

test('Trusted verified-profile fixture creates only a customer with password sign-in disabled',async()=>{
 const {resolveGoogleProfile}=await import('../backend/src/identity.js');internalDb=await import('../backend/src/db.js');
 const u=await resolveGoogleProfile({sub:`googleonly-fixture-${tag}`,email:`googleonly-${tag}@mitti.test`,email_verified:true,name:'Google-only fixture',role:'admin'});assert.equal(u.role,'customer');assert.equal(Boolean(u.password_login_enabled),false);assert.equal(u.phone_verified,0);
 const c=new Client();await c.token();const rejected=await c.request('/login',{method:'POST',body:{email:u.email,password:'DemoOnly123!'}});assert.equal(rejected.status,401);
});

test('Production refuses simulated OTP and missing real SMS-provider credentials',async()=>{
 const cwd=new URL('../backend/',import.meta.url);const base={...process.env,NODE_ENV:'production',PAYMENT_MODE:'disabled',GOOGLE_CLIENT_ID:'',TWILIO_ACCOUNT_SID:'',TWILIO_AUTH_TOKEN:'',TWILIO_FROM:''};
 const simulated=spawnSync(process.execPath,['--input-type=module','-e',"import{validateConfig}from'./src/config.js';validateConfig();"],{cwd,env:{...base,PHONE_OTP_MODE:'simulated'},encoding:'utf8'});assert.notEqual(simulated.status,0);assert.match(simulated.stderr,/simulat/i);
 const missing=spawnSync(process.execPath,['--input-type=module','-e',"import{validateConfig}from'./src/config.js';validateConfig();"],{cwd,env:{...base,PHONE_OTP_MODE:'twilio'},encoding:'utf8'});assert.notEqual(missing.status,0);assert.match(missing.stderr,/Twilio|SMS|TWILIO/);
});
