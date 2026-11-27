import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const requireBackend = createRequire(new URL('../backend/package.json', import.meta.url));
export const mysql = requireBackend('mysql2/promise');
export const sharp = requireBackend('sharp');
export const socketIO = requireBackend('socket.io-client').io;
export const API = process.env.TEST_API_URL || 'http://127.0.0.1:4100';
export const API_SECONDARY = process.env.TEST_API_SECONDARY || 'http://127.0.0.1:4101';
export const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'local-test-webhook-secret-not-a-real-gateway-key';
export const tag = randomUUID().slice(0, 8);
export { assert, delay, randomUUID };
export class Client {
  constructor(base = API) { this.base = base; this.cookies = new Map(); this.csrf = ''; }
  get cookie() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  clone(base = this.base) { const c = new Client(base); c.cookies = new Map(this.cookies); c.csrf = this.csrf; return c; }
  async request(path, { method = 'GET', body, headers = {}, csrf = true, raw = false } = {}) {
    const h = { ...headers }; if (this.cookie && !h.Cookie) h.Cookie = this.cookie;
    if (csrf && this.csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) h['X-CSRF-Token'] = this.csrf;
    if (body !== undefined && !(body instanceof FormData) && !raw) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const response = await fetch(`${this.base}/api${path}`, { method, headers: h, body, signal: AbortSignal.timeout(20000) });
    for (const value of response.headers.getSetCookie()) { const [entry] = value.split(';'); const i = entry.indexOf('='); this.cookies.set(entry.slice(0, i), entry.slice(i + 1)); }
    const text = await response.text(); let result; try { result = JSON.parse(text); } catch { result = text; }
    return { status: response.status, body: result, headers: response.headers, text };
  }
  async token() { const r = await this.request('/csrf'); assert.equal(r.status, 200, r.text); this.csrf = r.body.csrfToken; return this.csrf; }
  async login(email, password = 'DemoOnly123!') { await this.token(); const r = await this.request('/login', { method: 'POST', body: { email, password } }); assert.equal(r.status, 200, r.text); this.user = r.body; return r; }
  async register(email, name = 'QA Customer') { await this.token(); const r = await this.request('/register', { method: 'POST', body: { name, email, phone: '+91 9000012345', password: 'TestCustomer123!' } }); assert.equal(r.status, 201, r.text); this.user = r.body; return r; }
  async ok(path, options = {}, statuses = [200, 201]) { const r = await this.request(path, options); assert.ok(statuses.includes(r.status), `${options.method || 'GET'} ${path}: ${r.status} ${r.text}`); return r.body; }
}
const dialect = process.env.DB_CLIENT || 'mysql';
const testDatabase = dialect === 'postgres'
  ? decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1))
  : process.env.TEST_DATABASE || process.env.DB_NAME || 'mitti_test';
if (!/(?:_test|_qa)$/.test(testDatabase)) throw new Error('Integration tests require a dedicated database ending _test or _qa.');
const testDatabasePassword = process.env.DB_PASSWORD ?? process.env.TEST_DB_PASSWORD;
if (dialect !== 'postgres' && testDatabasePassword === undefined) throw new Error('Integration tests require an explicitly configured DB_PASSWORD or TEST_DB_PASSWORD. Use scripts/test-system.mjs or configure an isolated test database.');
export const pool = dialect === 'postgres' ? (await import('../backend/src/postgres.js')).createPostgresPool((await import('../backend/src/config.js')).config)
  : mysql.createPool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3307), user: process.env.DB_USER || 'mitti', password: testDatabasePassword, database: testDatabase, connectionLimit: 6, decimalNumbers: true, dateStrings: true });
export async function sql(query, params = []) { return (await pool.execute(query, params))[0]; }
export const address = { name: 'QA Customer', phone: '+91 9000012345', line1: '1 Test Orchard Lane', line2: 'Synthetic test address', city: 'Virar', pincode: '401303', lat: 19.4559, lng: 72.8114 };
export async function product(admin, overrides = {}) {
  return admin.ok('/admin/products', { method: 'POST', body: { name: `QA pantry ${tag}`, description: 'Synthetic integration test inventory.', price: 150, sale_price: null, unit: '500 g', stock: 20, category_id: null, images: [], active: true, featured: false, ...overrides } });
}
export const checkout = (p, overrides = {}) => ({ items: [{ id: p.id, quantity: 1 }], address, payment_method: 'cod', idempotency_key: randomUUID(), ...overrides });
export async function upload(admin, colours = ['#557047', '#D3A56B']) {
  const f = new FormData();
  for (let i = 0; i < colours.length; i++) {
    const data = await sharp({ create: { width: 120, height: 90, channels: 3, background: colours[i] } }).png().toBuffer();
    f.append('images', new Blob([data], { type: 'image/png' }), `qa-${i}.png`);
  }
  return admin.ok('/admin/upload', { method: 'POST', body: f });
}
export async function poll(fn, predicate, timeout = 8000) {
  const end = Date.now() + timeout; let value;
  do { value = await fn(); if (predicate(value)) return value; await delay(100); } while (Date.now() < end);
  assert.fail(`Timed out awaiting state: ${JSON.stringify(value)}`);
}
export async function socket(client, base = client.base) {
  const s = socketIO(base, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { csrfToken: client.csrf }, extraHeaders: { Cookie: client.cookie, Origin: 'http://localhost:5173' } });
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('Socket connect timeout')), 8000); s.once('connect', () => { clearTimeout(t); resolve(); }); s.once('connect_error', e => { clearTimeout(t); reject(e); }); });
  return s;
}
export function eventPromise(s, name, match = () => true, timeout = 6000) {
  return new Promise((resolve, reject) => { const f = data => { if (match(data)) { clearTimeout(t); s.off(name, f); resolve(data); } }; const t = setTimeout(() => { s.off(name, f); reject(new Error(`No ${name} event within ${timeout}ms`)); }, timeout); s.on(name, f); });
}
