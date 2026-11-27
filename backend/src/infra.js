import Redis from 'ioredis';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import cookie from 'cookie';
import { config } from './config.js';
import { rows, json, transaction } from './db.js';
import { wrap, fail } from './util.js';
import { subscriptionReadiness, acknowledgedPublications } from './realtime-readiness.js';
export const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 1500, retryStrategy: times => Math.min(times * 500, 10000) });
redis.on('error', () => {});
let cacheEnabled=false;
redis.on('close',()=>{cacheEnabled=false;});
redis.on('ready',async()=>{cacheEnabled=false;try{await redis.incr(config.redisPrefix+':catalogue:version');cacheEnabled=true;}catch{ /* Bypass cached data until a healthy reconnection. */ }});
export let io;
let subscriber, subscriberGate, realtimeTimer, realtimeFlight, localEventCursor=0;
const locallyPublished = new Set();
const memoryLimits = new Map();
export const redisReady = () => redis.status === 'ready';
export const realtimeReady = () => Boolean(io && redisReady() && subscriberGate?.ready());
export async function connectRedis() { try { if (redis.status === 'wait') await redis.connect(); } catch { console.warn(JSON.stringify({ level: 'warn', message: 'Redis unavailable; notification outbox retained, shared cache and live updates degraded.' })); } }
export async function initSockets(server, verifySession, validCsrf) {
  io = new Server(server, { cors: { origin: config.origins, credentials: true }, maxHttpBufferSize: 1e5, pingInterval: config.socketPingInterval, pingTimeout: config.socketPingTimeout });
  subscriber = redis.duplicate({ lazyConnect: true, enableOfflineQueue: true, maxRetriesPerRequest: null }); subscriber.on('error', () => {});
  subscriberGate=subscriptionReadiness(subscriber,config.redisPrefix+':internal-events');
  subscriber.on('message', (channel, raw) => { if(channel !== config.redisPrefix + ':internal-events') return; try { const message=JSON.parse(raw); let target=io.local; for(const room of message.rooms) target=target.to(room); target.emit(message.name,message.payload); } catch { /* Ignore malformed private infrastructure events. */ } });
  try { await subscriber.connect(); } catch { /* Subscriber reconnects in the background. */ }
  // The adapter does not await publish promises. Catch outage errors explicitly so a committed order never crashes the API.
  const socketPublisher=new Proxy(redis,{get(target,key){if(key==='publish')return (...args)=>target.publish(...args).catch(()=>0);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  io.adapter(createAdapter(socketPublisher, subscriber, { key: config.redisPrefix + ':socket' }));
  // Do not block degraded boot on an offline queued command. /ready stays false
  // until SUBSCRIBE is acknowledged, including after every reconnect.
  void subscriberGate.enable();
  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && !config.origins.includes(origin)) throw fail('Origin denied', 403);
      const cookies = cookie.parse(socket.handshake.headers.cookie || '');
      if (cookies.session) {
        if (!validCsrf(cookies.csrf, socket.handshake.auth?.csrfToken)) throw fail('CSRF token required', 403);
        socket.data.user = await verifySession(cookies.session);
      }
      next();
    } catch { next(new Error('Authentication required')); }
  });
  io.on('connection', socket => {
    socket.join('public');
    const u = socket.data.user;
    if (u) {
      socket.join(`user:${u.id}`); socket.join(`user:${u.id}:role:${u.role}`); socket.join(`session:${u.jti}`); socket.join(`role:${u.role}`);
      const timeout = setTimeout(() => socket.disconnect(true), Math.max(1, u.exp * 1000 - Date.now())); timeout.unref();
      const recheck=setInterval(async()=>{try{await verifySession(cookie.parse(socket.handshake.headers.cookie||'').session);}catch{socket.disconnect(true);}},15000);recheck.unref();
      socket.on('disconnect', () => { clearTimeout(timeout); clearInterval(recheck); });
    }
  });
  realtimeTimer=setInterval(()=>{void flushRealtime();},300);realtimeTimer.unref();void flushRealtime();
}
export function event(name, payload, rooms) { if (!io) { if(redisReady()) void redis.publish(config.redisPrefix + ':internal-events',JSON.stringify({name,payload,rooms})).catch(()=>{}); return; } let target = redisReady()?io:io.local; for (const room of rooms) target = target.to(room); target.emit(name, payload); }
export function orderEvent(order) { event('order:updated', { id: order.id }, [`user:${order.user_id}`, 'role:admin']); }
export function leadEvent(id) { event('lead:updated', { id }, ['role:admin', 'role:sales']); }
export function revokeUser(id) { (redisReady()?io:io?.local)?.in(`user:${id}`).disconnectSockets(true); }
export function revokeSession(jti) { (redisReady()?io:io?.local)?.in(`session:${jti}`).disconnectSockets(true); }
// Durable refresh hints are inserted inside the same transaction as their data.
// Publication is at-least-once: clients refetch authoritative state and tolerate duplicate hints.
export async function queueEvent(executor, name, payload, rooms) {
  return (await rows('INSERT INTO realtime_events(event_name,rooms,payload) VALUES(?,?,?)',[name,JSON.stringify([...new Set(rooms)]),JSON.stringify(payload)],executor)).insertId;
}
export async function catalogueRevision(executor) {
  const [state]=await rows('SELECT revision FROM catalogue_state WHERE id=1',[],executor);
  return Number(state?.revision || 0);
}
export async function catalogueChanged(executor, productIds=[], reason='updated') {
  await rows('UPDATE catalogue_state SET revision=revision+1 WHERE id=1',[],executor);
  const revision=await catalogueRevision(executor);
  await queueEvent(executor,'catalogue',{revision,productIds:[...new Set(productIds.map(Number))],reason},['public']);
  return revision;
}
export async function customerChanged(executor, customerId, addressId) {
  if(addressId!==undefined) await queueEvent(executor,'address:updated',{id:addressId,customerId},[`user:${customerId}:role:customer`,'role:admin']);
  await queueEvent(executor,'customer:updated',{id:customerId},[`user:${customerId}:role:customer`,'role:admin']);
}
export async function flushRealtime() {
  if(realtimeFlight)return realtimeFlight;
  realtimeFlight=(async()=>{
    try {
      if(!redisReady() || (io && !realtimeReady())) {
        // Keep SQL rows pending for shared publication after recovery, but refresh local sockets now.
        if(!io)return;
        const pending=await rows('SELECT * FROM realtime_events WHERE published_at IS NULL AND id>? ORDER BY id LIMIT 100',[localEventCursor]);
        for(const record of pending){localEventCursor=record.id;if(locallyPublished.has(record.id))continue;let target=io.local;for(const room of json(record.rooms,[]))target=target.to(room);target.emit(record.event_name,{...json(record.payload,{}),eventId:Number(record.id)});locallyPublished.add(record.id);}
        if(pending.length<100)localEventCursor=0;
        if(locallyPublished.size>100000){locallyPublished.clear();localEventCursor=0;}
        return;
      }
      await transaction(async c=>{
        const pending=await rows('SELECT * FROM realtime_events WHERE published_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED',[],c);
        if(!pending.length)return;
        // Redis acknowledges publication before SQL marks the records published. A crash may replay a hint, never lose its data.
        const pipeline=redis.pipeline();
        for(const record of pending)pipeline.publish(config.redisPrefix+':internal-events',JSON.stringify({name:record.event_name,rooms:json(record.rooms,[]),payload:{...json(record.payload,{}),eventId:Number(record.id)}}));
        const published=await pipeline.exec();
        if(!acknowledgedPublications(published,pending.length))throw new Error('Realtime publication is temporarily unavailable.');
        await c.query(`UPDATE realtime_events SET published_at=UTC_TIMESTAMP() WHERE id IN (${pending.map(()=>'?').join(',')})`,pending.map(r=>r.id));
      });
      locallyPublished.clear();localEventCursor=0;
    } catch { /* Data and unread notifications remain committed; the next poll retries publication. */ }
  })().finally(()=>{realtimeFlight=null;});
  return realtimeFlight;
}
// Kept for scripts that intentionally perform catalogue changes outside an HTTP route.
export async function invalidateCatalogue() { await transaction(c=>catalogueChanged(c));await flushRealtime(); }
export async function cachedCatalogue(key, fetcher) {
  // A MySQL revision changes atomically with stock. Redis outages or a process crash between
  // commit and publication can therefore never leave an old inventory cache valid.
  const revision=await catalogueRevision();
  if (!redisReady() || !cacheEnabled) return {...await fetcher(),revision};
  try { const generation = await redis.get(config.redisPrefix + ':catalogue:version') || '0'; const full = `${config.redisPrefix}:catalogue:${generation}:${revision}:${key}`; const hit = await redis.get(full); if (hit) return JSON.parse(hit); const value = {...await fetcher(),revision}; await redis.set(full, JSON.stringify(value), 'EX', 30); return value; } catch { return {...await fetcher(),revision}; }
}
export function rateLimit(scope, limit, seconds = 60, userKey = false) {
  return wrap(async (req, res, next) => {
    const key = `${config.redisPrefix}:rate:${scope}:${userKey ? req.user?.id || req.ip : req.ip}`; const maximum = limit * config.rateMultiplier; let count;
    if (redisReady()) {
      try { count = await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n", 1, key, seconds); } catch { count = undefined; }
    }
    if (count === undefined) {
      const now = Date.now(); let item = memoryLimits.get(key); if (!item || item.expires < now) item = { count: 0, expires: now + seconds * 1000 }; item.count++; memoryLimits.set(key, item); count = item.count;
      if (memoryLimits.size > 10000) for (const [k, v] of memoryLimits) if (v.expires < now) memoryLimits.delete(k);
      res.set('X-RateLimit-Mode', 'local-degraded');
    }
    res.set('RateLimit-Limit', String(maximum)); res.set('RateLimit-Remaining', String(Math.max(0, maximum - count)));
    if (count > maximum) { res.set('Retry-After', String(seconds)); throw fail('Too many requests. Please try again shortly.', 429, 'RATE_LIMIT'); }
    next();
  });
}
export async function audit(actor, action, entityType, entityId, detail = {}, executor) { await rows('INSERT INTO audit_log(actor,action,entity_type,entity_id,detail) VALUES(?,?,?,?,?)', [actor || null, action, entityType, entityId == null ? null : String(entityId), JSON.stringify(detail)], executor); }
export async function closeInfra() { clearInterval(realtimeTimer);if(realtimeFlight)await realtimeFlight; if (io) await new Promise(resolve => io.close(resolve)); if (subscriber) subscriber.disconnect(); redis.disconnect(); }
