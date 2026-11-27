import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db, rows, json, transaction } from './db.js';
import { config } from './config.js';
import { admin, auth } from './auth.js';
import { parse, wrap, fail, text, id, paged, money } from './util.js';
import { audit, cachedCatalogue, catalogueChanged, catalogueRevision, flushRealtime, event, rateLimit } from './infra.js';
import { stockNotice } from './in-app.js';
import { defaultBrandSettings } from './branding.js';
import { prepareImage, persistPreparedUploads, removeStoredUpload, MAX_UPLOAD_BYTES } from './media.js';
export const catalogueRouter = Router();
export const defaultSettings = { storeName: defaultBrandSettings.storeName, heading: 'Good food.\nCloser to nature.', description: 'Organic pantry staples and seasonal goodness, delivered with care in Virar.', promotion: 'Fresh choices for your everyday rituals', about: 'We bring thoughtfully sourced organic pantry staples and seasonal produce to homes in Virar. A fictional demonstration store built for learning.', contactEmail: defaultBrandSettings.contactEmail, contactPhone: '+91 90000 00000', address: 'Virar West, Mumbai, Maharashtra', logo: '', banner: '', favicon: '', footer: defaultBrandSettings.footer, social: { instagram: '', facebook: '' }, deliveryCharge: 35, minimumOrder: 100, openingHours: 'Monday–Saturday, 9 AM–8 PM', deliveryZones: [{ name: 'Virar', pincodes: ['401303','401305'] }], storeLat: 19.4559, storeLng: 72.8114, mapEnabled: true, sections: { featured: true, categories: true, about: true } };
export async function getSettings(executor = db) { const [record] = await rows('SELECT content FROM settings WHERE id=1', [], executor); return { ...defaultSettings, ...json(record?.content, {}) }; }
export const product = p => ({ ...p, category_active:p.category_active==null?true:Boolean(p.category_active), available:Boolean(p.active)&&(p.category_active==null||Boolean(p.category_active))&&p.stock>0, availability_reason:!p.active?'inactive':p.category_active===0?'category_inactive':p.stock<=0?'out_of_stock':null, images: json(p.images, []), active: Boolean(p.active), featured: Boolean(p.featured), price: Number(p.price), sale_price: p.sale_price == null ? null : Number(p.sale_price), effective_price: Number(p.sale_price ?? p.price) });
const uploadUrl = z.string().regex(/^\/uploads\/[a-zA-Z0-9_-]+\.webp$/);
const optionalImage = z.union([uploadUrl, z.literal('')]);
async function ensureImages(urls, executor = db) { for (const url of urls.filter(Boolean)) { const [image] = await rows('SELECT id FROM uploads WHERE url=? FOR UPDATE', [url], executor); if (!image) throw fail('One of the selected images no longer exists. Upload it again.', 422); } }
async function listProducts(req, isAdmin) {
  const conditions = [], params = [];
  if (!isAdmin) conditions.push('p.active=1 AND (c.id IS NULL OR c.active=1)');
  if (req.query.q) { conditions.push('(p.name LIKE ? OR p.description LIKE ?)'); params.push(`%${String(req.query.q).slice(0,100)}%`, `%${String(req.query.q).slice(0,100)}%`); }
  if (req.query.category) { conditions.push('p.category_id=?'); params.push(id(req.query.category)); }
  if (req.query.featured === 'true') conditions.push('p.featured=1');
  if (req.query.inStock === 'true') conditions.push('p.stock>0');
  for (const [key, operator] of [['minPrice','>='],['maxPrice','<=']]) if (req.query[key] !== undefined && req.query[key] !== '') { const value = Number(req.query[key]); if (!Number.isFinite(value) || value < 0) throw fail('Invalid price filter.',422); conditions.push(`COALESCE(p.sale_price,p.price) ${operator} ?`); params.push(value); }
  if (isAdmin && ['true','false','1','0'].includes(req.query.active)) { conditions.push('p.active=?'); params.push(['true','1'].includes(req.query.active)); }
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const sort = { recommended:'p.featured DESC,p.id ASC', price_asc: 'COALESCE(p.sale_price,p.price) ASC,p.id', price_desc: 'COALESCE(p.sale_price,p.price) DESC,p.id', name: 'p.name,p.id', newest: 'p.id DESC' }[req.query.sort] || 'p.featured DESC,p.id ASC';
  const fetcher = async () => { const data = await paged(req, db, `SELECT p.*,c.name category,c.active category_active FROM products p LEFT JOIN categories c ON c.id=p.category_id${where} ORDER BY ${sort}`, `SELECT COUNT(*) total FROM products p LEFT JOIN categories c ON c.id=p.category_id${where}`, params); data.items = data.items.map(product); return data; };
  return isAdmin ? fetcher() : cachedCatalogue(Buffer.from(JSON.stringify(req.query)).toString('base64url'), fetcher);
}
catalogueRouter.get('/products', wrap(async (req, res) => res.json(await listProducts(req, false))));
catalogueRouter.get('/products/:id', wrap(async (req, res) => { const [p] = await rows('SELECT p.*,c.name category,c.active category_active FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=? AND p.active=1 AND (c.id IS NULL OR c.active=1)', [id(req.params.id)]); if (!p) throw fail('Product not found.', 404); res.json(product(p)); }));
catalogueRouter.get('/categories', wrap(async (req, res) => res.json((await rows('SELECT * FROM categories WHERE active=1 ORDER BY id')).map(c => ({ ...c, active: Boolean(c.active) })))));
catalogueRouter.get('/settings', wrap(async (req, res) => res.json(await getSettings())));
catalogueRouter.get('/admin/products', admin, wrap(async (req, res) => res.json(await listProducts(req, true))));
catalogueRouter.get('/admin/products/:id',admin,wrap(async(req,res)=>{const [p]=await rows('SELECT p.*,c.name category,c.active category_active FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?',[id(req.params.id)]);if(!p)throw fail('Product not found.',404);res.json(product(p));}));
const productSchema = z.object({ id: z.coerce.number().int().positive().optional(), name: text(150,2), description: text(5000,5), price: z.coerce.number().min(0.01).max(1000000), sale_price: z.preprocess(v => v === '' || v === undefined ? null : v, z.coerce.number().min(0.01).max(1000000).nullable()), unit: text(40,1).default('packet'), stock: z.coerce.number().int().min(0).max(1000000), expected_stock: z.coerce.number().int().min(0).max(1000000).optional(), category_id: z.preprocess(v => v === '' || v === undefined ? null : v, z.coerce.number().int().positive().nullable()), images: z.array(uploadUrl).max(8).default([]), active: z.boolean().default(true), featured: z.boolean().default(false) }).refine(v => v.sale_price == null || v.sale_price <= v.price, { message: 'Sale price cannot exceed regular price.', path: ['sale_price'] });
const saveProduct = wrap(async (req, res) => {
  const input = parse(productSchema, { ...req.body, ...(req.params.id ? { id: req.params.id } : {}) });
  const productId = await transaction(async c => {
    await ensureImages(input.images, c); if (input.category_id && !(await rows('SELECT id FROM categories WHERE id=?', [input.category_id], c)).length) throw fail('Category does not exist.',422);
    const values = [input.name,input.description,money(input.price),input.sale_price == null ? null : money(input.sale_price),input.unit,input.stock,input.category_id,JSON.stringify([...new Set(input.images)]),input.active,input.featured];
    let productId = input.id, existing;
    if (productId) { [existing] = await rows('SELECT id,name,stock,active FROM products WHERE id=? FOR UPDATE',[productId],c); if (!existing) throw fail('Product not found.',404); if(input.expected_stock!==undefined&&existing.stock!==input.expected_stock)throw fail('Stock changed while you were editing. Reload the product and review the latest quantity before saving.',409,'STOCK_CHANGED'); await rows('UPDATE products SET name=?,description=?,price=?,sale_price=?,unit=?,stock=?,category_id=?,images=?,active=?,featured=? WHERE id=?',[...values,productId],c); }
    else productId = (await rows('INSERT INTO products(name,description,price,sale_price,unit,stock,category_id,images,active,featured) VALUES(?,?,?,?,?,?,?,?,?,?)',values,c)).insertId;
    await audit(req.user.id, input.id ? 'product.updated' : 'product.created','product',productId,{name:input.name,stock:input.stock,price:input.price},c); const revision=await catalogueChanged(c,[productId],input.id?'product_updated':'product_created');if(!input.active&&(!existing||existing.active))await stockNotice(c,{productId,name:input.name,revision,reason:'unavailable'});else if(input.stock===0&&(!existing||existing.stock>0))await stockNotice(c,{productId,name:input.name,revision,reason:'out_of_stock'});return productId;
  }); await flushRealtime(); res.status(input.id ? 200 : 201).json(product((await rows('SELECT p.*,c.active category_active FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?',[productId]))[0]));
});
catalogueRouter.post('/admin/products',admin,saveProduct); catalogueRouter.put('/admin/products/:id',admin,saveProduct);
catalogueRouter.delete('/admin/products/:id',admin,wrap(async(req,res)=>{ const productId=id(req.params.id); const permanent=req.body?.permanent===true; await transaction(async c=>{const [p]=await rows('SELECT id,name,active FROM products WHERE id=? FOR UPDATE',[productId],c);if(!p)throw fail('Product not found.',404);if(permanent){if((await rows('SELECT id FROM order_items WHERE product_id=? LIMIT 1',[productId],c)).length)throw fail('This product belongs to an order. Deactivate it to preserve history.',409);await rows('DELETE FROM products WHERE id=?',[productId],c);}else await rows('UPDATE products SET active=0 WHERE id=?',[productId],c);await audit(req.user.id,permanent?'product.deleted':'product.deactivated','product',productId,{},c);if(permanent||p.active){const revision=await catalogueChanged(c,[productId],permanent?'product_deleted':'product_unavailable');if(!permanent)await stockNotice(c,{productId,name:p.name,revision,reason:'unavailable'});}});await flushRealtime();res.json({ok:true});}));
catalogueRouter.get('/admin/categories',admin,wrap(async(req,res)=>res.json((await rows('SELECT * FROM categories ORDER BY id')).map(c=>({...c,active:Boolean(c.active)})))));
catalogueRouter.post('/admin/categories',admin,wrap(async(req,res)=>{const input=parse(z.object({id:z.coerce.number().int().positive().optional(),name:text(100,2),description:text(2000).default(''),image:optionalImage.default(''),active:z.boolean().default(true)}),req.body);const categoryId=await transaction(async c=>{await ensureImages([input.image],c);if(input.id){if(!(await rows('SELECT id FROM categories WHERE id=?',[input.id],c)).length)throw fail('Category not found.',404);await rows('UPDATE categories SET name=?,description=?,image=?,active=? WHERE id=?',[input.name,input.description,input.image,input.active,input.id],c);}const categoryId=input.id||(await rows('INSERT INTO categories(name,description,image,active) VALUES(?,?,?,?)',[input.name,input.description,input.image,input.active],c)).insertId;await audit(req.user.id,'category.saved','category',categoryId,{name:input.name},c);await catalogueChanged(c,[],'category_updated');return categoryId;});await flushRealtime();res.json({id:categoryId,...input});}));
catalogueRouter.delete('/admin/categories/:id',admin,wrap(async(req,res)=>{const categoryId=id(req.params.id);await transaction(async c=>{const [category]=await rows('SELECT id FROM categories WHERE id=? FOR UPDATE',[categoryId],c);if(!category)throw fail('Category not found.',404);if((await rows('SELECT id FROM products WHERE category_id=? LIMIT 1',[categoryId],c)).length)throw fail('Move or remove products in this category first.',409);await rows('DELETE FROM categories WHERE id=?',[categoryId],c);await audit(req.user.id,'category.deleted','category',categoryId,{},c);await catalogueChanged(c,[],'category_deleted');});await flushRealtime();res.json({ok:true});}));
const webLink=z.union([z.literal(''),z.string().url().refine(s=>s.startsWith('https://'),'Use https links')]);
const settingsSchema=z.object({storeName:text(100,2),heading:text(150,2),description:text(1000),promotion:text(250),about:text(5000),contactEmail:z.union([z.literal(''),z.string().email().max(190)]),contactPhone:text(30),address:text(500),logo:optionalImage,banner:optionalImage,favicon:optionalImage,footer:text(1000),social:z.object({instagram:webLink,facebook:webLink}),deliveryCharge:z.coerce.number().min(0).max(10000),minimumOrder:z.coerce.number().min(0).max(100000),openingHours:text(250),deliveryZones:z.array(z.object({name:text(100,1),pincodes:z.array(z.string().regex(/^\d{6}$/)).max(100)})).max(50),storeLat:z.coerce.number().min(-90).max(90),storeLng:z.coerce.number().min(-180).max(180),mapEnabled:z.boolean(),sections:z.object({featured:z.boolean(),categories:z.boolean(),about:z.boolean()})});
catalogueRouter.get('/admin/settings',admin,wrap(async(req,res)=>res.json(await getSettings())));
const saveSettings=wrap(async(req,res)=>{const old=await getSettings();const input=parse(settingsSchema,{...old,...req.body,social:{...old.social,...req.body.social},sections:{...old.sections,...req.body.sections}});await transaction(async c=>{await ensureImages([input.logo,input.banner,input.favicon],c);await rows('INSERT INTO settings(id,content) VALUES(1,?) ON DUPLICATE KEY UPDATE content=VALUES(content)',[JSON.stringify(input)],c);await audit(req.user.id,'settings.updated','settings',1,{fields:Object.keys(req.body)},c);});event('settings',{},['public']);res.json(input);});
catalogueRouter.post('/admin/settings',admin,saveSettings);catalogueRouter.put('/admin/settings',admin,saveSettings);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_UPLOAD_BYTES,files:8,fields:2,parts:10}});
catalogueRouter.post('/admin/upload',admin,rateLimit('uploads',30,60,true),upload.array('images',8),wrap(async(req,res)=>{
 if(!req.files?.length)throw fail('Choose at least one image.',422);
 const prepared=[];
 for(const file of req.files)prepared.push(await prepareImage(file));
 await persistPreparedUploads(prepared,{
  storage:config.uploadStorage,directory:config.uploads,
  save:assets=>transaction(async c=>{
   for(const f of assets)await rows('INSERT INTO uploads(filename,original_name,url,size_bytes,width,height,actor,storage,content,mime_type) VALUES(?,?,?,?,?,?,?,?,?,?)',[f.filename,f.original_name,f.url,f.size_bytes,f.width,f.height,req.user.id,f.storage,f.content,f.mime_type],c);
   await audit(req.user.id,'images.uploaded','uploads',null,{count:assets.length},c);
  }),
 });
 res.status(201).json(prepared.map(f=>f.url));
}));
catalogueRouter.get('/admin/uploads',admin,wrap(async(req,res)=>res.json(await rows('SELECT id,filename,original_name,url,size_bytes,width,height,actor,storage,mime_type,created_at FROM uploads ORDER BY id DESC LIMIT 500'))));
catalogueRouter.delete('/admin/uploads/:filename',admin,wrap(async(req,res)=>{
 const filename=parse(z.string().max(100).regex(/^[a-zA-Z0-9_-]+\.webp$/),req.params.filename),url='/uploads/'+filename;
 const deleted=await transaction(async c=>{
  const [asset]=await rows('SELECT id,filename,storage FROM uploads WHERE filename=? FOR UPDATE',[filename],c);
  if(!asset)throw fail('Image not found.',404);
  const references=await rows('SELECT id FROM products WHERE images LIKE ? UNION ALL SELECT id FROM categories WHERE image=? UNION ALL SELECT id FROM settings WHERE content LIKE ? UNION ALL SELECT id FROM order_items WHERE image=? LIMIT 1',[`%${url}%`,url,`%${url}%`,url],c);
  if(references.length)throw fail('This image is still used by a product, category, website setting or order. Remove those references first.',409);
  await rows('DELETE FROM uploads WHERE id=?',[asset.id],c);
  await audit(req.user.id,'image.deleted','upload',asset.id,{},c);
  return asset;
 });
 await removeStoredUpload(deleted,config.uploads).catch(()=>console.warn(JSON.stringify({level:'warn',message:'Unused image file cleanup failed'})));
 res.json({ok:true});
}));
export async function availability(ids) {
  const unique=[...new Set(ids)];
  if(!unique.length)return [];
  const records=await rows(`SELECT p.*,c.name category,c.active category_active FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id IN (${unique.map(()=>'?').join(',')})`,unique);
  const byId=new Map(records.map(p=>[p.id,p]));
  return unique.map(productId=>{const p=byId.get(productId);if(!p)return {id:productId,exists:false,active:false,category_active:false,available:false,reason:'deleted',stock:0,product:null};const current=product(p);return {id:productId,exists:true,active:current.active,category_active:current.category_active,available:current.available,reason:current.availability_reason,stock:current.stock,product:current};});
}
catalogueRouter.post('/products/availability',auth('customer'),rateLimit('availability',180,60,true),wrap(async(req,res)=>{const input=parse(z.object({ids:z.array(z.number().int().positive()).max(100)}),req.body);const revision=await catalogueRevision();res.json({items:await availability(input.ids),revision});}));
const cartSchema=z.object({items:z.array(z.object({id:z.number().int().positive(),quantity:z.number().int().min(1).max(10000)})).max(100)}).refine(v=>new Set(v.items.map(i=>i.id)).size===v.items.length,'Duplicate cart products');
catalogueRouter.get('/cart',auth('customer'),wrap(async(req,res)=>{const [c]=await rows('SELECT items FROM carts WHERE user_id=?',[req.user.id]);const items=json(c?.items,[]),revision=await catalogueRevision();res.json({items,availability:await availability(items.map(i=>i.id)),revision});}));
catalogueRouter.put('/cart',auth('customer'),wrap(async(req,res)=>{const input=parse(cartSchema,req.body);await rows('INSERT INTO carts(user_id,items) VALUES(?,?) ON DUPLICATE KEY UPDATE items=VALUES(items)',[req.user.id,JSON.stringify(input.items)]);const revision=await catalogueRevision();res.json({...input,availability:await availability(input.items.map(i=>i.id)),revision});}));
