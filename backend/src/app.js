import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs/promises';
import { config, root, paymentConfig } from './config.js';
import { db, rows, json } from './db.js';
import { authRouter, csrfProtection, admin } from './auth.js';
import { catalogueRouter } from './catalogue.js';
import { createMediaRouter } from './media.js';
import { ordersRouter, webhookHandler, normalizeOrder } from './orders.js';
import { leadsRouter } from './leads.js';
import { identityRouter } from './identity.js';
import { passwordRecoveryRouter, passwordRecoveryReady } from './password-recovery.js';
import { accountsRouter } from './accounts.js';
import { inAppRouter } from './in-app.js';
import { redisReady, realtimeReady, rateLimit, audit } from './infra.js';
import { retryNotification } from './notifications.js';
import { requestId, wrap, fail, id, paged } from './util.js';
export async function createApp(){
 const tileOrigin=new URL(config.mapTileUrl).origin;
 const app=express();if(config.trustProxy)app.set('trust proxy',config.trustProxy);app.disable('x-powered-by');app.use(requestId);
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'",'https://checkout.razorpay.com','https://accounts.google.com'],connectSrc:["'self'",'ws:','wss:','https://api.razorpay.com','https://lumberjack.razorpay.com','https://accounts.google.com',...(config.locationProvider==='bigdatacloud'?['https://api.bigdatacloud.net']:[])],frameSrc:['https://api.razorpay.com','https://checkout.razorpay.com','https://accounts.google.com'],imgSrc:["'self'",'data:','blob:','https://*.tile.openstreetmap.org','https://tile.openstreetmap.org',tileOrigin],styleSrc:["'self'","'unsafe-inline'",'https://accounts.google.com'],fontSrc:["'self'",'data:'],objectSrc:["'none'"],baseUri:["'self'"],formAction:["'self'"],upgradeInsecureRequests:config.production?[]:null}},referrerPolicy:{policy:config.production?'strict-origin-when-cross-origin':'no-referrer-when-downgrade'},crossOriginOpenerPolicy:{policy:'same-origin-allow-popups'},crossOriginResourcePolicy:{policy:'same-origin'}}));
 app.use((req,res,next)=>{const start=Date.now();res.on('finish',()=>{if(req.path==='/api/health')return;console.log(JSON.stringify({level:'info',requestId:req.requestId,method:req.method,path:req.path,status:res.statusCode,durationMs:Date.now()-start}));});next();});
 app.post('/api/payments/webhook',rateLimit('webhook',300,60),express.raw({type:'application/json',limit:'256kb'}),webhookHandler);
 app.use(express.json({limit:'1mb'}),cookieParser());
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();},csrfProtection);
 app.use('/uploads',createMediaRouter({directory:config.uploads,findUpload:async filename=>(await rows('SELECT filename,storage,content,mime_type FROM uploads WHERE filename=?',[filename]))[0]}));
 app.get('/api/health',wrap(async(req,res)=>{let database=true;try{await db.query('SELECT 1');}catch{database=false;}res.status(database?200:503).json({ok:database,status:database&&redisReady()&&realtimeReady()?'ready':'degraded',database,redis:redisReady(),realtime:realtimeReady(),notificationMode:config.notificationMode,paymentMode:config.paymentMode,workerEmbedded:config.workerEmbedded});}));
 app.get('/api/ready',wrap(async(req,res)=>{let database=true;try{await db.query('SELECT 1');}catch{database=false;}const ready=database&&redisReady()&&realtimeReady();res.status(ready?200:503).json({ready,database,redis:redisReady(),realtime:realtimeReady()});}));
 app.get('/api/config',(req,res)=>res.json({payment:paymentConfig(),notifications:{mode:config.notificationMode},location:{provider:config.locationProvider,enabled:config.locationProvider!=='disabled',attribution:'Powered by BigDataCloud'},maps:{enabled:config.mapEnabled,tileUrl:config.mapTileUrl,attribution:'© OpenStreetMap contributors'},redis:redisReady(),auth:{google:{enabled:Boolean(config.googleClientId),clientId:config.googleClientId||null},phone:{mode:config.phoneOtpMode,expiresIn:300,retryAfter:60},passwordReset:{enabled:passwordRecoveryReady()}}}));
 app.use('/api',authRouter,identityRouter,passwordRecoveryRouter,accountsRouter,inAppRouter,catalogueRouter,ordersRouter,leadsRouter);
 app.get('/api/admin/dashboard',admin,wrap(async(req,res)=>{
  const [[counts],[leads],[inventory],[summary],recent,lowStockProducts]=await Promise.all([
    rows("SELECT SUM(CASE WHEN DATE(CONVERT_TZ(created_at,'+00:00','+05:30'))=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+05:30')) THEN 1 ELSE 0 END) ordersToday,COALESCE(SUM(CASE WHEN status='Delivered' AND DATE_FORMAT(CONVERT_TZ(created_at,'+00:00','+05:30'),'%Y-%m')=DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+05:30'),'%Y-%m') THEN total ELSE 0 END),0) revenueMonth,COUNT(*) totalOrders FROM orders"),
    rows("SELECT SUM(CASE WHEN status='New' THEN 1 ELSE 0 END) newLeads,SUM(CASE WHEN followup<=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+05:30')) AND status NOT IN ('Converted','Lost') THEN 1 ELSE 0 END) todayFollowups FROM leads"),
    rows('SELECT COUNT(*) lowStock FROM products WHERE active=1 AND stock<=5'),
    rows("SELECT (SELECT COUNT(*) FROM products WHERE active=1) products,(SELECT COUNT(*) FROM users WHERE role='customer') customers"),
    rows('SELECT o.*,u.name FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 6'),
    rows('SELECT id,name,stock,unit FROM products WHERE active=1 AND stock<=5 ORDER BY stock,id LIMIT 5')
  ]);res.json({ordersToday:Number(counts.ordersToday||0),revenueMonth:Number(counts.revenueMonth),newLeads:Number(leads.newLeads||0),todayFollowups:Number(leads.todayFollowups||0),lowStock:Number(inventory.lowStock),lowStockProducts,summary:{...summary,orders:Number(counts.totalOrders)},recentOrders:recent.map(normalizeOrder),serviceStatus:{database:true,redis:redisReady(),payment:config.paymentMode,notifications:config.notificationMode}});
 }));
 app.get('/api/admin/activity',admin,wrap(async(req,res)=>{const data=await paged(req,db,'SELECT a.*,u.name actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor ORDER BY a.id DESC','SELECT COUNT(*) total FROM audit_log');data.items=data.items.map(x=>({...x,detail:json(x.detail,{})}));res.json(data);}));
 app.get('/api/admin/notifications',admin,wrap(async(req,res)=>{const params=[],where=req.query.status?' WHERE status=?':'';if(req.query.status)params.push(String(req.query.status).slice(0,30));res.json(await paged(req,db,`SELECT id,event_key,channel,delivery_mode,recipient,subject,status,attempts,error,provider_id,order_id,lead_id,created_at,sent_at FROM notifications${where} ORDER BY id DESC`,`SELECT COUNT(*) total FROM notifications${where}`,params));}));
 app.post('/api/admin/notifications/:id/retry',admin,wrap(async(req,res)=>{const notificationId=id(req.params.id);if(!await retryNotification(notificationId))throw fail('This notification is complete, in progress, or missing.',409);await audit(req.user.id,'notification.retry','notification',notificationId);res.json({ok:true});}));
 app.use('/api',(req,res)=>res.status(404).json({error:'API endpoint not found.'}));
 const dist=path.resolve(root,'../frontend/dist');try{await fs.access(path.join(dist,'index.html'));app.use(express.static(dist));app.get('/{*path}',(req,res)=>res.sendFile(path.join(dist,'index.html')));}catch{/* Vite is used during development. */}
 app.use((error,req,res,next)=>{
  if(res.headersSent)return next(error);let status=error.status||500,message=error.status?error.message:'Something went wrong. Please try again.';
  if(error.code==='ER_DUP_ENTRY'){status=409;message='This email, name, or reference already exists.';}
  if(error.code==='LIMIT_FILE_SIZE'){status=413;message='Each image must be 5 MB or smaller.';}
  if(['LIMIT_FILE_COUNT','LIMIT_UNEXPECTED_FILE','LIMIT_PART_COUNT'].includes(error.code)){status=422;message='Upload up to 8 images using the images field.';}
  if(error.type==='entity.parse.failed'){status=400;message='Invalid JSON request.';}
  if(error.type==='entity.too.large'){status=413;message='Request body is too large.';}
  console.error(JSON.stringify({level:'error',requestId:req.requestId,code:error.code||'REQUEST_ERROR',status}));res.status(status).json({error:message,code:error.status?error.code:undefined,requestId:req.requestId});
 });return app;
}
