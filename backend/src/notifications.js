import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import nodemailer from 'nodemailer';
import { config } from './config.js';
import { rows, transaction } from './db.js';
import { redis, redisReady, event } from './infra.js';
import { orderNotice } from './in-app.js';
import { BRAND_NAME } from './branding.js';
let queue, worker, workerConnection, timer, pumping = false;
const terminal = ['simulated','sent','accepted','skipped'];
export async function outbox(executor, { key, email, phone, subject, body, orderId = null, leadId = null }) {
  for (const [channel, recipient] of [['email', email], ['sms', phone]]) {
    await rows('INSERT IGNORE INTO notifications(event_key,channel,delivery_mode,recipient,subject,body,order_id,lead_id,status,error) VALUES(?,?,?,?,?,?,?,?,?,?)', [key, channel, config.notificationMode, recipient || '', subject, body, orderId, leadId, recipient ? 'pending' : 'skipped', recipient ? null : 'No recipient supplied'], executor);
  }
}
export async function orderOutbox(executor, order, key, message) {
  await orderNotice(executor,order,key,message);
  const [user] = await rows('SELECT email,phone,name FROM users WHERE id=?', [order.user_id], executor);
  await outbox(executor, { key, email:user.email,phone:user.phone,subject:`${BRAND_NAME} · Order #${order.id}`,body:`Hello ${user.name}, ${message}${order.tracking ? ` Tracking reference: ${order.tracking}.` : ''}`,orderId:order.id });
}
async function deliver(notification) {
  if (config.notificationMode === 'disabled') return { status:'skipped', error:'Notifications disabled in current configuration.' };
  // Preserve the operator's intent at commit time: an old local demo must never send when credentials are added later.
  if (notification.delivery_mode === 'simulated') return { status:'simulated', providerId:`simulated-${notification.id}` };
  if (notification.delivery_mode !== 'configured') return { status:'skipped', error:'Notifications were disabled when this event was created.' };
  if (config.notificationMode !== 'configured') return { status:'skipped', error:'Provider delivery is no longer enabled; historical messages are not promoted automatically.' };
  if (notification.channel === 'email') {
    if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) return { status:'skipped',error:'SMTP provider not configured.' };
    const transport = nodemailer.createTransport({ host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='true',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}:undefined,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000 });
    try { const info=await transport.sendMail({from:process.env.SMTP_FROM,to:notification.recipient,subject:notification.subject,text:notification.body,messageId:`<mitti-notification-${notification.id}@mitti.local>`});return {status:'sent',providerId:info.messageId}; } finally {transport.close();}
  }
  const sid=process.env.TWILIO_ACCOUNT_SID,token=process.env.TWILIO_AUTH_TOKEN,from=process.env.TWILIO_FROM;
  if(!sid||!token||!from)return {status:'skipped',error:'SMS provider not configured.'};
  const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:notification.recipient,From:from,Body:notification.body}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('SMS provider rejected the request.');const result=await response.json();return {status:'accepted',providerId:result.sid};
}
async function processNotification(job) {
  const notification = await transaction(async c=>{const [n]=await rows('SELECT * FROM notifications WHERE id=? FOR UPDATE',[job.data.id],c);if(!n||terminal.includes(n.status))return null;await rows("UPDATE notifications SET status='sending',attempts=attempts+1,error=NULL,lease_until=DATE_ADD(UTC_TIMESTAMP(), INTERVAL 60 SECOND) WHERE id=?",[n.id],c);return n;});
  if(!notification)return;
  try {const result=await deliver(notification);await rows('UPDATE notifications SET status=?,provider_id=?,error=?,sent_at=UTC_TIMESTAMP(),lease_until=NULL WHERE id=?',[result.status,result.providerId||null,result.error||null,notification.id]);event('notification:updated',{id:notification.id},['role:admin']);}
  catch {await rows("UPDATE notifications SET status='failed',error=?,lease_until=NULL WHERE id=?",['Provider request failed; automatic retry scheduled until retry limit.',notification.id]);event('notification:updated',{id:notification.id},['role:admin']);throw new Error('Notification provider request failed.');}
}
export async function pumpOutbox() {
  if(pumping||!redisReady()||!queue)return;pumping=true;
  try {await rows("UPDATE notifications SET status='pending',error='Recovered an expired worker lease; delivery may be retried.',lease_until=NULL WHERE status='sending' AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP())");const pending=await rows("SELECT id FROM notifications WHERE status IN ('pending','queued') ORDER BY id LIMIT 100");for(const n of pending){const previous=await queue.getJob(`notification-${n.id}`);if(previous){const state=await previous.getState();if(['completed','failed'].includes(state))await previous.remove();}await queue.add('deliver',{id:n.id},{jobId:`notification-${n.id}`,attempts:4,backoff:{type:'exponential',delay:1000},removeOnComplete:{age:86400,count:5000},removeOnFail:{age:604800,count:5000}});await rows("UPDATE notifications SET status='queued' WHERE id=? AND status='pending'",[n.id]);}}
  catch { /* Durable records remain in MySQL for retry when Redis returns. */ } finally {pumping=false;}
}
export function startNotifications({runWorker=config.workerEmbedded}={}) {
  queue=new Queue(config.redisPrefix + '-notifications-v2',{connection:redis});queue.on('error',()=>{});
  if(runWorker){workerConnection=new Redis(config.redisUrl,{maxRetriesPerRequest:null,connectTimeout:1500,retryStrategy:n=>Math.min(n*500,10000)});workerConnection.on('error',()=>{});worker=new Worker(config.redisPrefix + '-notifications-v2',processNotification,{connection:workerConnection,concurrency:4});worker.on('error',()=>{});}
  timer=setInterval(()=>pumpOutbox(),1000);timer.unref();void pumpOutbox();
}
export async function retryNotification(id) {
 const [n]=await rows('SELECT * FROM notifications WHERE id=?',[id]);if(!n)return false;if(terminal.includes(n.status))return false;
 if(queue&&redisReady()){const job=await queue.getJob(`notification-${id}`);if(job){const state=await job.getState();if(state==='active')return false;await job.remove();}}
 await rows("UPDATE notifications SET status='pending',error=NULL WHERE id=?",[id]);void pumpOutbox();return true;
}
export async function closeNotifications(){clearInterval(timer);if(worker)await worker.close();if(queue)await queue.close();workerConnection?.disconnect();}
