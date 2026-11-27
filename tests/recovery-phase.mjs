import { Client, assert, pool, product, checkout, poll, sql, tag, socket, eventPromise, API_SECONDARY } from './helpers.mjs';
import fs from 'node:fs/promises';
const fixtureURL = new URL('./results/recovery-fixture.json', import.meta.url);
const admin = new Client(), customer = new Client(), secondary = new Client(API_SECONDARY);
await admin.login('admin@mitti.test'); await customer.login('customer@mitti.test');
try {
  if (process.argv[2] === 'warm') {
    const p = await product(admin, { name: `Redis recovery catalogue ${tag}`, stock: 3, price: 150 });
    const query = `/products?q=${encodeURIComponent(p.name)}`;
    const warmed = await Promise.all([customer.ok(query), secondary.ok(query)]);
    assert.ok(warmed.every(result => result.items.some(item => item.id === p.id && item.stock === 3 && item.price === 150)));
    const [last] = await sql('SELECT COALESCE(MAX(id),0) id FROM realtime_events');
    await fs.writeFile(fixtureURL, JSON.stringify({ productId: p.id, product: p, query, startingEventId: last.id, startingRevision: Number(warmed[0].revision), warm: { apiInstances: 2, stock: 3, price: 150 } }));
    console.log('Warmed catalogue caches on both API instances before the controlled Redis outage.');
  } else if (process.argv[2] === 'down') {
    const f = JSON.parse(await fs.readFile(fixtureURL, 'utf8'));
    assert.equal((await admin.ok('/config')).redis, false);
    const ready = await admin.request('/ready'); assert.equal(ready.status, 503);
    const publicSocket = await socket(new Client(), API_SECONDARY), events = [];
    publicSocket.on('catalogue', event => events.push(event));
    try {
      // More than one delivery batch checks progress beyond the first 100
      // pending SQL hints while shared publication cannot be acknowledged.
      for (let i = 1; i <= 105; i++) {
        await admin.ok(`/admin/products/${f.productId}`, { method: 'PUT', body: { ...f.product, expected_stock: 3, price: 150 + i / 100 } });
      }
      const r = await customer.request('/orders', { method: 'POST', body: checkout(f.product) });
      assert.equal(r.status, 201, r.text); assert.equal(r.headers.get('X-RateLimit-Mode'), 'local-degraded');
      const notes = await sql('SELECT id,status,attempts FROM notifications WHERE order_id=?', [r.body.id]);
      assert.equal(notes.length, 2); assert.ok(notes.every(n => ['pending', 'queued'].includes(n.status))); assert.ok(notes.every(n => n.attempts === 0));
      const notices = await sql('SELECT id,user_id,audience,type FROM in_app_notifications WHERE order_id=?', [r.body.id]);
      assert.equal(notices.filter(n => n.user_id === customer.user.id && n.audience === 'customer' && n.type === 'order.placed').length, 1);
      assert.ok(notices.some(n => n.audience === 'admin' && n.type === 'order.placed'));
      const [state] = await sql('SELECT revision FROM catalogue_state WHERE id=1');
      assert.equal(Number(state.revision), f.startingRevision + 106);
      await poll(async () => events, values => values.some(e => Number(e.revision) === Number(state.revision) && e.productIds?.includes(f.productId)), 15000);
      const pending = await sql('SELECT id,event_name,payload FROM realtime_events WHERE published_at IS NULL AND id>? ORDER BY id', [f.startingEventId]);
      const catalogueHints = pending.filter(e => e.event_name === 'catalogue'); assert.equal(catalogueHints.length, 106);
      f.orderId = r.body.id; f.lastRevision = Number(state.revision);
      f.down = { readiness: ready.status, checkout: r.status, rateLimitMode: r.headers.get('X-RateLimit-Mode'), outbox: notes, persistedInAppNotices: notices.length, durableEventsPending: pending.length, catalogueHintsPending: catalogueHints.length, lastLocalPublicRevisionObserved: f.lastRevision, localPublicAcrossOtherApi: true };
      await fs.writeFile(fixtureURL, JSON.stringify(f));
      console.log('Redis outage: COD committed; 106 catalogue hints plus private notices retained; the second API local socket saw the newest revision beyond the first 100 pending events.');
    } finally { publicSocket.disconnect(); }
  } else {
    const f = JSON.parse(await fs.readFile(fixtureURL, 'utf8'));
    await poll(() => admin.ok('/config'), value => value.redis === true, 25000);
    // A command connection can be ready before this replica's SUBSCRIBE ack.
    // Wait for both replicas' live-message readiness before testing new hints.
    await poll(() => Promise.all([admin.request('/ready'), secondary.request('/ready')]), results => results.every(result => result.status === 200 && result.body.realtime === true), 25000);
    const notes = await poll(() => sql('SELECT id,status,attempts FROM notifications WHERE order_id=?', [f.orderId]), values => values.length === 2 && values.every(n => n.status === 'simulated'), 30000);
    await poll(() => sql('SELECT COUNT(*) n FROM realtime_events WHERE published_at IS NULL AND id>?', [f.startingEventId]), rows => rows[0].n === 0, 30000);
    const refreshed = await Promise.all([customer.ok(f.query), secondary.ok(f.query)]);
    for (const result of refreshed) {
      const p = result.items.find(item => item.id === f.productId); assert.ok(p); assert.equal(p.stock, 2); assert.equal(p.price, 151.05); assert.equal(Number(result.revision), f.lastRevision);
    }
    const ownerSocket = await socket(customer, API_SECONDARY), publicSocket = await socket(new Client(), API_SECONDARY);
    try {
      const gotOrder = eventPromise(ownerSocket, 'order:updated', event => event.id === f.orderId);
      await admin.ok(`/admin/orders/${f.orderId}`, { method: 'POST', body: { status: 'Processing', tracking: '', delivery_notes: 'Redis recovered' } }); await gotOrder;
      const gotCatalogue = eventPromise(publicSocket, 'catalogue', event => event.productIds?.includes(f.productId) && Number(event.revision) > f.lastRevision);
      const current = await admin.ok(`/admin/products/${f.productId}`);
      await admin.ok(`/admin/products/${f.productId}`, { method: 'PUT', body: { ...current, expected_stock: current.stock, price: 155 } }); await gotCatalogue;
    } finally { ownerSocket.disconnect(); publicSocket.disconnect(); }
    assert.equal((await customer.ok(`/orders/${f.orderId}`)).status, 'Processing');
    const result = { check: 'Redis outage/recovery with committed checkout, more than 100 durable hints, fresh caches and recovered cross-instance events', productId: f.productId, orderId: f.orderId, warm: f.warm, down: f.down, recovered: { readiness: (await admin.request('/ready')).status, notifications: notes, pendingRealtimeEvents: 0, previouslyWarmedCachesFresh: true, privateCrossInstanceEvent: true, publicCrossInstanceEvent: true }, passed: true };
    await fs.writeFile(new URL('./results/recovery-results.json', import.meta.url), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  }
} finally { await pool.end(); }
