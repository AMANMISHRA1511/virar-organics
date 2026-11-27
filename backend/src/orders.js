import { Router } from 'express';
import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { db, rows, json, transaction } from './db.js';
import { admin, auth } from './auth.js';
import { id, parse, wrap, fail, text, phone, latitude, longitude, paged, cents, csv } from './util.js';
import { getSettings } from './catalogue.js';
import { audit, catalogueChanged, flushRealtime, rateLimit } from './infra.js';
import { orderOutbox, pumpOutbox } from './notifications.js';
import { checkoutAddressSchema } from './address-schema.js';
import { stockNotice } from './in-app.js';
import { makeOrderBillPdf } from './order-bill-pdf.js';
export const ordersRouter=Router();
export const normalizeOrder=o=>({...o,address:json(o.address,{}),subtotal:Number(o.subtotal),delivery_charge:Number(o.delivery_charge),total:Number(o.total),latitude:o.latitude==null?null:Number(o.latitude),longitude:o.longitude==null?null:Number(o.longitude),driver_lat:o.driver_lat==null?null:Number(o.driver_lat),driver_lng:o.driver_lng==null?null:Number(o.driver_lng),stock_restored:Boolean(o.stock_restored)});
export async function getOrder(orderId,user){const [o]=await rows('SELECT o.*,u.name,u.email,u.phone FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?',[orderId]);if(!o||user&&user.role!=='admin'&&o.user_id!==user.id)throw fail('Order not found.',404);const result=normalizeOrder(o);result.items=await rows('SELECT product_id,name,quantity,price,unit,image FROM order_items WHERE order_id=? ORDER BY id',[o.id]);result.timeline=await rows('SELECT a.id,a.status,a.detail,a.created_at,u.name actor_name FROM order_activity a LEFT JOIN users u ON u.id=a.actor WHERE a.order_id=? ORDER BY a.id',[o.id]);result.notifications=await rows('SELECT id,event_key,subject,channel,delivery_mode,status,attempts,error,created_at,sent_at FROM notifications WHERE order_id=? ORDER BY id',[o.id]);if(result.payment_method!=='cod'&&result.gateway_order_id&&result.payment_status!=='paid'&&result.status!=='Cancelled')result.checkout={mode:result.payment_method,keyId:result.payment_method==='razorpay'?config.razorpayId:null,gateway_order_id:result.gateway_order_id,amount:cents(result.total),currency:'INR',prefill:{name:result.name,email:result.email,contact:result.phone}};result.location={latitude:result.latitude,longitude:result.longitude,driver_lat:result.driver_lat,driver_lng:result.driver_lng,driver_source:result.driver_source,driver_updated_at:result.driver_updated_at};return result;}
async function activity(c,order,actor,detail){const r=await rows('INSERT INTO order_activity(order_id,actor,status,detail) VALUES(?,?,?,?)',[order.id,actor||null,order.status,detail],c);return r.insertId;}
const checkoutSchema=z.object({items:z.array(z.object({id:z.number().int().positive(),quantity:z.number().int().min(1).max(10000)})).min(1).max(100),address:checkoutAddressSchema.optional(),address_id:z.number().int().positive().optional(),payment_method:z.enum(['cod','razorpay','mock']).default('cod'),idempotency_key:z.string().min(8).max(100).optional()}).refine(v=>new Set(v.items.map(x=>x.id)).size===v.items.length,'Duplicate cart products').refine(v=>Boolean(v.address)!==Boolean(v.address_id),'Supply either a complete address or your saved address_id');
async function gatewayRequest(path,body){const response=await fetch('https://api.razorpay.com/v1'+path,{method:body?'POST':'GET',headers:{Authorization:'Basic '+Buffer.from(config.razorpayId+':'+config.razorpaySecret).toString('base64'),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});if(!response.ok)throw fail('Razorpay TEST is unavailable. Your order is saved; retry payment from order details.',503,'PAYMENT_UNAVAILABLE');return response.json();}
export async function checkoutFor(orderId,user){let order=await getOrder(orderId,user);if(order.payment_method==='cod'||order.payment_status==='paid'||order.status==='Cancelled')return null;
 if(order.payment_method==='mock'){if(config.paymentMode!=='mock'||config.production)throw fail('Payment simulation unavailable.',409);return {mode:'mock',gateway_order_id:order.gateway_order_id,amount:cents(order.total),currency:'INR',prefill:{name:user.name,email:user.email,contact:user.phone}};}
 if(config.paymentMode!=='razorpay')throw fail('Razorpay TEST is not configured.',503);
 if(!order.gateway_order_id){await transaction(async c=>{const [locked]=await rows('SELECT * FROM orders WHERE id=? FOR UPDATE',[orderId],c);if(locked.gateway_order_id)return;if(locked.status==='Cancelled')throw fail('Order cancelled.',409);const gateway=await gatewayRequest('/orders',{amount:cents(locked.total),currency:'INR',receipt:`mitti-${locked.id}`,notes:{mitti_order_id:String(locked.id)}});await rows('UPDATE orders SET gateway_order_id=? WHERE id=?',[gateway.id,locked.id],c);});order=await getOrder(orderId,user);}
 return {mode:'razorpay',keyId:config.razorpayId,gateway_order_id:order.gateway_order_id,amount:cents(order.total),currency:'INR',prefill:{name:user.name,email:user.email,contact:user.phone}};
}
ordersRouter.post('/orders',auth('customer'),rateLimit('checkout',20,60,true),wrap(async(req,res)=>{
 const body={...req.body};if(typeof body.address==='string')body.address={name:req.user.name,phone:req.user.phone||'9000000000',line1:body.address,city:'Virar',pincode:'401303'};
 const input=parse(checkoutSchema,body);if(input.payment_method!=='cod'&&input.payment_method!==config.paymentMode)throw fail('Selected payment method is unavailable.',422);
 const key=input.idempotency_key||randomUUID();const fingerprint=createHash('sha256').update(JSON.stringify({items:[...input.items].sort((a,b)=>a.id-b.id),address:input.address,address_id:input.address_id,payment_method:input.payment_method})).digest('hex');
 const {orderId,reused}=await transaction(async c=>{
  await rows('SELECT id FROM users WHERE id=? FOR UPDATE',[req.user.id],c);
  const [existing]=await rows('SELECT id,checkout_hash FROM orders WHERE user_id=? AND idempotency_key=?',[req.user.id,key],c);if(existing){if(existing.checkout_hash!==fingerprint)throw fail('Checkout key already used with different details.',409);return {orderId:existing.id,reused:true};}
  let address=input.address;
  if(input.address_id){const [saved]=await rows('SELECT * FROM account_addresses WHERE id=? AND user_id=?',[input.address_id,req.user.id],c);if(!saved)throw fail('Address not found.',404);address=parse(checkoutAddressSchema,{...saved,lat:saved.lat==null?null:Number(saved.lat),lng:saved.lng==null?null:Number(saved.lng),accuracy:saved.accuracy==null?null:Number(saved.accuracy)});}
  const settings=await getSettings(c);if(settings.deliveryZones.length&&!settings.deliveryZones.some(z=>z.pincodes.includes(address.pincode)))throw fail('We do not deliver to this pincode yet. Check the delivery zones.',422,'OUTSIDE_DELIVERY_ZONE');
  let subtotal=0;const lines=[];for(const item of [...input.items].sort((a,b)=>a.id-b.id)){const [p]=await rows('SELECT * FROM products WHERE id=? FOR UPDATE',[item.id],c);if(p){const [category]=p.category_id==null?[]:await rows('SELECT active FROM categories WHERE id=? FOR UPDATE',[p.category_id],c);p.category_active=category?.active??null;}if(!p||!p.active||p.category_active===0)throw fail('One of the products is no longer available.',409,'PRODUCT_UNAVAILABLE');if(p.stock<item.quantity)throw fail(`${p.name}: only ${p.stock} available. Update your cart.`,409,'OUT_OF_STOCK');const price=cents(p.sale_price??p.price);subtotal+=price*item.quantity;if(subtotal>100000000)throw fail('Order value exceeds the checkout limit.',422);const deduction=await rows('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?',[item.quantity,item.id,item.quantity],c);if(deduction.affectedRows!==1)throw fail('Stock changed during checkout. Please update your cart.',409,'OUT_OF_STOCK');lines.push({...p,quantity:item.quantity,price:price/100});}
  if(subtotal<cents(settings.minimumOrder))throw fail(`Minimum order value is ₹${Number(settings.minimumOrder).toFixed(2)}.`,422,'MINIMUM_ORDER');const delivery=cents(settings.deliveryCharge);const total=(subtotal+delivery)/100;
  const r=await rows('INSERT INTO orders(user_id,address,subtotal,delivery_charge,total,payment_method,payment_status,idempotency_key,checkout_hash,delivery_notes,latitude,longitude) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[req.user.id,JSON.stringify(address),subtotal/100,delivery/100,total,input.payment_method,input.payment_method==='cod'?'cod':'pending',key,fingerprint,'',address.lat??null,address.lng??null],c);const orderId=r.insertId;
  if(input.payment_method==='mock')await rows('UPDATE orders SET gateway_order_id=? WHERE id=?',[`mock_order_${orderId}`,orderId],c);
  for(const line of lines)await rows('INSERT INTO order_items(order_id,product_id,name,quantity,price,unit,image) VALUES(?,?,?,?,?,?,?)',[orderId,line.id,line.name,line.quantity,line.price,line.unit,json(line.images,[])[0]||''],c);
  const order={id:orderId,user_id:req.user.id,status:'Pending',tracking:''};await activity(c,order,req.user.id,input.payment_method==='cod'?'Order placed · Cash on Delivery':'Order placed · awaiting test payment');await orderOutbox(c,order,`order-${orderId}-placed`,`your order #${orderId} has been placed. ${input.payment_method==='cod'?'Pay on delivery.':'Payment is pending.'}`);await audit(req.user.id,'order.created','order',orderId,{paymentMethod:input.payment_method,total},c);await rows('DELETE FROM carts WHERE user_id=?',[req.user.id],c);const revision=await catalogueChanged(c,lines.map(p=>p.id),'stock_reserved');for(const line of lines)if(line.stock===line.quantity)await stockNotice(c,{productId:line.id,name:line.name,revision,reason:'out_of_stock'});return {orderId,reused:false};
 });
 // Publish committed inventory before a payment provider can delay checkout initialization.
 if(!reused){await flushRealtime();void pumpOutbox();}
 const order=await getOrder(orderId,req.user);try{order.checkout=await checkoutFor(orderId,req.user);}catch(e){order.checkout_error=e.message;}
 res.status(reused?200:201).json(order);
}));
ordersRouter.post('/orders/:id/payment',auth('customer'),rateLimit('payment-retry',10,60,true),wrap(async(req,res)=>res.json({checkout:await checkoutFor(id(req.params.id),req.user)})));
ordersRouter.get('/orders',auth('customer'),wrap(async(req,res)=>{const data=await paged(req,db,'SELECT * FROM orders WHERE user_id=? ORDER BY id DESC','SELECT COUNT(*) total FROM orders WHERE user_id=?',[req.user.id]);data.items=data.items.map(normalizeOrder);res.json(data);}));
ordersRouter.get('/orders/by-checkout-key/:key',auth('customer'),wrap(async(req,res)=>{const key=parse(z.string().min(8).max(100),req.params.key);const [record]=await rows('SELECT id FROM orders WHERE user_id=? AND idempotency_key=?',[req.user.id,key]);res.json({order:record?await getOrder(record.id,req.user):null});}));
ordersRouter.get('/orders/:id/bill.pdf',auth('customer','admin'),wrap(async(req,res)=>{
 const order=await getOrder(id(req.params.id),req.user);
 const settings=await getSettings();
 const pdf=makeOrderBillPdf(order,settings);
 res.set({
   'Content-Type':'application/pdf',
   'Content-Disposition':'attachment; filename="Virar-Organics-Bill-VO-'+String(order.id).padStart(6,'0')+'.pdf"',
   'Content-Length':String(pdf.length),
   'Cache-Control':'private, no-store',
   'X-Content-Type-Options':'nosniff'
 });
 res.status(200).end(pdf);
}));
ordersRouter.get('/orders/:id',auth('customer','admin'),wrap(async(req,res)=>res.json(await getOrder(id(req.params.id),req.user))));
const transitions={Pending:['Processing','Cancelled'],Paid:['Processing','Cancelled'],Processing:['Shipped','Cancelled'],Shipped:['Delivered'],Delivered:[],Cancelled:[]};
export async function changeOrder(orderId,input,actor,{customer=false}={}){
 let changed=false;await transaction(async c=>{
  const [o]=await rows('SELECT * FROM orders WHERE id=? FOR UPDATE',[orderId],c);if(!o||customer&&o.user_id!==actor.id)throw fail('Order not found.',404);
  const status=input.status??o.status;if(customer&&!(status==='Cancelled'&&(o.status==='Pending'||o.status==='Cancelled')&&o.payment_status!=='paid'&&o.payment_status!=='refund_required'))throw fail('This order can no longer be cancelled from your account.',409);
  if(status!==o.status&&!transitions[o.status]?.includes(status))throw fail(`Cannot change ${o.status} to ${status}.`,409,'INVALID_TRANSITION');
  if(status==='Processing'&&o.payment_method!=='cod'&&o.payment_status!=='paid')throw fail('Online payment must be confirmed before processing.',409);
  const values={status,tracking:input.tracking??o.tracking,delivery_notes:input.delivery_notes??o.delivery_notes,latitude:input.latitude===undefined?o.latitude:input.latitude,longitude:input.longitude===undefined?o.longitude:input.longitude};
  if(Object.entries(values).every(([k,v])=>String(v??'')===String(o[k]??'')))return;
  if(status==='Cancelled'&&!o.stock_restored){const lines=await rows('SELECT product_id,quantity FROM order_items WHERE order_id=? ORDER BY product_id',[o.id],c);for(const line of lines)await rows('UPDATE products SET stock=stock+? WHERE id=?',[line.quantity,line.product_id],c);o.stock_restored=1;await catalogueChanged(c,lines.map(x=>x.product_id),'stock_released');}
  const paymentStatus=status==='Cancelled'&&o.payment_status==='paid'?'refund_required':o.payment_status;
  await rows('UPDATE orders SET status=?,tracking=?,delivery_notes=?,latitude=?,longitude=?,stock_restored=?,payment_status=? WHERE id=?',[values.status,values.tracking,values.delivery_notes,values.latitude,values.longitude,o.stock_restored,paymentStatus,o.id],c);
  const next={...o,...values,payment_status:paymentStatus};const message=status!==o.status?`Order ${status.toLowerCase()}${paymentStatus==='refund_required'?' · payment refund needs manual handling':''}`:'Shipment or delivery details updated';const activityId=await activity(c,next,actor.id,message);await orderOutbox(c,next,`order-${o.id}-activity-${activityId}`,`order #${o.id}: ${message.toLowerCase()}.`);await audit(actor.id,'order.updated','order',o.id,{status,tracking:values.tracking,locationChanged:input.latitude!==undefined},c);changed=true;
 });const order=await getOrder(orderId,actor);if(changed){await flushRealtime();void pumpOutbox();}return order;
}
ordersRouter.post('/orders/:id/cancel',auth('customer'),wrap(async(req,res)=>res.json(await changeOrder(id(req.params.id),{status:'Cancelled'},req.user,{customer:true}))));
function orderFilter(req){const where=[],params=[];if(req.query.q){where.push('(CAST(o.id AS CHAR) LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');params.push(...Array(3).fill('%'+String(req.query.q).slice(0,100)+'%'));}if(req.query.status){where.push('o.status=?');params.push(parse(z.enum(['Pending','Paid','Processing','Shipped','Delivered','Cancelled']),req.query.status));}return {where:where.length?' WHERE '+where.join(' AND '):'',params};}
ordersRouter.get('/admin/orders/export',admin,wrap(async(req,res)=>{const {where,params}=orderFilter(req);const records=await rows(`SELECT o.id,u.name,u.email,o.total,o.status,o.payment_method,o.payment_status,o.tracking,o.created_at FROM orders o JOIN users u ON u.id=o.user_id${where} ORDER BY o.id DESC LIMIT 10000`,params);res.set('Content-Disposition','attachment; filename="virar-organics-orders.csv"').type('text/csv').send(csv(records,['id','name','email','total','status','payment_method','payment_status','tracking','created_at']));}));
ordersRouter.get('/admin/orders',admin,wrap(async(req,res)=>{const {where,params}=orderFilter(req);const data=await paged(req,db,`SELECT o.*,u.name,u.email,u.phone FROM orders o JOIN users u ON u.id=o.user_id${where} ORDER BY o.id DESC`,`SELECT COUNT(*) total FROM orders o JOIN users u ON u.id=o.user_id${where}`,params);data.items=data.items.map(normalizeOrder);res.json(data);}));
ordersRouter.get('/admin/orders/:id',admin,wrap(async(req,res)=>res.json(await getOrder(id(req.params.id),req.user))));
const updateSchema=z.object({status:z.enum(['Pending','Paid','Processing','Shipped','Delivered','Cancelled']).optional(),tracking:text(150).optional(),delivery_notes:text(3000).optional(),latitude:latitude.nullable().optional(),longitude:longitude.nullable().optional()}).refine(v=>(v.latitude===undefined&&v.longitude===undefined)||(v.latitude==null)===(v.longitude==null),'Supply both coordinates');
const updateOrder=wrap(async(req,res)=>res.json(await changeOrder(id(req.params.id),parse(updateSchema,req.body),req.user)));
ordersRouter.post('/admin/orders/:id',admin,updateOrder);ordersRouter.patch('/admin/orders/:id',admin,updateOrder);ordersRouter.patch('/admin/orders/:id/location',admin,updateOrder);
ordersRouter.post('/admin/orders/:id/driver-location',admin,wrap(async(req,res)=>{const input=parse(z.object({latitude,longitude,source:z.enum(['manual','courier']).default('manual')}),req.body);const orderId=id(req.params.id);await transaction(async c=>{const [order]=await rows('SELECT * FROM orders WHERE id=? FOR UPDATE',[orderId],c);if(!order)throw fail('Order not found.',404);if(['Delivered','Cancelled'].includes(order.status))throw fail('Location updates are closed for this order.',409);await rows('UPDATE orders SET driver_lat=?,driver_lng=?,driver_source=?,driver_updated_at=UTC_TIMESTAMP() WHERE id=?',[input.latitude,input.longitude,input.source,orderId],c);const a=await activity(c,order,req.user.id,input.source==='manual'?'Manually entered courier location updated':'Courier-supplied location updated');await audit(req.user.id,'order.driver_location','order',orderId,{source:input.source},c);await orderOutbox(c,order,`order-${orderId}-activity-${a}`,'a delivery location update was recorded. Open your order for details.');});const order=await getOrder(orderId,req.user);await flushRealtime();void pumpOutbox();res.json(order);}));
ordersRouter.get('/admin/locations',admin,wrap(async(req,res)=>res.json((await rows('SELECT o.*,u.name,u.email,u.phone FROM orders o JOIN users u ON u.id=o.user_id WHERE o.latitude IS NOT NULL ORDER BY o.id DESC LIMIT 500')).map(normalizeOrder))));
export function verifySignature(body,signature,secret){if(!secret||typeof signature!=='string'||!/^[0-9a-f]{64}$/i.test(signature))return false;const expected=createHmac('sha256',secret).update(body).digest();return timingSafeEqual(expected,Buffer.from(signature,'hex'));}
export async function settlePayment({eventId,paymentId,gatewayOrderId,amount,currency,outcome,eventType}){
 let affected,changed=false,duplicate=false;
 await transaction(async c=>{
  const [o]=await rows('SELECT * FROM orders WHERE gateway_order_id=? FOR UPDATE',[gatewayOrderId],c);if(!o)throw fail('Gateway order not found.',404);
  if(o.payment_method==='cod')throw fail('This is not an online payment order.',422);
  if(currency!=='INR'||Number(amount)!==cents(o.total))throw fail('Payment amount or currency does not match the order.',422,'PAYMENT_MISMATCH');
  affected=o;
  const [existingEvent]=await rows('SELECT order_id,payment_id,event_type FROM payment_events WHERE event_id=?',[eventId],c);if(existingEvent){if(existingEvent.order_id!==o.id||existingEvent.payment_id!==(paymentId||null)||existingEvent.event_type!==eventType)throw fail('Webhook event identifier conflicts with an earlier event.',409,'PAYMENT_EVENT_CONFLICT');duplicate=true;return;}
  await rows('INSERT INTO payment_events(event_id,payment_id,order_id,event_type) VALUES(?,?,?,?)',[eventId,paymentId||null,o.id,eventType],c);
  if(o.payment_status==='paid'||o.payment_status==='refund_required'){duplicate=true;return;}
  if(outcome==='success'){
    const status=o.status==='Cancelled'?'Cancelled':o.status==='Pending'?'Paid':o.status;const paymentStatus=o.status==='Cancelled'?'refund_required':'paid';
    await rows('UPDATE orders SET status=?,payment_status=?,gateway_payment_id=? WHERE id=?',[status,paymentStatus,paymentId,o.id],c);affected={...o,status,payment_status:paymentStatus};const detail=paymentStatus==='refund_required'?'Payment arrived after cancellation; manual refund required. Order remains cancelled.':'Test payment confirmed by server';await activity(c,affected,null,detail);await orderOutbox(c,affected,`order-${o.id}-payment-confirmed`,paymentStatus==='refund_required'?`payment for cancelled order #${o.id} was received and requires a manual refund. The order remains cancelled.`:`payment for order #${o.id} is confirmed.`);
  } else {
    if(o.status==='Cancelled'||o.payment_status==='failed'){duplicate=true;return;}
    await rows("UPDATE orders SET payment_status='failed' WHERE id=?",[o.id],c);affected={...o,payment_status:'failed'};await activity(c,affected,null,'Payment failed. Retry from your order details or cancel.');await orderOutbox(c,affected,`order-${o.id}-payment-failed-${paymentId}`,`payment for order #${o.id} failed. Please retry or cancel the order.`);
  }
  await audit(null,'payment.'+outcome,'order',o.id,{eventType},c);changed=true;
 });if(changed){await flushRealtime();void pumpOutbox();}return {order:affected,duplicate};
}
ordersRouter.post('/payments/mock/:id',auth('customer'),rateLimit('mock-payment',15,60,true),wrap(async(req,res)=>{if(config.paymentMode!=='mock'||config.production)throw fail('Payment simulation is disabled.',404);const {outcome}=parse(z.object({outcome:z.enum(['success','failure'])}),req.body);const order=await getOrder(id(req.params.id),req.user);if(order.payment_method!=='mock')throw fail('This order does not use the local simulator.',422);if(order.status==='Cancelled')throw fail('This order is cancelled.',409);await settlePayment({eventId:`mock-${order.id}-${outcome}`,paymentId:`mock_pay_${order.id}_${outcome}`,gatewayOrderId:order.gateway_order_id,amount:cents(order.total),currency:'INR',outcome,eventType:'mock.'+outcome});res.json(await getOrder(order.id,req.user));}));
ordersRouter.post('/payments/verify',auth('customer'),rateLimit('payment-verify',20,60,true),wrap(async(req,res)=>{if(config.paymentMode!=='razorpay')throw fail('Razorpay TEST is not enabled.',503);const input=parse(z.object({order_id:z.coerce.number().int().positive(),razorpay_order_id:text(100,1),razorpay_payment_id:text(100,1),razorpay_signature:text(128,1)}),req.body);const order=await getOrder(input.order_id,req.user);if(order.gateway_order_id!==input.razorpay_order_id||!verifySignature(order.gateway_order_id+'|'+input.razorpay_payment_id,input.razorpay_signature,config.razorpaySecret))throw fail('Payment signature is invalid.',400);
 const payment=await gatewayRequest('/payments/'+encodeURIComponent(input.razorpay_payment_id));if(payment.order_id!==order.gateway_order_id)throw fail('Payment does not match this order.',422);if(payment.status!=='captured')return res.status(202).json({status:'pending',message:'Payment is awaiting capture. The verified webhook will update your order.'});await settlePayment({eventId:'verify-'+payment.id,paymentId:payment.id,gatewayOrderId:payment.order_id,amount:payment.amount,currency:payment.currency,outcome:'success',eventType:'payment.captured'});res.json(await getOrder(order.id,req.user));}));
export const webhookHandler=wrap(async(req,res)=>{
 if(!config.webhookSecret)throw fail('Payment webhooks are not configured.',503);
 if(!Buffer.isBuffer(req.body)||!verifySignature(req.body,req.get('x-razorpay-signature'),config.webhookSecret))throw fail('Invalid webhook signature.',400);
 let body;try{body=JSON.parse(req.body.toString('utf8'));}catch{throw fail('Invalid webhook payload.',400);}
 if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.event!=='string')throw fail('Invalid webhook payload.',422);
 if(!['payment.captured','payment.failed','order.paid'].includes(body.event))return res.json({ok:true,ignored:true});
 const p=body.payload?.payment?.entity;if(!p||typeof p.id!=='string'||typeof p.order_id!=='string'||!Number.isInteger(p.amount)||typeof p.currency!=='string')throw fail('Invalid payment entity.',422);
 const eventId=String(req.get('x-razorpay-event-id')||createHash('sha256').update(req.body).digest('hex'));if(eventId.length>150)throw fail('Invalid event identifier.',422);
 const result=await settlePayment({eventId,paymentId:p.id,gatewayOrderId:p.order_id,amount:p.amount,currency:p.currency,outcome:body.event==='payment.failed'?'failure':'success',eventType:body.event});res.json({ok:true,duplicate:result.duplicate});
});
