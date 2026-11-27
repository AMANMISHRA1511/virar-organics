import { test, before, after } from 'node:test';
import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import { assert, Client, pool, sql, API_SECONDARY, WEBHOOK_SECRET, tag, randomUUID, address, product, checkout, upload, poll, sharp, socket, eventPromise, delay } from './helpers.mjs';
const admin = new Client(), sales = new Client(), customer = new Client(), stranger = new Client(), anonymous = new Client();
const fixture = {};
before(async () => {
  await admin.login('admin@mitti.test'); await sales.login('sales@mitti.test'); await customer.login('customer@mitti.test');
  await stranger.register(`qa-${tag}@mitti.test`); await anonymous.token();
});
after(async () => { await pool.end(); });

test('Real database/Redis health and explicitly simulated development services', async () => {
  const r = await anonymous.request('/health'); assert.equal(r.status, 200, r.text);
  const ready = await anonymous.request('/ready'); assert.equal(ready.status, 200, ready.text);
  const cfg = await anonymous.ok('/config'); assert.equal(cfg.payment.mode, 'mock'); assert.equal(cfg.notifications.mode, 'simulated'); assert.equal(cfg.redis, true);
  const [engine] = await sql('SELECT VERSION() version'); assert.match(engine.version, process.env.DB_CLIENT === 'postgres' ? /^PostgreSQL / : /MariaDB|MySQL|^8\./);
});

test('Seeded catalogue, real image files, pagination and sorting', async () => {
  const expected = JSON.parse(await fs.readFile(new URL('../backend/seed-catalogue.json', import.meta.url), 'utf8'));
  const list = await anonymous.ok('/products?limit=100'); assert.ok(list.total >= expected.products.length);
  const categories = await anonymous.ok('/categories'); for (const [name] of expected.categories) assert.ok(categories.some(c => c.name === name), `Missing category ${name}`);
  const illustrated = []; for (const [,name] of expected.products) { const found = await anonymous.ok('/products?q=' + encodeURIComponent(name)); const exact = found.items.find(p => p.name === name); assert.ok(exact, `Missing seeded product ${name}`); illustrated.push(exact); }
  for (const p of illustrated) { assert.equal(typeof p.effective_price, 'number'); assert.ok(p.images.length >= 1, `${p.name} missing image`); const img = await fetch(`${anonymous.base}${p.images[0]}`); assert.equal(img.status, 200); assert.match(img.headers.get('content-type'), /image\//); }
  const first = await anonymous.ok('/products?limit=3&page=1'); const second = await anonymous.ok('/products?limit=3&page=2'); assert.equal(first.items.length, 3); assert.equal(second.items.length, 3); assert.notEqual(first.items[0].id, second.items[0].id);
  const sorted = await anonymous.ok('/products?sort=price_asc&limit=100'); assert.deepEqual(sorted.items.map(x => x.effective_price), [...sorted.items.map(x => x.effective_price)].sort((a, b) => a - b));
  const filtered = await anonymous.ok('/products?minPrice=100&maxPrice=300&inStock=true'); assert.ok(filtered.items.every(p => p.effective_price >= 100 && p.effective_price <= 300 && p.stock > 0));
});

test('HTTP-only auth cookies, invalid login, signup role escalation blocked', async () => {
  const c = new Client(); const login = await c.login('customer@mitti.test'); assert.ok(login.headers.getSetCookie().some(x => /session=.*HttpOnly/i.test(x))); assert.ok(login.headers.getSetCookie().some(x => /SameSite=Lax/i.test(x)));
  const bad = await c.request('/login', { method: 'POST', body: { email: 'customer@mitti.test', password: 'incorrect' } }); assert.equal(bad.status, 401);
  const reg = await anonymous.request('/register', { method: 'POST', body: { name: 'Public user', email: `role-${tag}@mitti.test`, phone: '+91 9000012345', password: 'GoodPassword123!', role: 'admin', active: true } }); assert.equal(reg.status, 201, reg.text); assert.equal(reg.body.role, 'customer');
  assert.equal((await anonymous.request('/admin/staff')).status, 403);
  await anonymous.request('/logout', { method: 'POST', body: {} });
});

test('CSRF requires signed cookie/header pair and rejects a foreign origin', async () => {
  const clean = new Client();
  assert.equal((await clean.request('/login', { method: 'POST', body: { email: 'admin@mitti.test', password: 'DemoOnly123!' }, csrf: false })).status, 403);
  await clean.token();
  assert.equal((await clean.request('/login', { method: 'POST', body: { email: 'admin@mitti.test', password: 'DemoOnly123!' }, headers: { Origin: 'https://attacker.invalid' } })).status, 403);
  clean.csrf = 'forged'; assert.equal((await clean.request('/login', { method: 'POST', body: { email: 'admin@mitti.test', password: 'DemoOnly123!' } })).status, 403);
});

test('Unauthenticated requests cannot access account, cart, staff, orders or CRM', async () => {
  const c = new Client();
  for (const path of ['/account', '/cart', '/orders', '/admin/dashboard', '/admin/products', '/admin/orders', '/admin/leads', '/admin/staff', '/admin/locations', '/admin/settings', '/admin/activity', '/admin/notifications']) {
    assert.equal((await c.request(path)).status, 401, path);
  }
});

test('Sales role is denied every non-CRM admin API, including direct mutations and exports', async () => {
  for (const path of ['/admin/dashboard', '/admin/products', '/admin/categories', '/admin/orders', '/admin/orders/1', '/orders/1', '/admin/staff', '/admin/settings', '/admin/locations', '/admin/notifications', '/admin/activity', '/admin/uploads', '/admin/orders/export']) {
    assert.equal((await sales.request(path)).status, 403, path);
  }
  for (const [path, method, body] of [['/admin/products', 'POST', {}], ['/admin/products/1', 'DELETE', {}], ['/admin/staff', 'POST', {}], ['/admin/settings', 'POST', {}], ['/admin/orders/1/location', 'PATCH', { latitude: 19, longitude: 72 }], ['/admin/orders/1/driver-location', 'POST', { latitude: 19, longitude: 72, source: 'manual' }]]) {
    assert.equal((await sales.request(path, { method, body })).status, 403, path);
  }
  assert.equal((await sales.request('/admin/leads')).status, 200);
});

test('Customer cart persists independently and validates quantity/duplicate IDs', async () => {
  const list = await anonymous.ok('/products'); const id = list.items[0].id;
  const saved = await customer.ok('/cart', { method: 'PUT', body: { items: [{ id, quantity: 2 }] } }); assert.equal(saved.items[0].quantity, 2);
  assert.deepEqual((await customer.ok('/cart')).items, [{ id, quantity: 2 }]); assert.deepEqual((await stranger.ok('/cart')).items, []);
  for (const items of [[{ id, quantity: -1 }], [{ id, quantity: 1.5 }], [{ id, quantity: 1 }, { id, quantity: 1 }]]) assert.equal((await customer.request('/cart', { method: 'PUT', body: { items } })).status, 422);
});

test('Authenticated bulk enquiry creates CRM lead, notes/follow-ups persist, filters and CSV work', async () => {
  assert.equal((await anonymous.request('/leads', { method: 'POST', body: { name: 'Blocked anonymous enquiry' } })).status, 401);
  const r = await customer.ok('/leads', { method: 'POST', body: { name: `QA Enquiry ${tag}`, email: `enquiry-${tag}@mitti.test`, phone: '+91 9000012345', product: 'Organic rice', quantity: 25, message: 'Synthetic test enquiry.' } }); fixture.leadId = r.id;
  const lead = await sales.ok(`/admin/leads/${r.id}`); assert.equal(lead.status, 'New'); assert.equal(lead.quantity, 25);
  const today = new Date().toISOString().slice(0, 10);
  await sales.ok(`/admin/leads/${r.id}`, { method: 'PATCH', body: { status: 'Contacted', followup: today, note: 'Customer requested a wholesale quote.' } });
  const saved = await admin.ok(`/admin/leads/${r.id}`); assert.equal(saved.status, 'Contacted'); assert.ok(saved.notes.some(n => n.note === 'Customer requested a wholesale quote.'));
  const due = await sales.ok(`/admin/leads?due=today&q=${tag}`); assert.ok(due.items.some(x => x.id === r.id));
  assert.equal((await sales.request(`/admin/leads/${r.id}`, { method: 'PATCH', body: { status: 'Anything' } })).status, 422);
  const csv = await sales.request('/admin/leads/export'); assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.text, new RegExp(tag));
});

test('Admin creates/edits CRM leads and CSV exports neutralize spreadsheet formulas', async () => {
  const r = await admin.ok('/admin/leads', { method: 'POST', body: { name: '=SUM(1+1)', email: `csv-${tag}@mitti.test`, phone: '+91 9000012345', product: 'Rice', quantity: 10, message: 'Synthetic CSV test' } });
  await admin.ok(`/admin/leads/${r.id}`, { method: 'PATCH', body: { product: 'Organic rice', quantity: 12, status: 'Converted', note: 'Accepted quote' } });
  const item = await sales.ok(`/admin/leads/${r.id}`); assert.equal(item.quantity, 12);
  const csv = await admin.request('/admin/leads/export'); assert.ok(csv.text.includes("'=SUM(1+1)"), 'CSV formula cell must be prefixed with apostrophe');
});

test('Multiple uploads are fully decoded/optimized, referenced images protected, deletion works', async () => {
  const urls = await upload(admin); assert.equal(urls.length, 2); assert.ok(urls.every(x => /^\/uploads\/[\w-]+\.webp$/.test(x)));
  const raw = Buffer.from(await (await fetch(`${admin.base}${urls[0]}`)).arrayBuffer()); const meta = await sharp(raw).metadata(); assert.equal(meta.format, 'webp'); assert.equal(meta.width, 120);
  const p = await product(admin, { name: `QA upload ${tag}`, images: urls, featured: true, sale_price: 125 }); fixture.uploadProduct = p;
  const shown = await anonymous.ok(`/products/${p.id}`); assert.equal(shown.images.length, 2); assert.equal(shown.effective_price, 125);
  assert.equal((await admin.request('/admin/uploads/' + urls[0].split('/').pop(), { method: 'DELETE', body: {} })).status, 409);
  await admin.ok(`/admin/products/${p.id}`, { method: 'PUT', body: { ...p, images: [urls[1]] } });
  await admin.ok('/admin/uploads/' + urls[0].split('/').pop(), { method: 'DELETE', body: {} }); assert.equal((await fetch(`${admin.base}${urls[0]}`)).status, 404);
  assert.equal((await anonymous.ok(`/products/${p.id}`)).images.length, 1); fixture.persistentImage = urls[1];
});

test('Fake signatures, executable SVG, oversized images and excessive files are rejected', async () => {
  const forged = new FormData(); forged.append('images', new Blob([Buffer.from([137,80,78,71,13,10,26,10]), 'NOT AN IMAGE'], { type: 'image/png' }), 'fake.png');
  assert.equal((await admin.request('/admin/upload', { method: 'POST', body: forged })).status, 422);
  const svg = new FormData(); svg.append('images', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/svg+xml' }), 'attack.svg');
  assert.equal((await admin.request('/admin/upload', { method: 'POST', body: svg })).status, 422);
  const huge = new FormData(); huge.append('images', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }), 'huge.png');
  assert.equal((await admin.request('/admin/upload', { method: 'POST', body: huge })).status, 413);
  const many = new FormData(); for (let i = 0; i < 9; i++) many.append('images', new Blob(['x'], { type: 'image/png' }), `file${i}.png`);
  assert.ok([413,422].includes((await admin.request('/admin/upload', { method: 'POST', body: many })).status));
  assert.equal((await sales.request('/admin/upload', { method: 'POST', body: new FormData() })).status, 403);
});

test('Category add/edit/disable/delete and category-image upload connect to storefront', async () => {
  const [image] = await upload(admin, ['#668855']);
  const cat = await admin.ok('/admin/categories', { method: 'POST', body: { name: `QA category ${tag}`, description: 'Test category', image, active: true } });
  const p = await product(admin, { category_id: cat.id });
  assert.ok((await anonymous.ok('/categories')).some(x => x.id === cat.id && x.image === image));
  assert.equal((await admin.request(`/admin/categories/${cat.id}`, { method: 'DELETE', body: {} })).status, 409);
  await admin.ok('/admin/categories', { method: 'POST', body: { ...cat, name: `QA hidden ${tag}`, active: false } });
  assert.equal((await anonymous.request(`/products/${p.id}`)).status, 404); assert.ok(!(await anonymous.ok('/categories')).some(x => x.id === cat.id));
  await admin.ok(`/admin/products/${p.id}`, { method: 'DELETE', body: { permanent: true } }); await admin.ok(`/admin/categories/${cat.id}`, { method: 'DELETE', body: {} });
});

test('CMS persists all content, logo/banner/favicon, delivery settings and map configuration', async () => {
  const original = await admin.ok('/admin/settings'); const images = await upload(admin, ['#406544', '#E2C791', '#67865A']);
  const changes = { heading: `QA headline ${tag}`, description: 'Updated storefront description', promotion: 'Test promotion', about: 'A verified CMS update.', logo: images[0], banner: images[1], favicon: images[2], contactEmail: 'shop@mitti.test', contactPhone: '+91 9000012345', address: 'Virar test location', social: { instagram: 'https://instagram.com/example', facebook: '' }, deliveryCharge: 40, minimumOrder: 100, openingHours: 'Daily 9 AM to 8 PM', footer: 'Verified footer', deliveryZones: [{ name: 'Virar', pincodes: ['401303'] }], storeLat: 19.45, storeLng: 72.81, mapEnabled: true, sections: { featured: true, categories: false, about: true } };
  await admin.ok('/admin/settings', { method: 'POST', body: changes });
  const saved = await anonymous.ok('/settings'); for (const [k, v] of Object.entries(changes)) assert.deepEqual(saved[k], v, k);
  await admin.ok('/admin/settings', { method: 'POST', body: original });
});

test('Product validation, safe search, soft deactivation and permanent deletion', async () => {
  const p = await product(admin, { name: `QA validation ${tag}` });
  for (const change of [{ stock: -1 }, { stock: 1.5 }, { price: -5 }, { sale_price: 151 }, { images: ['/uploads/../secret.webp'] }]) assert.equal((await admin.request(`/admin/products/${p.id}`, { method: 'PUT', body: { ...p, ...change } })).status, 422);
  const search = await anonymous.ok('/products?q=' + encodeURIComponent("' OR 1=1; --")); assert.equal(search.items.length, 0);
  await admin.ok(`/admin/products/${p.id}`, { method: 'DELETE', body: {} }); assert.equal((await anonymous.request(`/products/${p.id}`)).status, 404);
  await admin.ok(`/admin/products/${p.id}`, { method: 'DELETE', body: { permanent: true } }); assert.equal((await sql('SELECT id FROM products WHERE id=?', [p.id])).length, 0);
});

test('Competing last-unit checkouts yield one winner and stock never becomes negative', async () => {
  const p = await product(admin, { name: `Last unit ${tag}`, stock: 1 });
  const outcomes = await Promise.all(Array.from({ length: 16 }, (_,i) => (i%2?stranger:customer).request('/orders', { method: 'POST', body: checkout(p) })));
  assert.equal(outcomes.filter(x => x.status === 201).length, 1, JSON.stringify(outcomes.map(x => ({ status: x.status, body: x.body }))));
  assert.equal(outcomes.filter(x => x.status === 409).length, 15);
  const [row] = await sql('SELECT stock FROM products WHERE id=?', [p.id]); assert.equal(row.stock, 0);
  fixture.raceOrder = outcomes.find(x => x.status === 201).body; fixture.raceProduct = p; fixture.raceOwner = outcomes.findIndex(x => x.status === 201)%2?stranger:customer;
});


test('An outdated admin product form cannot overwrite stock consumed by a concurrent checkout', async () => {
  const p=await product(admin,{name:`Stale inventory ${tag}`,stock:5,price:150});
  await customer.ok('/orders',{method:'POST',body:checkout(p)});
  const stale=await admin.request(`/admin/products/${p.id}`,{method:'PUT',body:{...p,price:200,stock:5,expected_stock:5}});assert.equal(stale.status,409,stale.text);assert.equal(stale.body.code,'STOCK_CHANGED');
  const [saved]=await sql('SELECT stock,price FROM products WHERE id=?',[p.id]);assert.equal(saved.stock,4);assert.equal(saved.price,150);
  const fresh=await admin.ok(`/admin/products/${p.id}`);await admin.ok(`/admin/products/${p.id}`,{method:'PUT',body:{...fresh,price:180,expected_stock:fresh.stock}});
  const [updated]=await sql('SELECT stock,price FROM products WHERE id=?',[p.id]);assert.equal(updated.stock,4);assert.equal(updated.price,180);
});

test('Checkout transaction rolls back every product when one requested line is unavailable', async () => {
  const stocked = await product(admin, { name: `Rollback stocked ${tag}`, stock: 5 }); const empty = await product(admin, { name: `Rollback empty ${tag}`, stock: 0 });
  const count = (await sql('SELECT COUNT(*) n FROM orders'))[0].n;
  const r = await customer.request('/orders', { method: 'POST', body: checkout(stocked, { items: [{ id: stocked.id, quantity: 2 }, { id: empty.id, quantity: 1 }] }) }); assert.equal(r.status, 409, r.text);
  assert.equal((await sql('SELECT stock FROM products WHERE id=?', [stocked.id]))[0].stock, 5); assert.equal((await sql('SELECT COUNT(*) n FROM orders'))[0].n, count);
});

test('Checkout trusts server prices, validates delivery/quantities, and duplicate requests are idempotent', async () => {
  const p = await product(admin, { name: `Idempotent ${tag}`, stock: 10, price: 250, sale_price: 200 });
  const body = checkout(p, { items: [{ id: p.id, quantity: 2, price: 1 }], total: 1 }); const order = await customer.ok('/orders', { method: 'POST', body });
  assert.equal(order.subtotal, 400); assert.equal(order.total, 400 + order.delivery_charge);
  const replay = await customer.ok('/orders', { method: 'POST', body }); assert.equal(replay.id, order.id);
  assert.equal((await sql('SELECT stock FROM products WHERE id=?', [p.id]))[0].stock, 8);
  assert.equal((await customer.request('/orders', { method: 'POST', body: { ...body, items: [{ id: p.id, quantity: 3 }] } })).status, 409);
  for (const mutation of [{ items: [{ id: p.id, quantity: 0 }] }, { items: [{ id: p.id, quantity: 1.2 }] }, { items: [{ id: p.id, quantity: 1 }, { id: p.id, quantity: 1 }] }, { address: { ...address, pincode: '999999' } }]) {
    const r = await customer.request('/orders', { method: 'POST', body: checkout(p, mutation) }); assert.ok([400, 422].includes(r.status), r.text);
  }
  fixture.ownOrder = order;
});

test('Customers cannot read or mutate another customer order, payment, delivery location or cart', async () => {
  const id = fixture.ownOrder.id;
  assert.equal((await stranger.request(`/orders/${id}`)).status, 404);
  assert.equal((await stranger.request(`/orders/${id}/cancel`, { method: 'POST', body: {} })).status, 404);
  assert.equal((await stranger.request(`/payments/mock/${id}`, { method: 'POST', body: { outcome: 'success' } })).status, 404);
  assert.equal((await customer.request('/admin/locations')).status, 403);
  assert.equal((await stranger.request(`/admin/orders/${id}/location`, { method: 'PATCH', body: { latitude: 10, longitude: 10 } })).status, 403);
  const list = await stranger.ok('/orders'); assert.ok(list.items.every(x => x.user_id === stranger.user.id));
});

test('Cancellation restores stock exactly once even under concurrent retries', async () => {
  const id = fixture.raceOrder.id; const before = (await sql('SELECT stock FROM products WHERE id=?', [fixture.raceProduct.id]))[0].stock;
  const results = await Promise.all(Array.from({ length: 8 }, () => fixture.raceOwner.request(`/orders/${id}/cancel`, { method: 'POST', body: {} })));
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results.map(r => ({status:r.status,body:r.body}))));
  assert.equal((await sql('SELECT stock FROM products WHERE id=?', [fixture.raceProduct.id]))[0].stock, before + 1);
  assert.equal((await sql("SELECT COUNT(*) n FROM order_activity WHERE order_id=? AND status='Cancelled'", [id]))[0].n, 1);
  assert.equal((await sql('SELECT stock_restored FROM orders WHERE id=?', [id]))[0].stock_restored, 1);
});

test('Legal order transitions, tracking, delivery notes and timestamped manual map updates', async () => {
  const order = fixture.ownOrder;
  assert.equal((await admin.request(`/admin/orders/${order.id}`, { method: 'POST', body: { status: 'Delivered' } })).status, 409);
  await admin.ok(`/admin/orders/${order.id}`, { method: 'POST', body: { status: 'Processing', tracking: '', delivery_notes: 'Packed for dispatch' } });
  await admin.ok(`/admin/orders/${order.id}`, { method: 'POST', body: { status: 'Shipped', tracking: 'QA-TRACK-001', delivery_notes: 'Courier collected' } });
  await admin.ok(`/admin/orders/${order.id}/location`, { method: 'PATCH', body: { latitude: 19.47, longitude: 72.82, delivery_notes: 'Corrected delivery pin' } });
  await admin.ok(`/admin/orders/${order.id}/driver-location`, { method: 'POST', body: { latitude: 19.46, longitude: 72.815, source: 'manual' } });
  const detail = await customer.ok(`/orders/${order.id}`); assert.equal(detail.status, 'Shipped'); assert.equal(detail.tracking, 'QA-TRACK-001'); assert.equal(Number(detail.latitude), 19.47); assert.equal(detail.driver_source, 'manual'); assert.ok(detail.driver_updated_at); assert.ok(detail.timeline.length >= 3);
  assert.equal((await customer.request(`/orders/${order.id}/cancel`, { method: 'POST', body: {} })).status, 409);
  assert.equal((await admin.request(`/admin/orders/${order.id}/location`, { method: 'PATCH', body: { latitude: 100, longitude: 72 } })).status, 422);
  await admin.ok(`/admin/orders/${order.id}`, { method: 'POST', body: { status: 'Delivered', tracking: 'QA-TRACK-001', delivery_notes: 'Handed over' } });
  assert.equal((await admin.request(`/admin/orders/${order.id}`, { method: 'POST', body: { status: 'Processing' } })).status, 409);
});

function webhook(payment, eventId, secret = WEBHOOK_SECRET, type = 'payment.captured') {
  const body = JSON.stringify({ entity: 'event', event: type, payload: { payment: { entity: payment } } });
  return { method: 'POST', raw: true, body, csrf: false, headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': createHmac('sha256', secret).update(body).digest('hex'), 'x-razorpay-event-id': eventId } };
}

test('Signed payment webhook settles the order; invalid signatures and amount/currency tampering fail', async () => {
  const p = await product(admin, { name: `Webhook ${tag}`, stock: 5 });
  const order = await customer.ok('/orders', { method: 'POST', body: checkout(p, { payment_method: 'mock' }) });
  const entity = { id: `pay_${tag}`, order_id: order.gateway_order_id || order.checkout.gateway_order_id, amount: Math.round(order.total * 100), currency: 'INR', status: 'captured' };
  const badSignature = await anonymous.request('/payments/webhook', webhook(entity, `evt_bad_${tag}`, 'wrong-secret')); assert.ok([400, 401].includes(badSignature.status), badSignature.text);
  const badAmount = await anonymous.request('/payments/webhook', webhook({ ...entity, amount: 1 }, `evt_amount_${tag}`)); assert.ok([400, 409, 422].includes(badAmount.status), badAmount.text);
  const badCurrency = await anonymous.request('/payments/webhook', webhook({ ...entity, currency: 'USD' }, `evt_currency_${tag}`)); assert.ok([400, 409, 422].includes(badCurrency.status), badCurrency.text);
  assert.equal((await customer.ok(`/orders/${order.id}`)).payment_status, 'pending');
  await anonymous.ok('/payments/webhook', webhook(entity, `evt_paid_${tag}`));
  const paid = await customer.ok(`/orders/${order.id}`); assert.equal(paid.status, 'Paid'); assert.equal(paid.payment_status, 'paid');
  fixture.paymentOrder = order; fixture.paymentEntity = entity;
});

test('Webhook replay and duplicate payment events cannot duplicate status changes or notifications', async () => {
  const order = fixture.paymentOrder; const entity = fixture.paymentEntity;
  const activity = (await sql('SELECT COUNT(*) n FROM order_activity WHERE order_id=?', [order.id]))[0].n;
  const notifications = (await sql('SELECT COUNT(*) n FROM notifications WHERE order_id=?', [order.id]))[0].n;
  const results = await Promise.all(Array.from({ length: 6 }, () => anonymous.request('/payments/webhook', webhook(entity, `evt_paid_${tag}`)))); assert.ok(results.every(x => x.status === 200));
  await anonymous.ok('/payments/webhook', webhook(entity, `evt_redundant_${tag}`));
  assert.equal((await sql('SELECT COUNT(*) n FROM order_activity WHERE order_id=?', [order.id]))[0].n, activity);
  assert.equal((await sql('SELECT COUNT(*) n FROM notifications WHERE order_id=?', [order.id]))[0].n, notifications);
});

test('Local payment simulation handles success/failure without pretending to contact Razorpay', async () => {
  const p = await product(admin, { name: `Simulation ${tag}`, stock: 5 });
  const success = await customer.ok('/orders', { method: 'POST', body: checkout(p, { payment_method: 'mock' }) }); assert.equal(success.checkout.mode, 'mock');
  await customer.ok(`/payments/mock/${success.id}`, { method: 'POST', body: { outcome: 'success' } }); assert.equal((await customer.ok(`/orders/${success.id}`)).payment_status, 'paid');
  const failure = await customer.ok('/orders', { method: 'POST', body: checkout(p, { payment_method: 'mock' }) });
  await customer.ok(`/payments/mock/${failure.id}`, { method: 'POST', body: { outcome: 'failure' } }); assert.equal((await customer.ok(`/orders/${failure.id}`)).payment_status, 'failed');
});

test('Notification outbox records post-commit email/SMS work and simulated delivery accurately', async () => {
  const rows = await poll(() => sql('SELECT * FROM notifications WHERE order_id=?', [fixture.paymentOrder.id]), x => x.length >= 4 && x.every(n => n.status === 'simulated'), 12000);
  assert.ok(rows.some(n => n.channel === 'email')); assert.ok(rows.some(n => n.channel === 'sms')); assert.ok(rows.every(n => n.attempts >= 1)); assert.ok(rows.every(n => n.status !== 'sent'));
  const seen = new Set(rows.map(n => `${n.event_key}/${n.channel}`)); assert.equal(seen.size, rows.length);
  const leads = await poll(() => sql('SELECT * FROM notifications WHERE lead_id=?', [fixture.leadId]), x => x.length === 2 && x.every(n => n.status === 'simulated'), 12000); assert.equal(leads.length, 2);
});

test('Cross-instance Redis Socket.IO sends private order events only to owner/Admin; leads to Sales', async () => {
  const ownerSocket = await socket(customer, API_SECONDARY); const strangerSocket = await socket(stranger, API_SECONDARY); const adminSocket = await socket(admin, API_SECONDARY); const salesSocket = await socket(sales, API_SECONDARY); const publicSocket = await socket(new Client(), API_SECONDARY);
  const leaks = []; for (const [role, s] of [['stranger', strangerSocket], ['sales', salesSocket], ['public', publicSocket]]) s.on('order:updated', data => leaks.push({ role, data }));
  try {
    const p = await product(admin, { name: `Socket ${tag}`, stock: 10 }); const order = await customer.ok('/orders', { method: 'POST', body: checkout(p) });
    const ownerEvent = eventPromise(ownerSocket, 'order:updated', x => x.id === order.id); const adminEvent = eventPromise(adminSocket, 'order:updated', x => x.id === order.id);
    await admin.ok(`/admin/orders/${order.id}`, { method: 'POST', body: { status: 'Processing', tracking: '', delivery_notes: 'Test event' } }); await Promise.all([ownerEvent, adminEvent]);
    const leadEvent = eventPromise(salesSocket, 'lead:updated'); await customer.ok('/leads', { method: 'POST', body: { name: `Socket Lead ${tag}`, email: `socket-${tag}@mitti.test`, phone: '+91 9000012345', product: 'Rice', quantity: 10, message: 'Socket test' } }); await leadEvent;
    await delay(250); assert.deepEqual(leaks, []);
  } finally { [ownerSocket, strangerSocket, adminSocket, salesSocket, publicSocket].forEach(s => s.disconnect()); }
});

test('Admin staff lifecycle enforces roles, revokes sessions and requires no public staff registration', async () => {
  const staff = await admin.ok('/admin/staff', { method: 'POST', body: { name: `QA Staff ${tag}`, email: `staff-${tag}@mitti.test`, phone: '', password: 'TestStaff123!', role: 'sales' } });
  const employee = new Client(); await employee.login(`staff-${tag}@mitti.test`, 'TestStaff123!'); assert.equal((await employee.request('/admin/dashboard')).status, 403);
  await admin.ok(`/admin/staff/${staff.id}`, { method: 'PATCH', body: { role: 'admin' } }); assert.equal((await employee.request('/me')).status, 401);
  await employee.login(`staff-${tag}@mitti.test`, 'TestStaff123!'); assert.equal((await employee.request('/admin/dashboard')).status, 200);
  await admin.ok(`/admin/staff/${staff.id}/password`, { method: 'POST', body: { password: 'ResetStaff123!' } }); assert.equal((await employee.request('/me')).status, 401);
  await employee.login(`staff-${tag}@mitti.test`, 'ResetStaff123!'); await admin.ok(`/admin/staff/${staff.id}`, { method: 'PATCH', body: { active: false } }); assert.equal((await employee.request('/me')).status, 401);
  assert.equal((await admin.request(`/admin/staff/${admin.user.id}`, { method: 'PATCH', body: { active: false } })).status, 409);
  assert.equal((await admin.request(`/admin/staff/${admin.user.id}`, { method: 'PATCH', body: { role: 'sales' } })).status, 409);
});

test('Logout invalidates captured cookies and disconnects authenticated sockets across instances', async () => {
  const temp = new Client(); await temp.register(`logout-${tag}@mitti.test`); const stolen = temp.clone(API_SECONDARY); const s = await socket(temp, API_SECONDARY);
  try { const disconnected = eventPromise(s, 'disconnect'); await temp.ok('/logout', { method: 'POST', body: {} }); await disconnected; assert.equal((await stolen.request('/me')).status, 401); } finally { s.disconnect(); }
});


test('Concurrent duplicate checkout requests share one committed order and one stock decrement', async () => {
  const p = await product(admin, { name: `Concurrent idempotency ${tag}`, stock: 10 }); const body = checkout(p);
  const before = (await sql('SELECT COUNT(*) n FROM orders'))[0].n;
  const responses = await Promise.all(Array.from({length:8}, () => customer.request('/orders', {method:'POST', body})));
  assert.equal(responses.filter(x => x.status===201).length,1); assert.equal(responses.filter(x => x.status===200).length,7);
  assert.equal(new Set(responses.map(x=>x.body.id)).size,1); assert.equal((await sql('SELECT COUNT(*) n FROM orders'))[0].n,before+1); assert.equal((await sql('SELECT stock FROM products WHERE id=?',[p.id]))[0].stock,9);
});

test('A late payment after cancellation preserves cancelled status, restored stock and manual-refund flag', async () => {
  const p=await product(admin,{name:`Late payment ${tag}`,stock:2}); const o=await customer.ok('/orders',{method:'POST',body:checkout(p,{payment_method:'mock'})});
  await customer.ok(`/orders/${o.id}/cancel`,{method:'POST',body:{}}); assert.equal((await sql('SELECT stock FROM products WHERE id=?',[p.id]))[0].stock,2);
  const payment={id:`pay_late_${tag}`,order_id:o.gateway_order_id,amount:Math.round(o.total*100),currency:'INR',status:'captured'};
  await anonymous.ok('/payments/webhook',webhook(payment,`evt_late_${tag}`)); const settled=await customer.ok(`/orders/${o.id}`); assert.equal(settled.status,'Cancelled'); assert.equal(settled.payment_status,'refund_required');
  await anonymous.ok('/payments/webhook',webhook(payment,`evt_late_${tag}`)); assert.equal((await sql('SELECT stock FROM products WHERE id=?',[p.id]))[0].stock,2);
  assert.equal((await admin.request(`/admin/products/${p.id}`,{method:'DELETE',body:{permanent:true}})).status,409);
  assert.equal((await admin.request(`/admin/orders/${o.id}`,{method:'POST',body:{status:'Processing'}})).status,409);
});

test('Audit history, dashboard and order export reflect committed changes without secrets', async () => {
  const dashboard = await admin.ok('/admin/dashboard'); assert.ok(dashboard.summary.products >= 10); assert.ok(dashboard.summary.orders >= 3); assert.ok(dashboard.ordersToday > 0);
  const audit = await admin.ok('/admin/activity?limit=100'); assert.ok(audit.items.some(x => x.action === 'product.created')); assert.ok(audit.items.some(x => /staff\./.test(x.action))); assert.ok(audit.items.every(x => x.created_at));
  const raw = JSON.stringify(audit); for (const secret of ['DemoOnly123!', 'TestStaff123!', 'ResetStaff123!', WEBHOOK_SECRET]) assert.ok(!raw.includes(secret));
  const csv = await admin.request('/admin/orders/export'); assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.text, /QA-TRACK-001/);
});
