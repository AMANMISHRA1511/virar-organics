import { Router } from 'express';
import { db, rows, json, transaction } from './db.js';
import { auth, admin, publicUser } from './auth.js';
import { savedAddressSchema } from './address-schema.js';
import { wrap, parse, fail, id, paged } from './util.js';
import { audit, customerChanged, flushRealtime, rateLimit } from './infra.js';

export const accountsRouter=Router();
const addressColumns='id,label,name,phone,flat,building,area,landmark,line1,line2,city,state,pincode,country,lat,lng,accuracy,is_default,created_at,updated_at';
const addressKeys=['label','name','phone','flat','building','area','landmark','line1','line2','city','state','pincode','country','lat','lng','accuracy','is_default'];
export const normalizeAddress=a=>({...a,lat:a.lat==null?null:Number(a.lat),lng:a.lng==null?null:Number(a.lng),accuracy:a.accuracy==null?null:Number(a.accuracy),is_default:Boolean(a.is_default)});
export async function savedAddresses(userId,c=db){return (await rows(`SELECT ${addressColumns} FROM account_addresses WHERE user_id=? ORDER BY is_default DESC,id`,[userId],c)).map(normalizeAddress);}
async function ownedAddress(userId,addressId,c=db){const [a]=await rows(`SELECT ${addressColumns} FROM account_addresses WHERE id=? AND user_id=?`,[addressId,userId],c);if(!a)throw fail('Address not found.',404);return normalizeAddress(a);}

accountsRouter.get('/account/addresses',auth('customer'),wrap(async(req,res)=>res.json({items:await savedAddresses(req.user.id)})));
accountsRouter.post('/account/addresses',auth('customer'),rateLimit('saved-address',60,60,true),wrap(async(req,res)=>{
  const input=parse(savedAddressSchema,req.body);
  const addressId=await transaction(async c=>{
    // All changes for one account lock its user first, including default selection and checkout.
    await rows('SELECT id FROM users WHERE id=? FOR UPDATE',[req.user.id],c);
    const existing=await rows('SELECT id FROM account_addresses WHERE user_id=? ORDER BY id FOR UPDATE',[req.user.id],c);
    if(existing.length>=20)throw fail('You can save up to 20 addresses. Remove an unused address first.',409,'ADDRESS_LIMIT');
    const data={...input,is_default:existing.length===0||input.is_default};
    if(data.is_default)await rows('UPDATE account_addresses SET is_default=0 WHERE user_id=? AND is_default=1',[req.user.id],c);
    const result=await rows(`INSERT INTO account_addresses(user_id,${addressKeys.join(',')}) VALUES(${Array(addressKeys.length+1).fill('?').join(',')})`,[req.user.id,...addressKeys.map(k=>data[k])],c);
    await audit(req.user.id,'address.created','address',result.insertId,{isDefault:data.is_default},c);await customerChanged(c,req.user.id,result.insertId);return result.insertId;
  });await flushRealtime();res.status(201).json(await ownedAddress(req.user.id,addressId));
}));
accountsRouter.patch('/account/addresses/:id',auth('customer'),rateLimit('saved-address',60,60,true),wrap(async(req,res)=>{
  const addressId=id(req.params.id);
  await transaction(async c=>{
    await rows('SELECT id FROM users WHERE id=? FOR UPDATE',[req.user.id],c);
    const existing=await ownedAddress(req.user.id,addressId,c);
    const merged={...existing,...req.body};
    const derived=[existing.flat,existing.building,existing.area].filter(Boolean).join(', ');
    if(req.body.line1===undefined&&existing.line1===derived&&['flat','building','area'].some(k=>Object.hasOwn(req.body,k)))merged.line1='';
    if(req.body.line2===undefined&&existing.line2===existing.landmark&&Object.hasOwn(req.body,'landmark'))merged.line2=req.body.landmark;
    const input=parse(savedAddressSchema,merged);
    if(input.is_default)await rows('UPDATE account_addresses SET is_default=0 WHERE user_id=? AND is_default=1',[req.user.id],c);
    else if(existing.is_default){const [other]=await rows('SELECT id FROM account_addresses WHERE user_id=? AND id<>? ORDER BY id LIMIT 1',[req.user.id,addressId],c);if(other){await rows('UPDATE account_addresses SET is_default=0 WHERE id=?',[addressId],c);await rows('UPDATE account_addresses SET is_default=1 WHERE id=?',[other.id],c);}else input.is_default=true;}
    await rows(`UPDATE account_addresses SET ${addressKeys.map(k=>`${k}=?`).join(',')} WHERE id=? AND user_id=?`,[...addressKeys.map(k=>input[k]),addressId,req.user.id],c);
    await audit(req.user.id,'address.updated','address',addressId,{isDefault:input.is_default},c);await customerChanged(c,req.user.id,addressId);
  });await flushRealtime();res.json(await ownedAddress(req.user.id,addressId));
}));
accountsRouter.delete('/account/addresses/:id',auth('customer'),wrap(async(req,res)=>{
  const addressId=id(req.params.id);
  await transaction(async c=>{
    await rows('SELECT id FROM users WHERE id=? FOR UPDATE',[req.user.id],c);const old=await ownedAddress(req.user.id,addressId,c);
    await rows('DELETE FROM account_addresses WHERE id=? AND user_id=?',[addressId,req.user.id],c);
    if(old.is_default){const [next]=await rows('SELECT id FROM account_addresses WHERE user_id=? ORDER BY id LIMIT 1',[req.user.id],c);if(next)await rows('UPDATE account_addresses SET is_default=1 WHERE id=?',[next.id],c);}
    await audit(req.user.id,'address.deleted','address',addressId,{},c);await customerChanged(c,req.user.id,addressId);
  });await flushRealtime();res.json({ok:true});
}));

const customerSelect=`SELECT u.id,u.name,u.email,u.phone,u.active,u.created_at,u.google_sub,u.password_login_enabled,u.phone_verified,u.phone_verification_method,u.phone_verified_at,
 (SELECT COUNT(*) FROM account_addresses a WHERE a.user_id=u.id) address_count,
 (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) order_count,
 (SELECT COALESCE(SUM(CASE WHEN o.status<>'Cancelled' THEN o.total ELSE 0 END),0) FROM orders o WHERE o.user_id=u.id) total_order_value,
 (SELECT COALESCE(SUM(CASE WHEN o.status<>'Cancelled' AND (o.payment_status='paid' OR o.status='Delivered') THEN o.total ELSE 0 END),0) FROM orders o WHERE o.user_id=u.id) total_spent,
 (SELECT MAX(o.created_at) FROM orders o WHERE o.user_id=u.id) last_order_at,
 (SELECT COUNT(*) FROM leads l WHERE l.user_id=u.id) lead_count FROM users u`;
function customerProfile(u){return {...publicUser({...u,role:'customer'}),active:Boolean(u.active),created_at:u.created_at,address_count:Number(u.address_count),order_count:Number(u.order_count),total_order_value:Number(u.total_order_value),total_spent:Number(u.total_spent),last_order_at:u.last_order_at,lead_count:Number(u.lead_count)};}
accountsRouter.get('/admin/customers',admin,wrap(async(req,res)=>{
  const query=String(req.query.q||'').trim().slice(0,100),params=[];
  let where=" WHERE u.role='customer'";
  if(query){where+=' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';params.push(...Array(3).fill('%'+query+'%'));}
  const data=await paged(req,db,customerSelect+where+' ORDER BY u.id DESC','SELECT COUNT(*) total FROM users u'+where,params);
  res.json({...data,items:data.items.map(customerProfile)});
}));
accountsRouter.get('/admin/customers/:id',admin,wrap(async(req,res)=>{
  const customerId=id(req.params.id);const [record]=await rows(customerSelect+" WHERE u.id=? AND u.role='customer'",[customerId]);if(!record)throw fail('Customer not found.',404);
  const customer=customerProfile(record);
  const [addresses,orders,leads]=await Promise.all([savedAddresses(customerId),rows('SELECT id,address,subtotal,delivery_charge,total,status,payment_method,payment_status,created_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 20',[customerId]),rows('SELECT id,name,email,phone,product,quantity,message,status,followup,created_at FROM leads WHERE user_id=? ORDER BY id DESC LIMIT 20',[customerId])]);
  res.json({customer,addresses,orders:orders.map(o=>({...o,address:json(o.address,{}),subtotal:Number(o.subtotal),delivery_charge:Number(o.delivery_charge),total:Number(o.total)})),leads,summary:{order_count:customer.order_count,address_count:customer.address_count,lead_count:customer.lead_count,total_order_value:customer.total_order_value,total_spent:customer.total_spent,last_order_at:customer.last_order_at}});
}));
