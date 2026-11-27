/** Bounded local baseline, not a production capacity claim. Requires isolated test API. */
import fs from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { Client, product, checkout, pool, sql, tag } from './helpers.mjs';
const admin = new Client(), customer = new Client(), visitor = new Client();
await admin.login('admin@mitti.test'); await customer.login('customer@mitti.test');
const p = await product(admin, { name: `Load baseline ${tag}`, price: 150, stock: 1000 });
const percentile = (a, n) => a[Math.min(a.length - 1, Math.ceil(n * a.length) - 1)] || 0;
async function phase(label, total, concurrency, task) {
  const durations = [], statuses = {}, errors = []; let next = 0;
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < total) {
      const i = next++; const t = performance.now();
      try { const r = await task(i); statuses[r.status] = (statuses[r.status] || 0) + 1; if (r.status >= 400) errors.push({ request: i, status: r.status, body: r.body }); }
      catch (e) { statuses.exception = (statuses.exception || 0) + 1; errors.push({ request: i, error: e.message }); }
      durations.push(performance.now() - t);
    }
  }));
  const elapsed = (performance.now() - start) / 1000; durations.sort((a,b) => a-b);
  return { label, requests: total, concurrency, elapsedSeconds: +elapsed.toFixed(3), requestsPerSecond: +(total / elapsed).toFixed(2), latencyMs: { p50: +percentile(durations,.5).toFixed(2), p95: +percentile(durations,.95).toFixed(2), max: +durations.at(-1).toFixed(2) }, statuses, errors };
}
const catalogue = await phase('Public catalogue with search/filter mix', 400, 12, i => visitor.request(['/products?limit=12','/products?sort=price_asc&limit=12','/products?inStock=true&limit=12','/products?q=rice&limit=12'][i % 4]));
const ordersBefore = (await sql('SELECT COUNT(*) n FROM orders'))[0].n;
const checkoutPhase = await phase('Authenticated COD checkout', 48, 8, () => customer.request('/orders', { method: 'POST', body: checkout(p) }));
const ordersAfter = (await sql('SELECT COUNT(*) n FROM orders'))[0].n;
const stock = (await sql('SELECT stock FROM products WHERE id=?',[p.id]))[0].stock;
const report = { generatedAt: new Date().toISOString(), environment: { os: os.platform(), release: os.release(), architecture: os.arch(), node: process.version, cpuCountVisible: os.cpus().length, database: (await sql('SELECT VERSION() version'))[0].version, apiInstances: 2, payment: 'COD only; mock gateway tested separately', notifications: 'BullMQ with simulated providers', rateLimitMultiplier: 100 }, scenarios: [catalogue, checkoutPhase], invariants: { successfulCheckoutCount: checkoutPhase.statuses[201] || 0, createdOrders: ordersAfter - ordersBefore, startingStock: 1000, remainingStock: stock, stockMatchesSuccessfulOrders: stock === 1000 - (ordersAfter - ordersBefore) }, limitations: ['Local bounded baseline on a shared authoring environment.', 'Does not establish production capacity or a 24-hour reliability guarantee.', 'No real Razorpay, SMTP or SMS provider traffic.', 'Redis availability/recovery and last-unit races are checked by other test scripts.'] };
await fs.mkdir(new URL('./results/', import.meta.url), { recursive: true });
await fs.writeFile(new URL('./results/load-results.json', import.meta.url), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
await pool.end();
if (catalogue.errors.length || checkoutPhase.errors.length || !report.invariants.stockMatchesSuccessfulOrders) process.exitCode = 1;
