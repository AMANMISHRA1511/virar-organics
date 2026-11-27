/** Upgrade checks against two real API instances and an isolated *_test database.
 * No external location, payment, notification or identity provider is contacted.
 */
import { test, before, after } from 'node:test';
import { createHmac } from 'node:crypto';
import {
  assert, Client, API_SECONDARY, pool, sql, tag, randomUUID, address,
  product, checkout, socket, poll, delay, WEBHOOK_SECRET,
} from './helpers.mjs';

const admin = new Client(), sales = new Client(API_SECONDARY);
const first = new Client(), second = new Client(API_SECONDARY), guest = new Client();
const clients = { admin, sales, first, second, guest };
const streams = {}, live = {}, fixture = {};
const detailedAddress = {
  label: 'Synthetic home', name: 'Upgrade QA Customer', phone: '+919000001234',
  flat: 'A-17', building: 'Synthetic Test Building', area: 'Test Orchard Area',
  landmark: 'Synthetic landmark', city: 'Virar', state: 'Maharashtra',
  pincode: '401303', country: 'India', lat: 19.4559, lng: 72.8114,
  accuracy: 12, is_default: true,
};
function listItems(value) {
  if (Array.isArray(value)) return value;
  assert.ok(Array.isArray(value.items), 'Expected an item list');
  return value.items;
}
async function savedAddresses(client) { return listItems(await client.ok('/account/addresses')); }
async function availability(client, ids) {
  const result = await client.ok('/products/availability', { method: 'POST', body: { ids } });
  assert.ok(Number.isSafeInteger(Number(result.revision)) && Number(result.revision) >= 0);
  assert.ok(Array.isArray(result.items));
  return result;
}
async function updateProduct(p, changes) {
  const current = await admin.ok(`/admin/products/${p.id}`);
  return admin.ok(`/admin/products/${p.id}`, { method: 'PUT', body: { ...current, expected_stock: current.stock, ...changes } });
}
async function expectCatalogue(clientName, productId, revision) {
  return poll(async () => live[clientName].catalogue.filter(e =>
    Number(e.revision) >= Number(revision) && e.productIds?.includes(productId)),
  values => values.length > 0, 12000);
}
async function notifications(client) { return listItems(await client.ok('/account/notifications?limit=100')); }
const forOrder = (items, orderId) => items.filter(n => Number(n.order_id ?? n.orderId) === orderId);
async function signedWebhook(order, event, { eventId = `upgrade-${randomUUID()}`, paymentId = `pay_upgrade_${order.id}`, amount, currency = 'INR' } = {}) {
  const body = JSON.stringify({ event, payload: { payment: { entity: {
    id: paymentId, order_id: order.gateway_order_id,
    amount: amount ?? Math.round(order.total * 100), currency,
    status: event === 'payment.failed' ? 'failed' : 'captured',
  } } } });
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  return guest.request('/payments/webhook', { method: 'POST', raw: true, body,
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature, 'X-Razorpay-Event-Id': eventId } });
}

before(async () => {
  await admin.login('admin@mitti.test'); await sales.login('sales@mitti.test');
  await first.register(`upgrade-first-${tag}@example.test`, 'Upgrade first customer');
  await second.register(`upgrade-second-${tag}@example.test`, 'Upgrade second customer');
  await guest.token();
  for (const [name, client] of Object.entries(clients)) {
    streams[name] = await socket(client, name === 'admin' ? API_SECONDARY : client.base);
    live[name] = { catalogue: [], notices: [], orders: [] };
    streams[name].on('catalogue', e => live[name].catalogue.push(e));
    streams[name].on('inapp:notification', e => live[name].notices.push(e));
    streams[name].on('order:updated', e => live[name].orders.push(e));
  }
});
after(async () => { Object.values(streams).forEach(s => s.disconnect()); await pool.end(); });

test('Unknown password sign-in stays unauthenticated and creates no account', async () => {
  const c = new Client(); await c.token(); const email = `unknown-${tag}@example.test`;
  const beforeCount = await sql('SELECT COUNT(*) AS n FROM users WHERE email=?', [email]);
  const response = await c.request('/login', { method: 'POST', body: { email, password: 'AnyUnknownPassword123!' } });
  assert.equal(response.status, 401); assert.equal((await c.request('/me')).status, 401);
  assert.equal((await sql('SELECT COUNT(*) AS n FROM users WHERE email=?', [email]))[0].n, beforeCount[0].n);
});

test('Anonymous cart, checkout, address, inventory-personalization and notification saves are rejected', async () => {
  for (const path of ['/cart', '/orders', '/account/addresses', '/account/notifications', '/admin/customers']) {
    assert.equal((await guest.request(path)).status, 401, path);
  }
  for (const [path, method, body] of [
    ['/cart', 'PUT', { items: [{ id: 1, quantity: 1 }] }],
    ['/orders', 'POST', { items: [{ id: 1, quantity: 1 }], address, payment_method: 'cod' }],
    ['/account/addresses', 'POST', detailedAddress],
    ['/leads', 'POST', { name: 'Guest enquiry must not be saved' }],
    ['/account/addresses/1', 'PATCH', detailedAddress],
    ['/account/addresses/1', 'DELETE', {}],
    ['/products/availability', 'POST', { ids: [1] }],
    ['/account/notifications/1', 'PATCH', { read: true }],
    ['/account/notifications/read-all', 'POST', {}],
  ]) assert.equal((await guest.request(path, { method, body })).status, 401, `${method} ${path}`);
});

test('Sales cannot read customer directories, saved addresses or private customer notifications', async () => {
  for (const path of ['/admin/customers', `/admin/customers/${first.user.id}`, '/account/addresses', '/account/notifications']) {
    assert.equal((await sales.request(path)).status, 403, path);
  }
  for (const [path, method, body] of [
    ['/account/addresses', 'POST', detailedAddress],
    ['/account/addresses/1', 'PATCH', detailedAddress],
    ['/account/addresses/1', 'DELETE', {}],
    ['/account/notifications/1', 'PATCH', { read: true }],
  ]) assert.equal((await sales.request(path, { method, body })).status, 403, path);
  assert.equal((await first.request('/admin/customers')).status, 403);
  assert.equal((await second.request(`/admin/customers/${first.user.id}`)).status, 403);
  assert.equal((await admin.request('/account/addresses')).status, 403, 'Staff accounts cannot save customer addresses');
});

test('Structured address fields and device-coordinate metadata round-trip without external geocoding', async () => {
  fixture.address = await first.ok('/account/addresses', { method: 'POST', body: detailedAddress });
  const saved = (await savedAddresses(first)).find(a => a.id === fixture.address.id); assert.ok(saved);
  for (const key of ['label', 'name', 'phone', 'flat', 'building', 'area', 'landmark', 'city', 'state', 'pincode', 'country']) {
    assert.equal(saved[key], detailedAddress[key], key);
  }
  assert.equal(Number(saved.lat), detailedAddress.lat); assert.equal(Number(saved.lng), detailedAddress.lng);
  assert.equal(Number(saved.accuracy), detailedAddress.accuracy); assert.equal(Boolean(saved.is_default), true);
  assert.deepEqual(await savedAddresses(second), []);
});

test('Saved addresses reject malformed coordinates and preserve customer ownership on every mutation', async () => {
  for (const change of [{ pincode: '123' }, { lat: 91 }, { lng: -181 }, { lat: 19, lng: null }, { accuracy: -1 }]) {
    assert.equal((await first.request('/account/addresses', { method: 'POST', body: { ...detailedAddress, ...change } })).status, 422, JSON.stringify(change));
  }
  for (const method of ['PATCH', 'DELETE']) {
    const response = await second.request(`/account/addresses/${fixture.address.id}`, { method, body: method === 'PATCH' ? { city: 'Foreign change' } : {} });
    assert.equal(response.status, 404, method);
  }
  assert.equal((await savedAddresses(first)).find(a => a.id === fixture.address.id).city, 'Virar');
  const response = await second.ok('/account/addresses', { method: 'POST', body: { ...detailedAddress, user_id: first.user.id, label: 'Second customer only' } });
  assert.ok((await savedAddresses(second)).some(a => a.id === response.id));
  assert.ok(!(await savedAddresses(first)).some(a => a.id === response.id));
});

test('Concurrent default-address changes leave exactly one default and deletion selects a fallback', async () => {
  const result = await Promise.all(['One', 'Two'].map(label => first.ok('/account/addresses', {
    method: 'POST', body: { ...detailedAddress, label: `Concurrent ${label}`, is_default: true },
  })));
  const all = await savedAddresses(first); assert.equal(all.filter(a => a.is_default).length, 1);
  const current = all.find(a => a.is_default); assert.ok(result.some(a => a.id === current.id));
  await first.ok(`/account/addresses/${current.id}`, { method: 'DELETE', body: {} });
  const remaining = await savedAddresses(first); assert.equal(remaining.filter(a => a.is_default).length, 1);
  assert.ok(!remaining.some(a => a.id === current.id));
});

test('The saved-address limit is enforced under simultaneous additions', async () => {
  const limited = new Client(); await limited.register(`address-limit-${tag}@example.test`, 'Address limit fixture');
  const attempts = await Promise.all(Array.from({ length: 22 }, (_, index) => limited.request('/account/addresses', {
    method: 'POST', body: { ...detailedAddress, label: `Limit ${index}`, is_default: false },
  })));
  assert.equal(attempts.filter(r => r.status === 201).length, 20);
  assert.equal(attempts.filter(r => [409, 422].includes(r.status)).length, 2);
  const rows = await savedAddresses(limited); assert.equal(rows.length, 20); assert.equal(rows.filter(a => a.is_default).length, 1);
});

test('Profile edits and address changes are visible only in the Admin customer directory', async () => {
  await first.ok('/account', { method: 'PATCH', body: { name: `Upgrade profile ${tag}`, phone: '+919000009876' } });
  await first.ok(`/account/addresses/${fixture.address.id}`, { method: 'PATCH', body: { flat: 'B-29', area: 'Edited synthetic locality' } });
  const listing = await admin.ok(`/admin/customers?q=${encodeURIComponent(first.user.email)}`);
  assert.ok(listItems(listing).some(u => u.id === first.user.id));
  const detail = await admin.ok(`/admin/customers/${first.user.id}`);
  assert.equal(detail.customer.name, `Upgrade profile ${tag}`); assert.equal(detail.customer.phone, '+919000009876');
  assert.equal(detail.addresses.find(a => a.id === fixture.address.id).flat, 'B-29');
  assert.equal(detail.addresses.find(a => a.id === fixture.address.id).area, 'Edited synthetic locality');
  assert.ok(Array.isArray(detail.orders)); assert.ok(detail.summary);
  for (const field of ['password', 'password_hash', 'session_version', 'google_sub']) assert.equal(detail.customer[field], undefined, field);
  assert.ok(detail.addresses.every(a => a.user_id === undefined || a.user_id === first.user.id));
});

test('Authenticated enquiries are linked to their actual customer in the Admin CRM history', async () => {
  const lead = await first.ok('/leads', { method: 'POST', body: {
    name: `Upgrade enquiry ${tag}`, email: first.user.email, phone: '+919000001234',
    product: 'Synthetic pantry request', quantity: 12, message: 'Synthetic customer CRM round-trip.', user_id: second.user.id,
  } });
  const saved = await admin.ok(`/admin/leads/${lead.id}`); assert.equal(saved.user_id, first.user.id);
  const directory = await admin.ok(`/admin/customers/${first.user.id}`); assert.ok(directory.leads.some(item => item.id === lead.id));
  const other = await admin.ok(`/admin/customers/${second.user.id}`); assert.ok(!other.leads.some(item => item.id === lead.id));
});

test('Checkout resolves an owned address snapshot and rejects a foreign saved address without stock changes', async () => {
  const p = await product(admin, { name: `Address snapshot ${tag}`, stock: 5 });
  const foreign = await second.request('/orders', { method: 'POST', body: {
    items: [{ id: p.id, quantity: 1 }], address_id: fixture.address.id, payment_method: 'cod', idempotency_key: randomUUID(),
  } });
  assert.equal(foreign.status, 404); assert.equal((await first.ok(`/products/${p.id}`)).stock, 5);
  const savedRequest = {
    items: [{ id: p.id, quantity: 1 }], address_id: fixture.address.id, payment_method: 'cod', idempotency_key: randomUUID(),
  };
  const order = await first.ok('/orders', { method: 'POST', body: savedRequest });
  assert.equal(order.address.flat, 'B-29'); assert.equal(order.address.area, 'Edited synthetic locality');
  await first.ok(`/account/addresses/${fixture.address.id}`, { method: 'PATCH', body: { flat: 'C-42', area: 'New address after order' } });
  const historical = await first.ok(`/orders/${order.id}`);
  assert.equal(historical.address.flat, 'B-29'); assert.equal(historical.address.area, 'Edited synthetic locality');
  const repeated = await first.request('/orders', { method: 'POST', body: savedRequest });
  assert.equal(repeated.status, 200); assert.equal(repeated.body.id, order.id); assert.equal(repeated.body.address.flat, 'B-29');
  const directory = await admin.ok(`/admin/customers/${first.user.id}`);
  assert.ok(directory.orders.some(o => o.id === order.id));
  const count = (await savedAddresses(first)).length;
  await first.ok('/orders', { method: 'POST', body: checkout(p, { address: { ...address, line1: 'Inline address is not implicitly saved' } }) });
  assert.equal((await savedAddresses(first)).length, count);
});

test('Two independent customers each requesting all ten units produce one winner and one 409', async () => {
  const p = await product(admin, { name: `Ten-unit race ${tag}`, stock: 10 }); fixture.raceProduct = p;
  const before = await availability(first, [p.id]);
  const attempts = await Promise.all([first, second].map(client => client.request('/orders', {
    method: 'POST', body: checkout(p, { items: [{ id: p.id, quantity: 10 }] }),
  })));
  assert.deepEqual(attempts.map(r => r.status).sort(), [201, 409]);
  const winner = attempts.findIndex(r => r.status === 201); fixture.raceOwner = [first, second][winner]; fixture.raceOrder = attempts[winner].body;
  assert.equal((await first.ok(`/products/${p.id}`)).stock, 0);
  const count = await sql('SELECT COUNT(*) n FROM orders o JOIN order_items i ON i.order_id=o.id WHERE i.product_id=?', [p.id]); assert.equal(count[0].n, 1);
  const current = await availability(second, [p.id]); assert.equal(Number(current.revision), Number(before.revision) + 1);
  assert.equal(current.items[0].available, false); assert.equal(current.items[0].reason, 'out_of_stock'); assert.equal(current.items[0].stock, 0);
  await Promise.all(['first', 'second', 'guest'].map(name => expectCatalogue(name, p.id, current.revision)));
});

test('Repeated cancellation restores all ten units once and publishes one new inventory revision', async () => {
  const p = fixture.raceProduct, owner = fixture.raceOwner, order = fixture.raceOrder;
  const before = await availability(first, [p.id]);
  const replies = await Promise.all(Array.from({ length: 8 }, (_, i) => owner.clone(i % 2 ? API_SECONDARY : first.base).request(`/orders/${order.id}/cancel`, { method: 'POST', body: {} })));
  assert.ok(replies.every(r => r.status === 200));
  assert.equal((await first.ok(`/products/${p.id}`)).stock, 10);
  const current = await availability(second, [p.id]); assert.equal(Number(current.revision), Number(before.revision) + 1);
  assert.equal(current.items[0].available, true);
  assert.equal((await sql("SELECT COUNT(*) n FROM order_activity WHERE order_id=? AND status='Cancelled'", [order.id]))[0].n, 1);
  await Promise.all(['first', 'second', 'guest'].map(name => expectCatalogue(name, p.id, current.revision)));
});

test('Repeated simultaneous checkout requests create one order and one inventory decrement', async () => {
  const p = await product(admin, { name: `Upgrade duplicate ${tag}`, stock: 10 });
  const before = await availability(first, [p.id]); const body = checkout(p, { items: [{ id: p.id, quantity: 3 }] });
  const replies = await Promise.all(Array.from({ length: 8 }, (_, i) => first.clone(i % 2 ? API_SECONDARY : first.base).request('/orders', { method: 'POST', body })));
  assert.equal(replies.filter(r => r.status === 201).length, 1); assert.equal(replies.filter(r => r.status === 200).length, 7);
  assert.equal(new Set(replies.map(r => r.body.id)).size, 1); assert.equal((await first.ok(`/products/${p.id}`)).stock, 7);
  assert.equal(Number((await availability(second, [p.id])).revision), Number(before.revision) + 1);
  fixture.recovery = { key: body.idempotency_key, orderId: replies[0].body.id };
});

test('Checkout-key recovery returns only the authenticated owner’s committed order', async () => {
  const path = `/orders/by-checkout-key/${fixture.recovery.key}`;
  const recovered = await first.ok(path); assert.equal(recovered.order.id, fixture.recovery.orderId);
  assert.equal((await second.ok(path)).order, null);
  assert.equal((await guest.request(path)).status, 401);
  assert.equal((await sales.request(path)).status, 403);
  assert.equal((await first.ok(`/orders/by-checkout-key/${randomUUID()}`)).order, null);
});

test('Admin deactivation invalidates both API caches and broadcasts a public-only availability hint', async () => {
  const p = await product(admin, { name: `Unavailable upgrade ${tag}`, stock: 4, featured: true });
  await first.ok(`/products?q=${encodeURIComponent(p.name)}`); await second.ok(`/products?q=${encodeURIComponent(p.name)}`);
  await first.ok('/cart', { method: 'PUT', body: { items: [{ id: p.id, quantity: 1 }] } });
  await updateProduct(p, { active: false });
  const current = await availability(second, [p.id]); assert.equal(current.items[0].available, false); assert.equal(current.items[0].reason, 'inactive');
  for (const client of [first, second]) {
    assert.equal((await client.request(`/products/${p.id}`)).status, 404);
    assert.equal((await client.ok(`/products?q=${encodeURIComponent(p.name)}`)).items.some(item => item.id === p.id), false);
    assert.equal((await client.request('/orders', { method: 'POST', body: checkout(p) })).status, 409);
  }
  const cart = await first.ok('/cart'); assert.ok(cart.availability);
  await Promise.all(['first', 'second', 'guest'].map(name => expectCatalogue(name, p.id, current.revision)));
  const publicEvents = live.guest.catalogue.filter(e => e.productIds?.includes(p.id));
  for (const event of publicEvents) {
    for (const field of ['user_id', 'email', 'phone', 'address', 'orders', 'notifications']) assert.equal(event[field], undefined, field);
  }
});

test('Availability distinguishes zero stock, category deactivation and permanent deletion', async () => {
  const category = await admin.ok('/admin/categories', { method: 'POST', body: { name: `Upgrade availability ${tag}`, description: 'Synthetic availability category', image: '', active: true } });
  const p = await product(admin, { name: `Availability reasons ${tag}`, stock: 0, category_id: category.id });
  assert.equal((await availability(first, [p.id])).items[0].reason, 'out_of_stock');
  await updateProduct(p, { stock: 6 }); assert.equal((await availability(second, [p.id])).items[0].available, true);
  await admin.ok('/admin/categories', { method: 'POST', body: { ...category, active: false } });
  assert.equal((await availability(first, [p.id])).items[0].reason, 'category_inactive');
  await admin.ok(`/admin/products/${p.id}`, { method: 'DELETE', body: { permanent: true } });
  const gone = (await availability(second, [p.id])).items[0]; assert.equal(gone.exists, false); assert.equal(gone.reason, 'deleted');
});

test('Inventory alerts reach only Admin while the public hint contains no customer information', async () => {
  const p = await product(admin, { name: `Private stock alert ${tag}`, stock: 1 });
  await first.ok('/orders', { method: 'POST', body: checkout(p) });
  const adminNotices = await poll(() => notifications(admin), rows => rows.some(n => n.product_id === p.id && n.type === 'inventory.out_of_stock'), 12000);
  assert.ok(adminNotices.some(n => n.product_id === p.id && n.type === 'inventory.out_of_stock'));
  await updateProduct(p, { active: false });
  await poll(() => notifications(admin), rows => rows.some(n => n.product_id === p.id && n.type === 'inventory.unavailable'), 12000);
  await poll(async () => live.admin.notices.filter(n => Number(n.productId) === p.id), rows => rows.length >= 2, 12000);
  for (const name of ['first', 'second', 'sales', 'guest']) assert.equal(live[name].notices.some(n => Number(n.productId) === p.id), false, name);
  for (const client of [first, second]) assert.equal((await notifications(client)).some(n => n.product_id === p.id && n.type.startsWith('inventory.')), false);
});

test('Captured and order-paid webhook replays settle once without a second stock decrement', async () => {
  const p = await product(admin, { name: `Webhook upgrade ${tag}`, stock: 5 });
  const order = await first.ok('/orders', { method: 'POST', body: checkout(p, { payment_method: 'mock', items: [{ id: p.id, quantity: 2 }] }) });
  const afterReservation = await availability(first, [p.id]);
  const eventId = `upgrade-capture-${randomUUID()}`;
  const responses = await Promise.all(Array.from({ length: 6 }, () => signedWebhook(order, 'payment.captured', { eventId })));
  assert.ok(responses.every(r => r.status === 200));
  const paid = await signedWebhook(order, 'order.paid'); assert.equal(paid.status, 200); assert.equal(paid.body.duplicate, true);
  const saved = await first.ok(`/orders/${order.id}`); assert.equal(saved.payment_status, 'paid'); assert.equal(saved.status, 'Paid');
  assert.equal((await first.ok(`/products/${p.id}`)).stock, 3);
  assert.equal(Number((await availability(second, [p.id])).revision), Number(afterReservation.revision));
  assert.equal((await sql("SELECT COUNT(*) n FROM audit_log WHERE entity_type='order' AND entity_id=? AND action='payment.success'", [String(order.id)]))[0].n, 1);
  const own = forOrder(await notifications(first), order.id);
  assert.equal(own.filter(n => n.type === 'order.placed').length, 1); assert.equal(own.filter(n => n.type === 'payment.confirmed').length, 1); assert.equal(own.length, 2);
  fixture.notificationOrder = order;
});

test('A reused webhook event identifier cannot be applied to a different order or payment', async () => {
  const p = await product(admin, { name: `Webhook event conflict ${tag}`, stock: 5 });
  const orders = await Promise.all([first, second].map(client => client.ok('/orders', { method: 'POST', body: checkout(p, { payment_method: 'mock' }) })));
  const eventId = `upgrade-event-conflict-${randomUUID()}`;
  assert.equal((await signedWebhook(orders[0], 'payment.captured', { eventId })).status, 200);
  const wrongOrder = await signedWebhook(orders[1], 'payment.captured', { eventId }); assert.equal(wrongOrder.status, 409);
  const wrongPayment = await signedWebhook(orders[0], 'payment.captured', { eventId, paymentId: 'different-payment-identity' }); assert.equal(wrongPayment.status, 409);
  const wrongType = await signedWebhook(orders[0], 'order.paid', { eventId }); assert.equal(wrongType.status, 409);
  assert.equal((await first.ok(`/orders/${orders[0].id}`)).payment_status, 'paid'); assert.equal((await second.ok(`/orders/${orders[1].id}`)).payment_status, 'pending');
  assert.equal((await first.ok(`/products/${p.id}`)).stock, 3);
});

test('Failed payment replays retain the reservation and later cancellation restores it only once', async () => {
  const p = await product(admin, { name: `Failed payment ${tag}`, stock: 7 });
  const order = await second.ok('/orders', { method: 'POST', body: checkout(p, { payment_method: 'mock', items: [{ id: p.id, quantity: 3 }] }) });
  const before = await availability(first, [p.id]); const eventId = `upgrade-failed-${randomUUID()}`;
  for (let i = 0; i < 3; i++) assert.equal((await signedWebhook(order, 'payment.failed', { eventId })).status, 200);
  assert.equal((await second.ok(`/orders/${order.id}`)).payment_status, 'failed');
  assert.equal((await first.ok(`/products/${p.id}`)).stock, 4); assert.equal(Number((await availability(first, [p.id])).revision), Number(before.revision));
  await Promise.all(Array.from({ length: 5 }, () => second.ok(`/orders/${order.id}/cancel`, { method: 'POST', body: {} })));
  assert.equal((await first.ok(`/products/${p.id}`)).stock, 7); assert.equal(Number((await availability(first, [p.id])).revision), Number(before.revision) + 1);
  assert.equal((await signedWebhook(order, 'payment.captured')).status, 200);
  const late = await second.ok(`/orders/${order.id}`); assert.equal(late.status, 'Cancelled'); assert.equal(late.payment_status, 'refund_required');
  assert.equal((await first.ok(`/products/${p.id}`)).stock, 7);
});

test('In-app order notifications are private to their owner and Admin across API instances', async () => {
  const order = fixture.notificationOrder;
  const own = await poll(() => notifications(first), items => forOrder(items, order.id).length >= 2, 12000);
  const adminNotices = await poll(() => notifications(admin), items => forOrder(items, order.id).length >= 2, 12000);
  assert.ok(forOrder(adminNotices, order.id).length >= 2);
  assert.equal(forOrder(await notifications(second), order.id).length, 0);
  await poll(async () => live.first.notices.filter(n => Number(n.orderId) === order.id), items => items.length >= 1, 12000);
  await poll(async () => live.admin.notices.filter(n => Number(n.orderId) === order.id), items => items.length >= 1, 12000);
  await delay(200);
  for (const name of ['second', 'sales', 'guest']) assert.equal(live[name].notices.some(n => Number(n.orderId) === order.id), false, name);
  fixture.ownNotice = forOrder(own, order.id)[0];
});

test('Notification read markers are idempotent and cannot cross customer ownership', async () => {
  const notice = fixture.ownNotice;
  assert.equal((await second.request(`/account/notifications/${notice.id}`, { method: 'PATCH', body: { read: true } })).status, 404);
  for (let i = 0; i < 3; i++) await first.ok(`/account/notifications/${notice.id}`, { method: 'PATCH', body: { read: true } });
  const unread = listItems(await first.ok('/account/notifications?unread=true&limit=100')); assert.ok(!unread.some(n => n.id === notice.id));
  await first.ok('/account/notifications/read-all', { method: 'POST', body: {} });
  assert.equal(listItems(await first.ok('/account/notifications?unread=true&limit=100')).length, 0);
});
