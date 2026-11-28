import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import bcrypt from 'bcryptjs';
import { randomBytes, randomInt, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { BRAND_NAME } from './branding.js';
import { rows, transaction } from './db.js';
import { auth, publicUser, setSession, verifySession } from './auth.js';
import { audit, rateLimit, customerChanged, flushRealtime } from './infra.js';
import { fail, parse, wrap, text } from './util.js';
export const identityRouter = Router();
const googleClient = new OAuth2Client(config.googleClientId || undefined);
const hmac = value => createHmac('sha256', config.secret).update(value).digest('hex');
const constantEqual = (a,b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const googleCookie = { httpOnly:true,secure:config.production,sameSite:'lax',path:'/api/auth/google',maxAge:300000 };
function requireGoogle(){ if(!config.googleClientId)throw fail('Google sign-in is not configured. Use email and password.',503,'GOOGLE_UNAVAILABLE'); }
export function googleCredentialHasValidShape(credential) {
 try {
  const parts=credential.split('.');if(parts.length!==3||parts.some(p=>!p||!/^[A-Za-z0-9_-]+$/.test(p)))return false;
  const header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8')),payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  return header&&header.alg==='RS256'&&typeof header.kid==='string'&&header.kid.length>0&&header.kid.length<=200&&payload&&typeof payload==='object'&&!Array.isArray(payload);
 }catch{return false;}
}


// This internal service accepts claims ONLY after Google's SDK has validated the token.
// It is exported for isolated account-linking tests, never exposed as a raw-profile HTTP endpoint.
export async function resolveGoogleProfile(claims,{purpose='signin',userId=null}={},executor){
 if(!executor)return transaction(c=>resolveGoogleProfile(claims,{purpose,userId},c));
 if(claims.email_verified!==true||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255||typeof claims.email!=='string'||!/^\S+@\S+\.\S+$/.test(claims.email)||claims.email.length>190)throw fail('A verified Google email is required.',401,'GOOGLE_UNVERIFIED');
 const email=claims.email.toLowerCase();
 if(purpose==='link'){
  const [current]=await rows('SELECT * FROM users WHERE id=? FOR UPDATE',[userId],executor);if(!current||!current.active||current.role!=='customer')throw fail('Only an active customer can link Google.',403,'GOOGLE_STAFF_BLOCKED');
  if(current.email.toLowerCase()!==email)throw fail('Choose the Google account with the same email as your store account.',409,'GOOGLE_EMAIL_MISMATCH');
  const [attached]=await rows('SELECT id FROM users WHERE google_sub=? FOR UPDATE',[claims.sub],executor);if(attached&&attached.id!==current.id)throw fail('That Google account is linked to another customer.',409,'GOOGLE_ALREADY_LINKED');
  if(current.google_sub&&current.google_sub!==claims.sub)throw fail('This store account is already linked to another Google account.',409,'GOOGLE_ALREADY_LINKED');
  await rows('UPDATE users SET google_sub=?,google_email=? WHERE id=?',[claims.sub,email,current.id],executor);await audit(current.id,'auth.google_linked','user',current.id,{},executor);await customerChanged(executor,current.id);return {...current,google_sub:claims.sub,google_email:email};
 }
 const [linked]=await rows('SELECT * FROM users WHERE google_sub=? FOR UPDATE',[claims.sub],executor);
 if(linked){if(!linked.active||linked.role!=='customer')throw fail('Google sign-in is unavailable for this account.',403,'GOOGLE_STAFF_BLOCKED');await rows('UPDATE users SET google_email=? WHERE id=?',[email,linked.id],executor);await audit(linked.id,'auth.google_login','user',linked.id,{},executor);return {...linked,google_email:email};}
 const [existing]=await rows('SELECT * FROM users WHERE email=? FOR UPDATE',[email],executor);
 if(existing){if(existing.role!=='customer')throw fail('Staff accounts must use their staff password.',403,'GOOGLE_STAFF_BLOCKED');throw fail('An account with this email exists. Sign in with its password, then link Google in Account.',409,'GOOGLE_LINK_REQUIRED');}
 const name=typeof claims.name==='string'&&claims.name.trim()?claims.name.trim().slice(0,100):'Google Customer';
 const result=await rows('INSERT INTO users(name,email,phone,password,role,google_sub,google_email,password_login_enabled) VALUES(?,?,?,?,?,?,?,0)',[name,email,'',await bcrypt.hash(randomBytes(36).toString('base64url'),12),'customer',claims.sub,email],executor);
 await audit(result.insertId,'auth.google_registered','user',result.insertId,{},executor);await customerChanged(executor,result.insertId);return (await rows('SELECT * FROM users WHERE id=?',[result.insertId],executor))[0];
}
identityRouter.post('/auth/google/challenge',rateLimit('google-challenge',30,900),wrap(async(req,res)=>{
 requireGoogle();const {purpose}=parse(z.object({purpose:z.enum(['signin','link']).default('signin')}),req.body||{});let user=null;if(purpose==='link'){user=await verifySession(req.cookies.session);if(user.role!=='customer')throw fail('Staff accounts cannot link Google.',403);}
 const nonce=randomBytes(32).toString('hex'),challengeId=randomUUID();
 await transaction(async c=>{if(req.cookies.google_challenge)await rows('UPDATE google_challenges SET consumed_at=UTC_TIMESTAMP() WHERE id=? AND consumed_at IS NULL',[req.cookies.google_challenge],c);await rows('INSERT INTO google_challenges(id,nonce_hash,csrf_hash,purpose,user_id,expires_at) VALUES(?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE))',[challengeId,hmac(nonce),hmac(req.cookies.csrf),purpose,user?.id||null],c);});
 res.cookie('google_challenge',challengeId,googleCookie).json({nonce,expiresIn:300});
}));
identityRouter.post('/auth/google',rateLimit('google-login',15,900),wrap(async(req,res)=>{
 requireGoogle();const {credential}=parse(z.object({credential:z.string().min(30).max(12000)}),req.body);const challengeId=req.cookies.google_challenge;
 const [preflight]=challengeId?await rows('SELECT *,expires_at>UTC_TIMESTAMP() valid FROM google_challenges WHERE id=?',[challengeId]):[];
 if(!preflight||preflight.consumed_at||!preflight.valid||preflight.attempts>=5||!constantEqual(preflight.csrf_hash,hmac(req.cookies.csrf)))throw fail('Google sign-in challenge expired. Reload the sign-in button.',400,'GOOGLE_CHALLENGE');
 if(!googleCredentialHasValidShape(credential)){await rows('UPDATE google_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL',[challengeId]);throw fail('Google credential format is invalid.',401,'GOOGLE_TOKEN_INVALID');}
 let claims;try{const ticket=await googleClient.verifyIdToken({idToken:credential,audience:config.googleClientId});claims=ticket.getPayload();}catch{await rows('UPDATE google_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL',[challengeId]);throw fail('Google could not verify this sign-in. Please try again.',401,'GOOGLE_TOKEN_INVALID');}
 if(!claims||!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||claims.aud!==config.googleClientId||claims.email_verified!==true||!Number.isInteger(claims.exp)||claims.exp*1000<=Date.now()||!constantEqual(hmac(String(claims.nonce||'')),preflight.nonce_hash)){await rows('UPDATE google_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL',[challengeId]);throw fail('Google token claims do not match this sign-in request.',401,'GOOGLE_TOKEN_INVALID');}
 let linkUser=null;if(preflight.purpose==='link'){linkUser=await verifySession(req.cookies.session);if(linkUser.role!=='customer'||linkUser.id!==preflight.user_id)throw fail('Sign in again before linking Google.',403);}
 const user=await transaction(async c=>{const [challenge]=await rows('SELECT *,expires_at>UTC_TIMESTAMP() valid FROM google_challenges WHERE id=? FOR UPDATE',[challengeId],c);if(!challenge||challenge.consumed_at||!challenge.valid||challenge.attempts>=5||!constantEqual(challenge.csrf_hash,hmac(req.cookies.csrf)))throw fail('This Google challenge has already been used or expired.',409,'GOOGLE_CHALLENGE');const user=await resolveGoogleProfile(claims,{purpose:challenge.purpose,userId:linkUser?.id},c);await rows('UPDATE google_challenges SET consumed_at=UTC_TIMESTAMP() WHERE id=?',[challengeId],c);return user;});
 await flushRealtime();res.clearCookie('google_challenge',googleCookie);setSession(res,user);res.json(publicUser(user));
}));

export function normalizePhone(value){const compact=String(value).trim().replace(/[ ()-]/g,'');const normalized=/^[6-9]\d{9}$/.test(compact)?'+91'+compact:compact;if(!/^\+[1-9]\d{7,14}$/.test(normalized))throw fail('Use a valid mobile number with country code, or a 10-digit Indian mobile number.',422,'PHONE_FORMAT');return normalized;}
async function sendOtp(phone,code){const sid=process.env.TWILIO_ACCOUNT_SID,token=process.env.TWILIO_AUTH_TOKEN,from=process.env.TWILIO_FROM;const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:phone,From:from,Body:`Your ${BRAND_NAME} verification code is ${code}. It expires in 5 minutes. Do not share this code.`}),signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error('OTP provider request failed');}
// MSG91 Flow sender/template must be pre-approved. Template must use OTP variable.
async function sendMsg91Otp(phone,code) {
 const response=await fetch('https://control.msg91.com/api/v5/flow',{
  method:'POST',headers:{authkey:process.env.MSG91_AUTH_KEY,'Content-Type':'application/json',accept:'application/json'},
  body:JSON.stringify({template_id:process.env.MSG91_TEMPLATE_ID,
   recipients:[{mobiles:phone.replace(/^\+/,''),OTP:code}]}),
  signal:AbortSignal.timeout(12000)
 });
 if(!response.ok)throw new Error('SMS request rejected');
 const payload=await response.json();
 if(payload.type==='error'||payload.status==='error'||payload.hasError===true)
  throw new Error('SMS gateway rejected the request');
}
identityRouter.post('/account/phone/request',auth('customer'),rateLimit('phone-request-user',5,3600,true),rateLimit('phone-request-ip',20,3600),wrap(async(req,res)=>{
 if(config.phoneOtpMode==='disabled')throw fail('Phone verification is currently disabled.',503,'PHONE_UNAVAILABLE');if(config.production&&config.phoneOtpMode==='simulated')throw fail('Phone simulation is disabled.',503);
 const {phone:input}=parse(z.object({phone:text(40,8)}),req.body);const phone=normalizePhone(input),challengeId=randomUUID(),code=String(randomInt(100000,1000000));
 await transaction(async c=>{const [user]=await rows('SELECT phone FROM users WHERE id=? FOR UPDATE',[req.user.id],c);const [recent]=await rows('SELECT TIMESTAMPDIFF(SECOND,created_at,UTC_TIMESTAMP()) age FROM phone_verifications WHERE user_id=? ORDER BY created_at DESC LIMIT 1',[req.user.id],c);if(recent&&recent.age<60)throw fail(`Wait ${60-recent.age} seconds before requesting another code.`,429,'OTP_COOLDOWN');await rows('UPDATE phone_verifications SET consumed_at=UTC_TIMESTAMP() WHERE user_id=? AND consumed_at IS NULL',[req.user.id],c);await rows('INSERT INTO phone_verifications(id,user_id,phone,phone_snapshot,code_hash,mode,expires_at,delivery_status) VALUES(?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE),?)',[challengeId,req.user.id,phone,user.phone,hmac(challengeId+':'+code),config.phoneOtpMode,config.phoneOtpMode==='simulated'?'simulated':'pending'],c);await audit(req.user.id,'phone.code_requested','user',req.user.id,{mode:config.phoneOtpMode},c);});
 if(config.phoneOtpMode==='twilio'||config.phoneOtpMode==='msg91'){try{if(config.phoneOtpMode==='msg91')await sendMsg91Otp(phone,code);else await sendOtp(phone,code);await rows("UPDATE phone_verifications SET delivery_status='sent' WHERE id=?",[challengeId]);}catch{await rows("UPDATE phone_verifications SET delivery_status='failed',consumed_at=UTC_TIMESTAMP() WHERE id=?",[challengeId]);throw fail('SMS delivery could not be requested. Please try again after the cooldown.',503,'OTP_DELIVERY_FAILED');}}
 res.json({challengeId,phone,expiresIn:300,retryAfter:60,mode:config.phoneOtpMode,...(config.phoneOtpMode==='simulated'?{demoCode:code}:{}),message:config.phoneOtpMode==='simulated'?'Development simulation: no SMS was sent. This code tests the flow and does not verify phone ownership.':'Verification code requested by SMS.'});
}));
identityRouter.post('/account/phone/verify',auth('customer'),rateLimit('phone-verify',30,3600,true),wrap(async(req,res)=>{
 const {challengeId,code}=parse(z.object({challengeId:z.string().uuid(),code:z.string().regex(/^\d{6}$/,'Enter the six-digit code')}),req.body);
 const result=await transaction(async c=>{
  const [user]=await rows('SELECT * FROM users WHERE id=? FOR UPDATE',[req.user.id],c);const [challenge]=await rows('SELECT *,expires_at>UTC_TIMESTAMP() valid FROM phone_verifications WHERE id=? AND user_id=? FOR UPDATE',[challengeId,req.user.id],c);
  if(!challenge)return {error:'Code request not found.',status:404,code:'OTP_NOT_FOUND'};
  if(challenge.consumed_at)return {error:'This code has already been used or replaced.',status:409,code:'OTP_USED'};
  if(!challenge.valid){await rows('UPDATE phone_verifications SET consumed_at=UTC_TIMESTAMP() WHERE id=?',[challengeId],c);return {error:'The code expired. Request a new code.',status:410,code:'OTP_EXPIRED'};}
  if(challenge.phone_snapshot!==user.phone){await rows('UPDATE phone_verifications SET consumed_at=UTC_TIMESTAMP() WHERE id=?',[challengeId],c);return {error:'The account phone changed. Request a new code.',status:409,code:'OTP_PHONE_CHANGED'};}
  if(challenge.mode!==config.phoneOtpMode||config.production&&challenge.mode==='simulated')return {error:'Verification mode changed. Request a new code.',status:409,code:'OTP_MODE_CHANGED'};
  if(challenge.attempts>=5)return {error:'Too many incorrect codes. Request a new code.',status:429,code:'OTP_ATTEMPTS'};
  if(!['simulated','sent'].includes(challenge.delivery_status))return {error:'The verification message is not ready. Request a new code.',status:409,code:'OTP_NOT_READY'};
  await rows('UPDATE phone_verifications SET attempts=attempts+1 WHERE id=?',[challengeId],c);
  if(!constantEqual(challenge.code_hash,hmac(challengeId+':'+code)))return {error:challenge.attempts+1>=5?'Too many incorrect codes. Request a new code.':'The code is incorrect.',status:challenge.attempts+1>=5?429:400,code:'OTP_INCORRECT'};
  const actualSms=['twilio','msg91'].includes(challenge.mode);await rows('UPDATE phone_verifications SET consumed_at=UTC_TIMESTAMP() WHERE id=?',[challengeId],c);await rows('UPDATE users SET phone=?,phone_verified=?,phone_verification_method=?,phone_verified_at=? WHERE id=?',[challenge.phone,actualSms,actualSms?'sms':'simulated',actualSms?new Date():null,req.user.id],c);await audit(req.user.id,actualSms?'phone.verified':'phone.simulated','user',req.user.id,{method:actualSms?'sms':'simulated'},c);await customerChanged(c,req.user.id);return {user:publicUser((await rows('SELECT * FROM users WHERE id=?',[req.user.id],c))[0]),message:actualSms?'Phone verified by SMS.':'Practice verification completed. This phone number is not verified; no SMS was sent.'};
 });if(result.error)throw fail(result.error,result.status,result.code);await flushRealtime();res.json({...result.user,message:result.message});
}));
