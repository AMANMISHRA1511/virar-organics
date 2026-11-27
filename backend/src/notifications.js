import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import nodemailer from 'nodemailer';
import { config } from './config.js';
import { rows, transaction } from './db.js';
import { redis, redisReady, event } from './infra.js';
import { orderNotice } from './in-app.js';
import { BRAND_NAME } from './branding.js';
let queue, worker, workerConnection, timer;
const terminal = ['simulated','sent','accepted','skipped'];
export const AUTOMATIC_NOTIFICATION_ATTEMPTS = 4;
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
export function notificationRetryPlan(notification, now = new Date()) {
  const remaining = Math.max(0, Number(notification.attempt_limit) - Number(notification.attempts));
  if (!remaining) return { retryAt: null, error: 'Provider request failed; automatic retry limit reached. Use manual retry.' };
  const cycleAttempt = Math.max(1, Math.min(AUTOMATIC_NOTIFICATION_ATTEMPTS, AUTOMATIC_NOTIFICATION_ATTEMPTS - remaining));
  return {
    retryAt: new Date(Number(now) + 1000 * 2 ** (cycleAttempt - 1)),
    error: 'Provider request failed; automatic retry scheduled.',
  };
}

// SQL owns the retry budget, due time and delivery lease. Redis is replaceable:
// deleting a BullMQ job must neither lose an allowed retry nor grant new attempts.
// Dependencies are injectable for deterministic reset/race tests without providers.
export function createNotificationRuntime({
  query = rows, transact = transaction, send = deliver, publish = event,
  getQueue = () => queue, ready = redisReady, now = () => new Date(),
} = {}) {
  let pumping = false;
  const notify = id => publish('notification:updated', { id }, ['role:admin']);
  async function process(job) {
    const notification = await transact(async c => {
      const [record] = await query('SELECT * FROM notifications WHERE id=? FOR UPDATE', [job.data.id], c);
      if (!record || !['pending', 'queued', 'failed'].includes(record.status)
        || Number(record.attempts) >= Number(record.attempt_limit)) return null;
      const claimed = await query("UPDATE notifications SET status='sending',attempts=attempts+1,error=NULL,lease_until=DATE_ADD(UTC_TIMESTAMP(), INTERVAL 60 SECOND),retry_at=NULL WHERE id=? AND status IN ('pending','queued','failed') AND attempts<attempt_limit AND (retry_at IS NULL OR retry_at<=UTC_TIMESTAMP())", [record.id], c);
      return claimed.affectedRows ? { ...record, attempts: Number(record.attempts) + 1 } : null;
    });
    if (!notification) return;
    let result;
    try { result = await send(notification); }
    catch {
      const retry = notificationRetryPlan(notification, now());
      const failed = await query("UPDATE notifications SET status='failed',error=?,retry_at=?,lease_until=NULL WHERE id=? AND status='sending' AND attempts=?", [retry.error, retry.retryAt, notification.id, notification.attempts]);
      if (failed.affectedRows) notify(notification.id);
      throw new Error('Notification provider request failed.');
    }
    // A slow worker whose lease was recovered cannot overwrite a newer attempt.
    // A DB error here leaves the lease for recovery; it is not a provider failure.
    const completed = await query("UPDATE notifications SET status=?,provider_id=?,error=?,sent_at=UTC_TIMESTAMP(),lease_until=NULL,retry_at=NULL WHERE id=? AND status='sending' AND attempts=?", [result.status, result.providerId || null, result.error || null, notification.id, notification.attempts]);
    if (completed.affectedRows) notify(notification.id);
  }
  async function pump() {
    const currentQueue = getQueue();
    if (pumping || !ready() || !currentQueue) return;
    pumping = true;
    try {
      await query("UPDATE notifications SET status=CASE WHEN attempts<attempt_limit THEN 'pending' ELSE 'failed' END,error=CASE WHEN attempts<attempt_limit THEN 'Recovered an expired worker lease; delivery may be retried.' ELSE 'Worker lease expired after the automatic retry limit; manual retry required.' END,lease_until=NULL,retry_at=NULL WHERE status='sending' AND (lease_until IS NULL OR lease_until<=UTC_TIMESTAMP())");
      const pending = await query("SELECT id FROM notifications WHERE status IN ('pending','queued','failed') AND attempts<attempt_limit AND (retry_at IS NULL OR retry_at<=UTC_TIMESTAMP()) ORDER BY id LIMIT 100");
      for (const notification of pending) {
        const jobId = `notification-${notification.id}`;
        const previous = await currentQueue.getJob(jobId);
        if (previous) {
          const state = await previous.getState();
          if (['completed', 'failed'].includes(state)) await previous.remove();
          else if (state !== 'unknown') continue;
        }
        await currentQueue.add('deliver', { id: notification.id }, {
          jobId, attempts: 1, removeOnComplete: { age: 86400, count: 5000 },
          removeOnFail: { age: 604800, count: 5000 },
        });
        await query("UPDATE notifications SET status='queued' WHERE id=? AND status IN ('pending','failed') AND attempts<attempt_limit AND (retry_at IS NULL OR retry_at<=UTC_TIMESTAMP())", [notification.id]);
      }
    } catch { /* Durable SQL rows retain their budget and due time until recovery. */ }
    finally { pumping = false; }
  }
  async function retry(id) {
    const accepted = await transact(async c => {
      const [notification] = await query('SELECT * FROM notifications WHERE id=? FOR UPDATE', [id], c);
      if (!notification || terminal.includes(notification.status) || notification.status === 'sending') return false;
      await query("UPDATE notifications SET status='pending',error=NULL,attempt_limit=attempts+?,retry_at=NULL,lease_until=NULL WHERE id=?", [AUTOMATIC_NOTIFICATION_ATTEMPTS, id], c);
      return true;
    });
    if (!accepted) return false;
    const currentQueue = getQueue();
    if (currentQueue && ready()) {
      try {
        const job = await currentQueue.getJob(`notification-${id}`);
        if (job && await job.getState() !== 'active') await job.remove();
      } catch { /* The committed manual retry survives queue loss or an activation race. */ }
    }
    void pump();
    return true;
  }
  return { process, pump, retry };
}
const runtime = createNotificationRuntime();
export const pumpOutbox = () => runtime.pump();
export function startNotifications({runWorker=config.workerEmbedded}={}) {
  queue=new Queue(config.redisPrefix + '-notifications-v2',{connection:redis});queue.on('error',()=>{});
  if(runWorker){workerConnection=new Redis(config.redisUrl,{maxRetriesPerRequest:null,connectTimeout:1500,retryStrategy:n=>Math.min(n*500,10000)});workerConnection.on('error',()=>{});worker=new Worker(config.redisPrefix + '-notifications-v2',runtime.process,{connection:workerConnection,concurrency:4});worker.on('error',()=>{});}
  timer=setInterval(()=>pumpOutbox(),1000);timer.unref();void pumpOutbox();
}
export const retryNotification = id => runtime.retry(id);
export async function closeNotifications(){clearInterval(timer);if(worker)await worker.close();if(queue)await queue.close();workerConnection?.disconnect();}
