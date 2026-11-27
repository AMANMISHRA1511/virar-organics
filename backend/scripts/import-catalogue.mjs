import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { db, rows, transaction } from '../src/db.js';
import { config, root } from '../src/config.js';
import { defaultSettings } from '../src/catalogue.js';
import { catalogueChanged } from '../src/infra.js';
import { prepareImage, persistPreparedUploads } from '../src/media.js';

// Imports only catalogue content. It never creates people, orders, enquiries,
// messages or positive inventory, and never replaces an existing catalogue.
export async function importBundledCatalogue() {
  const [current] = await rows('SELECT COUNT(*) total FROM products');
  if (Number(current.total)) return { imported: false, reason: 'Catalogue already exists.' };
  const catalogue = JSON.parse(await fs.readFile(path.join(root, 'seed-catalogue.json'), 'utf8'));
  const keys = [...new Set([...catalogue.products.map(p => p[0]), ...catalogue.categories.map(c => c[2]), 'hero'])];
  const prepared = [];
  for (const key of keys) {
    if (!/^[a-z0-9-]+$/.test(key)) throw new Error('Invalid bundled image key.');
    prepared.push({ key, ...await prepareImage({ buffer: await fs.readFile(path.join(root, 'seed-assets', `${key}.png`)), originalname: `${key}.png` }) });
  }
  try {
    return await persistPreparedUploads(prepared, {
      storage: config.uploadStorage, directory: config.uploads,
      save: images => transaction(async c => {
        const [migration] = await rows('SELECT version FROM schema_migrations WHERE version=7 FOR UPDATE', [], c);
        if (!migration) throw new Error('Schema v7 is required before catalogue import.');
        const [count] = await rows('SELECT COUNT(*) total FROM products', [], c);
        const [previous] = await rows("SELECT id FROM audit_log WHERE action='catalogue.bootstrap' LIMIT 1", [], c);
        if (Number(count.total) || previous) {
          const error = new Error('Catalogue was already initialized.'); error.code = 'CATALOGUE_EXISTS'; throw error;
        }
        const urls = {};
        for (const asset of images) {
          await rows('INSERT INTO uploads(filename,original_name,url,size_bytes,width,height,storage,content,mime_type) VALUES(?,?,?,?,?,?,?,?,?)',
            [asset.filename, asset.original_name, asset.url, asset.size_bytes, asset.width, asset.height, asset.storage, asset.content, asset.mime_type], c);
          urls[asset.key] = asset.url;
        }
        const categoryIds = [];
        for (const [name, description, imageKey] of catalogue.categories) {
          const [existing] = await rows('SELECT id FROM categories WHERE name=?', [name], c);
          if (existing) categoryIds.push(existing.id);
          else {
            const created = await rows('INSERT INTO categories(name,description,image) VALUES(?,?,?)', [name, description, urls[imageKey] || ''], c);
            categoryIds.push(created.insertId);
          }
        }
        for (const [key, name, description, price, sale, _stock, unit, category, featured] of catalogue.products) {
          await rows('INSERT INTO products(name,description,price,sale_price,stock,unit,category_id,images,featured,active) VALUES(?,?,?,?,?,?,?,?,?,?)',
            [name, description, price, sale, 0, unit, categoryIds[category], JSON.stringify(urls[key] ? [urls[key]] : []), featured, 1], c);
        }
        const content = { ...defaultSettings, banner: urls.hero || '',
          about: 'Fresh pantry staples and seasonal produce, selected with care for homes in Virar.',
          contactEmail: '', contactPhone: '', openingHours: '', mapEnabled: false };
        await rows('INSERT IGNORE INTO settings(id,content) VALUES(1,?)', [JSON.stringify(content)], c);
        await rows("INSERT INTO audit_log(actor,action,entity_type,entity_id,detail) VALUES(NULL,'catalogue.bootstrap','catalogue','initial',?)",
          [JSON.stringify({ products: catalogue.products.length, categories: catalogue.categories.length, initialStock: 0 })], c);
        await catalogueChanged(c, [], 'catalogue_initialized');
        return { imported: true, products: catalogue.products.length, categories: catalogue.categories.length, images: images.length, initialStock: 0 };
      }),
    });
  } catch (error) {
    if (error.code === 'CATALOGUE_EXISTS') return { imported: false, reason: 'Catalogue already initialized.' };
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await importBundledCatalogue())); }
  finally { await db.end(); }
}
