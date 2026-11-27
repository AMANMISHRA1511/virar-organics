import { Router } from 'express';
import { z } from 'zod';
import { db, rows, transaction } from './db.js';
import { auth } from './auth.js';
import { wrap, id, parse, fail, paged } from './util.js';
import { queueEvent, flushRealtime } from './infra.js';

export const inAppRouter=Router();
const room=(userId,audience)=>`user:${userId}:role:${audience}`;
function notification(row) {
  return {...row,href:row.order_id ? (row.audience==='admin'?`/admin/orders/${row.order_id}`:`/account/orders/${row.order_id}`) : row.product_id?`/admin/products/${row.product_id}`:'/admin/products'};
}
async function createNotice(c, userId, audience, data) {
  const result=await rows('INSERT IGNORE INTO in_app_notifications(user_id,audience,event_key,type,title,body,order_id,product_id) VALUES(?,?,?,?,?,?,?,?)',[userId,audience,data.key,data.type,data.title,data.body,data.orderId??null,data.productId??null],c);
  if(result.affectedRows) await queueEvent(c,'inapp:notification',{id:result.insertId,type:data.type,orderId:data.orderId??null,productId:data.productId??null},[room(userId,audience)]);
}
export async function adminNotice(c,data) {
  const admins=await rows("SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id",[],c);
  for(const admin of admins)await createNotice(c,admin.id,'admin',data);
}
export async function orderNotice(c,order,key,message) {
  const type=key.endsWith('-placed')?'order.placed':key.includes('-payment-confirmed')?(order.payment_status==='refund_required'?'payment.refund_required':'payment.confirmed'):key.includes('-payment-failed-')?'payment.failed':'order.updated';
  const label={ 'order.placed':'Order placed','payment.refund_required':'Refund needs attention','payment.confirmed':'Payment confirmed','payment.failed':'Payment failed','order.updated':`Order ${String(order.status||'updated').toLowerCase()}` }[type];
  const data={key,type,title:`${label} · #${order.id}`,body:message,orderId:order.id};
  await createNotice(c,order.user_id,'customer',data);
  await adminNotice(c,data);
  await queueEvent(c,'order:updated',{id:order.id},[room(order.user_id,'customer'),'role:admin']);
  await queueEvent(c,'customer:updated',{id:order.user_id},['role:admin']);
}
export async function stockNotice(c,{productId,name,revision,reason}) {
  const unavailable=reason==='unavailable';
  await adminNotice(c,{key:`inventory-${revision}-${productId}`,type:unavailable?'inventory.unavailable':'inventory.out_of_stock',title:unavailable?'Product marked unavailable':'Product is out of stock',body:`${name} ${unavailable?'is no longer available to customers.':'has no stock remaining. New checkout requests cannot reserve it.'}`,productId});
}

inAppRouter.get('/account/notifications',auth('customer','admin'),wrap(async(req,res)=>{
  const where=' WHERE user_id=? AND audience=?'+(req.query.unread==='true'?' AND read_at IS NULL':'');
  const params=[req.user.id,req.user.role];
  const data=await paged(req,db,`SELECT id,audience,type,title,body,order_id,product_id,read_at,created_at FROM in_app_notifications${where} ORDER BY id DESC`,`SELECT COUNT(*) total FROM in_app_notifications${where}`,params);
  const [count]=await rows('SELECT COUNT(*) total FROM in_app_notifications WHERE user_id=? AND audience=? AND read_at IS NULL',params);
  res.json({...data,items:data.items.map(notification),unreadCount:Number(count.total)});
}));
inAppRouter.patch('/account/notifications/:id',auth('customer','admin'),wrap(async(req,res)=>{
  parse(z.object({read:z.literal(true)}),req.body);const notificationId=id(req.params.id);
  await transaction(async c=>{
    const [n]=await rows('SELECT id FROM in_app_notifications WHERE id=? AND user_id=? AND audience=? FOR UPDATE',[notificationId,req.user.id,req.user.role],c);if(!n)throw fail('Notification not found.',404);
    await rows('UPDATE in_app_notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP()) WHERE id=?',[notificationId],c);
    await queueEvent(c,'inapp:notification',{id:notificationId,type:'read'},[room(req.user.id,req.user.role)]);
  });await flushRealtime();res.json({ok:true});
}));
inAppRouter.post('/account/notifications/read-all',auth('customer','admin'),wrap(async(req,res)=>{
  await transaction(async c=>{await rows('UPDATE in_app_notifications SET read_at=UTC_TIMESTAMP() WHERE user_id=? AND audience=? AND read_at IS NULL',[req.user.id,req.user.role],c);await queueEvent(c,'inapp:notification',{id:null,type:'read'},[room(req.user.id,req.user.role)]);});await flushRealtime();res.json({ok:true});
}));
