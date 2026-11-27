/** Requires a migrated, EMPTY disposable *_test database. No real providers. */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const requireBackend = createRequire(path.join(backend, 'package.json'));
const mysql = requireBackend('mysql2/promise');
const bcrypt = requireBackend('bcryptjs');
const database = process.env.TEST_DATABASE || process.env.DB_NAME || '';
if (!/^[a-zA-Z][a-zA-Z0-9_]*_test$/.test(database)) throw Error('A disposable *_test database is required.');
const pool = process.env.DB_CLIENT === 'postgres' ? (await import('../backend/src/db.js')).db : mysql.createPool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3308), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD ?? '', database, connectionLimit: 6 });
const sql = async (query, args = []) => (await pool.execute(query, args))[0];
const tag = randomUUID().slice(0, 8), password = 'R8!' + randomBytes(24).toString('base64url');
const baseEnv = { ...process.env, NODE_ENV: 'production', DB_NAME: database, JWT_SECRET: randomBytes(48).toString('hex'), PAYMENT_MODE: 'disabled', PHONE_OTP_MODE: 'disabled', NOTIFICATION_MODE: 'disabled', GOOGLE_CLIENT_ID: '', RATE_LIMIT_MULTIPLIER: '1', EMBEDDED_WORKER: 'false', HOST: '127.0.0.1', REDIS_PREFIX: 'virar-deploy-test-' + tag, ALLOWED_ORIGINS: 'https://store.example.test', LOCATION_PROVIDER: 'disabled', MAP_ENABLED: 'false' };
delete baseEnv.BOOTSTRAP_ADMIN_EMAIL; delete baseEnv.BOOTSTRAP_ADMIN_NAME; delete baseEnv.BOOTSTRAP_ADMIN_PASSWORD;
const evidence = { database, externalProvidersUsed: false, hostedNetlifyTest: false, tests: [], polling: {} };
let firstAdminId, customerId, child, proxy;

async function bootstrap({ email = `owner-${tag}@example.test`, name = 'Bootstrap Test Owner', secret = password, stdin = false, overrides = {} } = {}) {
  const env = { ...baseEnv, BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_NAME: name, ...overrides };
  if (!stdin && secret !== undefined) env.BOOTSTRAP_ADMIN_PASSWORD = secret;
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['scripts/bootstrap-admin.mjs', ...(stdin ? ['--password-stdin'] : [])], { cwd: backend, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; const timeout = setTimeout(() => c.kill('SIGKILL'), 20000);
    c.stdout.on('data', d => { output += d; }); c.stderr.on('data', d => { output += d; });
    c.once('error', reject); c.once('exit', code => { clearTimeout(timeout); resolve({ code, output }); });
    c.stdin.end(stdin ? secret + '\n' : undefined);
  });
}
async function counts() {
  const [[users], [audit], [products], [orders], [leads], [notices]] = await Promise.all([
    sql('SELECT COUNT(*) total FROM users'), sql('SELECT COUNT(*) total FROM audit_log'),
    sql('SELECT COUNT(*) total FROM products'), sql('SELECT COUNT(*) total FROM orders'),
    sql('SELECT COUNT(*) total FROM leads'), sql('SELECT COUNT(*) total FROM notifications'),
  ]);
  return { users: Number(users.total), audit: Number(audit.total), products: Number(products.total), orders: Number(orders.total), leads: Number(leads.total), notifications: Number(notices.total) };
}
async function stopApi() {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  child = undefined;
}
async function startApi(interval, timeout, { command = 'server.js', extraEnv = {} } = {}) {
  const port = Number(process.env.DEPLOY_TEST_API_PORT || 4140);
  const env = { ...baseEnv, PORT: String(port), SOCKET_PING_INTERVAL_MS: String(interval), SOCKET_PING_TIMEOUT_MS: String(timeout), ...extraEnv };
  child = spawn(process.execPath, [command], { cwd: backend, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw Error('Fixture API exited: ' + output);
    try { const response = await fetch(`http://127.0.0.1:${port}/api/ready`, { signal: AbortSignal.timeout(1000) }); if (response.ok) return port; } catch {}
    await delay(100);
  }
  throw Error('Fixture API did not become ready.');
}
async function handshake(base) {
  const response = await fetch(base + '/socket.io/?EIO=4&transport=polling', { signal: AbortSignal.timeout(5000), headers: { Origin: 'https://store.example.test' } });
  assert.equal(response.status, 200);
  const payload = await response.text(); assert.equal(payload[0], '0'); return JSON.parse(payload.slice(1));
}

before(async () => {
  assert.equal((await sql('SELECT version FROM schema_migrations WHERE version=6')).length, 1, 'migrate first');
  assert.deepEqual(await counts(), { users: 0, audit: 0, products: 0, orders: 0, leads: 0, notifications: 0 }, 'This suite requires an empty isolated database, not seeded store data.');
});
after(async () => {
  if (proxy) await new Promise(resolve => proxy.close(resolve));
  await stopApi(); await pool.end();
  await fs.writeFile(path.join(root, 'tests/results/backend-deployment-results.json'), JSON.stringify({ ...evidence, completedAt: new Date().toISOString() }, null, 2));
});

test('First-Admin CLI refuses weak input and development mode without creating records', async () => {
  for (const input of [{ secret: 'DemoOnly123!' }, { name: '' }, { email: 'not-an-email' }, { overrides: { NODE_ENV: 'development' } }]) {
    const result = await bootstrap(input); assert.equal(result.code, 1); assert.equal(result.output.includes(password), false);
  }
  assert.deepEqual(await counts(), { users: 0, audit: 0, products: 0, orders: 0, leads: 0, notifications: 0 });
  evidence.tests.push('weak/malformed input and development mode refused without writes');
});

test('First-Admin CLI cannot promote an existing customer email', async () => {
  const email = `customer-${tag}@example.test`, hash = await bcrypt.hash(password, 12);
  const created = await sql("INSERT INTO users(name,email,password,role) VALUES('Fixture Customer',?,?,'customer')", [email, hash]); customerId = created.insertId;
  const result = await bootstrap({ email }); assert.equal(result.code, 1); assert.match(result.output, /EMAIL_EXISTS/); assert.equal(result.output.includes(password), false);
  const [saved] = await sql('SELECT role,password,session_version FROM users WHERE id=?', [customerId]);
  assert.equal(saved.role, 'customer'); assert.equal(saved.password, hash); assert.equal(saved.session_version, 1);
  assert.equal((await sql('SELECT id FROM audit_log')).length, 0);
  evidence.tests.push('existing customer collision refused without role/password changes');
});

test('Protected stdin bootstrap stores a bcrypt Admin and audit atomically with no demo data or secret output', async () => {
  const result = await bootstrap({ stdin: true }); assert.equal(result.code, 0, result.output); assert.equal(result.output.includes(password), false);
  const [admin] = await sql("SELECT * FROM users WHERE role='admin'"); firstAdminId = admin.id;
  assert.match(admin.password, /^\$2[aby]\$12\$/); assert.equal(await bcrypt.compare(password, admin.password), true);
  const [audit] = await sql("SELECT * FROM audit_log WHERE action='admin.bootstrap'"); assert.equal(audit.actor, admin.id); assert.equal(audit.entity_id, String(admin.id));
  assert.equal(JSON.stringify(audit).includes(password), false); assert.equal(JSON.stringify(audit).includes(admin.password), false);
  assert.deepEqual(await counts(), { users: 2, audit: 1, products: 0, orders: 0, leads: 0, notifications: 0 });
  evidence.tests.push('stdin creates one bcrypt Admin plus audit only; no secret in logs/audit');
});

test('Existing active or disabled Admin prevents repeated bootstrap and password reset', async () => {
  const [before] = await sql('SELECT password,session_version FROM users WHERE id=?', [firstAdminId]);
  for (const active of [1, 0]) {
    await sql('UPDATE users SET active=? WHERE id=?', [active, firstAdminId]);
    const result = await bootstrap({ email: `other-${active}-${tag}@example.test` }); assert.equal(result.code, 1); assert.match(result.output, /ADMIN_EXISTS/);
  }
  const [after] = await sql('SELECT password,session_version FROM users WHERE id=?', [firstAdminId]); assert.deepEqual(after, before);
  assert.deepEqual(await counts(), { users: 2, audit: 1, products: 0, orders: 0, leads: 0, notifications: 0 });
  evidence.tests.push('active and inactive Admin both block rerun; existing password unchanged');
});

test('Concurrent first-Admin CLI attempts create exactly one Admin and one audit', async () => {
  // Remove only this suite's previous bootstrap fixture in this empty disposable DB.
  await sql("DELETE FROM audit_log WHERE actor=? AND action='admin.bootstrap'", [firstAdminId]);
  await sql('DELETE FROM users WHERE id=?', [firstAdminId]);
  const outcomes = await Promise.all(Array.from({ length: 4 }, (_, index) => bootstrap({ email: `race-${index}-${tag}@example.test` })));
  assert.equal(outcomes.filter(result => result.code === 0).length, 1);
  assert.equal(outcomes.filter(result => result.code === 1 && result.output.includes('ADMIN_EXISTS')).length, 3);
  for (const result of outcomes) assert.equal(result.output.includes(password), false);
  assert.equal((await sql("SELECT id FROM users WHERE role='admin'")).length, 1);
  assert.equal((await sql("SELECT id FROM audit_log WHERE action='admin.bootstrap'")).length, 1);
  assert.equal((await sql('SELECT role FROM users WHERE id=?', [customerId]))[0].role, 'customer');
  assert.deepEqual(await counts(), { users: 2, audit: 1, products: 0, orders: 0, leads: 0, notifications: 0 });
  evidence.tests.push('four simultaneous CLI invocations yield one committed Admin/audit');
});

test('Actual API polling handshake preserves native heartbeat values', async () => {
  const port = await startApi(25000, 20000); const info = await handshake(`http://127.0.0.1:${port}`);
  assert.equal(info.pingInterval, 25000); assert.equal(info.pingTimeout, 20000);
  evidence.polling.native = { pingInterval: info.pingInterval, pingTimeout: info.pingTimeout };
  await stopApi();
});

test('Actual API polling survives two heartbeat cycles through a local 26-second proxy fixture', { timeout: 45000 }, async () => {
  const port = await startApi(10000, 10000); let proxyTimeouts = 0;
  proxy = createServer((req, res) => {
    const upstream = request({ hostname: '127.0.0.1', port, method: req.method, path: req.url, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    const timer = setTimeout(() => { proxyTimeouts++; upstream.destroy(); if (!res.headersSent) res.writeHead(504); res.end('fixture proxy timeout'); }, 26000);
    res.once('close', () => { clearTimeout(timer); upstream.destroy(); });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${proxy.address().port}`, info = await handshake(base);
  assert.equal(info.pingInterval, 10000); assert.equal(info.pingTimeout, 10000);
  const url = base + '/socket.io/?EIO=4&transport=polling&sid=' + encodeURIComponent(info.sid);
  const post = async body => { const response = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=UTF-8', Origin: 'https://store.example.test' }, signal: AbortSignal.timeout(25000) }); assert.equal(response.status, 200); await response.text(); };
  await post('40');
  const connected = await fetch(url, { signal: AbortSignal.timeout(25000) }); assert.equal(connected.status, 200); assert.match(await connected.text(), /^40/);
  const durations = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    const started = Date.now(), response = await fetch(url, { signal: AbortSignal.timeout(25000) }); assert.equal(response.status, 200);
    assert.equal(await response.text(), '2'); durations.push(Date.now() - started); await post('3');
  }
  assert.equal(proxyTimeouts, 0); assert.ok(durations.every(ms => ms < 25000));
  await post('1');
  evidence.polling.proxyFixture = { pingInterval: info.pingInterval, pingTimeout: info.pingTimeout, proxyLimitMs: 26000, heartbeatDurationsMs: durations, proxyTimeouts, passed: true };
  await new Promise(resolve => proxy.close(resolve)); proxy = undefined; await stopApi();
});


test('Concurrent first catalogue imports create only zero-stock content and persistent images', { timeout: 60000 }, async () => {
  const before = await counts();
  const runImport = () => new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, ['scripts/import-catalogue.mjs'], { cwd: backend, env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; process.stdout.on('data', bytes => output += bytes); process.stderr.on('data', bytes => output += bytes);
    process.once('error', reject); process.once('exit', code => resolve({ code, output }));
  });
  const results = await Promise.all([runImport(), runImport()]);
  for (const result of results) assert.equal(result.code, 0, result.output);
  assert.equal(results.filter(result => result.output.includes('"imported":true')).length, 1);
  assert.equal(Number((await sql('SELECT COUNT(*) total FROM products'))[0].total), 72);
  assert.equal(Number((await sql('SELECT COUNT(*) total FROM categories'))[0].total), 12);
  assert.equal(Number((await sql('SELECT COUNT(*) total FROM products WHERE stock<>0'))[0].total), 0);
  const after = await counts();
  for (const field of ['users', 'orders', 'leads', 'notifications']) assert.equal(after[field], before[field]);
  const uploads = await sql('SELECT storage,content,mime_type FROM uploads');
  assert.equal(uploads.length, 20);
  if (process.env.UPLOAD_STORAGE === 'database') for (const upload of uploads) { assert.equal(upload.storage, 'database'); assert.ok(Buffer.isBuffer(upload.content)); assert.equal(upload.mime_type, 'image/webp'); }
  const [first] = await sql('SELECT id FROM products ORDER BY id LIMIT 1');
  await sql('UPDATE products SET stock=3,price=123.45,sale_price=NULL WHERE id=?', [first.id]);
  assert.equal((await runImport()).code, 0);
  const [saved] = await sql('SELECT stock,price FROM products WHERE id=?', [first.id]);
  assert.equal(Number(saved.stock), 3); assert.equal(Number(saved.price), 123.45);
  evidence.tests.push('concurrent catalogue import: exactly72 products/12 categories/20 images, stock0, no accounts/orders/leads/messages, rerun preserves edits');
});

test('Free startup reruns migrations safely, preserves existing Admin and serves persisted images', { timeout: 60000 }, async () => {
  const [admin] = await sql("SELECT id,password FROM users WHERE role='admin'");
  const [upload] = await sql('SELECT url,content FROM uploads ORDER BY id LIMIT 1');
  const port = await startApi(10000, 10000, { command: 'scripts/start-free.mjs', extraEnv: {
    IMPORT_BUNDLED_CATALOGUE: 'true', BOOTSTRAP_ADMIN_ON_START: 'true',
    BOOTSTRAP_ADMIN_NAME: 'Existing Admin Protection', BOOTSTRAP_ADMIN_EMAIL: `never-created-${tag}@example.test`, BOOTSTRAP_ADMIN_PASSWORD: password,
  } });
  const [saved] = await sql('SELECT password FROM users WHERE id=?', [admin.id]); assert.equal(saved.password, admin.password);
  assert.equal((await sql("SELECT id FROM users WHERE email=?", [`never-created-${tag}@example.test`])).length, 0);
  const response = await fetch(`http://127.0.0.1:${port}${upload.url}`);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /image\/webp/);
  const bytes = Buffer.from(await response.arrayBuffer()); if (Buffer.isBuffer(upload.content)) assert.deepEqual(bytes, upload.content);
  assert.ok(bytes.length > 100); await stopApi();
  evidence.tests.push('free startup safely migrates, skips existing catalogue/Admin, preserves account password and serves stored image bytes');
});
