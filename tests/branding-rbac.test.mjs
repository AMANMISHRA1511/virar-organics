import { before, after, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, assert, pool, sql, tag } from './helpers.mjs';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const admin = new Client(), customer = new Client(), sales = new Client(), guest = new Client();
const staffBody = label => ({ name: `Brand QA ${label}`, email: `${label}-${tag}@virar.test`, phone: '', password: 'TestOnlyBrandStaff2026!', role: 'sales' });
let originalSettings;
async function settings() {
  const [row] = await sql('SELECT content FROM settings WHERE id=1');
  return typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
}
async function fixture(content) {
  await sql('UPDATE settings SET content=? WHERE id=1', [JSON.stringify(content)]);
  await sql('DELETE FROM schema_migrations WHERE version=6');
}
async function migrate(label) {
  const result = await execute(process.execPath, ['migrate.js'], {
    cwd: path.join(root, 'backend'), env: process.env, timeout: 30000,
  });
  await fs.writeFile(path.join(root, 'tests/results', `branding-migration-${label}.txt`), result.stdout + result.stderr);
}
async function businessSnapshot() {
  const [[users], [products], [orders], [uploads]] = await Promise.all([
    sql('SELECT COUNT(*) count, SUM(session_version) versions FROM users'),
    sql('SELECT COUNT(*) count, SUM(stock) stock FROM products'),
    sql('SELECT COUNT(*) count, SUM(total) total FROM orders'),
    sql('SELECT COUNT(*) count FROM uploads'),
  ]);
  return { users, products, orders, uploads };
}

before(async () => {
  await admin.login('admin@mitti.test');
  await sales.login('sales@mitti.test');
  await customer.register(`brand-customer-${tag}@virar.test`);
  await guest.token();
  originalSettings = await settings();
});
after(async () => {
  if (originalSettings) {
    await sql('UPDATE settings SET content=? WHERE id=1', [JSON.stringify(originalSettings)]);
    await sql('INSERT IGNORE INTO schema_migrations(version) VALUES(6)');
  }
  await pool.end();
});

test('Fresh application settings expose Virar Organics and schema v6', async () => {
  const response = await guest.request('/settings');
  assert.equal(response.status, 200);
  assert.equal(response.body.storeName, 'Virar Organics');
  assert.equal((await sql('SELECT version FROM schema_migrations WHERE version=6')).length, 1);
});

test('Public signup cannot select Admin or Sales roles', async () => {
  for (const role of ['admin', 'sales']) {
    const client = new Client(); await client.token();
    const response = await client.request('/register', { method: 'POST', body: {
      name: `Public ${role} attempt`, email: `brand-public-${role}-${tag}@virar.test`,
      phone: '+919000001234', password: 'TestOnlyPublicSignup2026!', role,
    } });
    assert.equal(response.status, 201, response.text);
    assert.equal(response.body.role, 'customer');
    const [saved] = await sql('SELECT role FROM users WHERE id=?', [response.body.id]);
    assert.equal(saved.role, 'customer');
    assert.equal((await client.request('/admin/staff')).status, 403);
  }
});

for (const [label, client, status] of [['guest', guest, 401], ['customer', customer, 403], ['sales', sales, 403]]) {
  test(`${label} cannot create an employee through the staff API`, async () => {
    const body = staffBody(label);
    const response = await client.request('/admin/staff', { method: 'POST', body });
    assert.equal(response.status, status, response.text);
    assert.equal((await sql('SELECT id FROM users WHERE email=?', [body.email])).length, 0);
  });
}

test('Admin creates an employee who signs in with Sales-only access', async () => {
  const body = staffBody('admin-created');
  const response = await admin.request('/admin/staff', { method: 'POST', body });
  assert.equal(response.status, 201, response.text);
  const employee = new Client(); await employee.login(body.email, body.password);
  assert.equal(employee.user.role, 'sales');
  assert.equal((await employee.request('/admin/leads')).status, 200);
  assert.equal((await employee.request('/admin/customers')).status, 403);
  assert.equal((await employee.request('/admin/staff', { method: 'POST', body: staffBody('employee-created') })).status, 403);
});

test('Migration renames exact legacy defaults and preserves business records and custom content', async () => {
  const content = { ...originalSettings, storeName: 'Mitti & Meadow',
    footer: 'Mitti & Meadow · Rooted in goodness.', contactEmail: 'hello@mitti.test',
    contactPhone: '+919876543210', heading: 'My chosen heading',
    logo: '/uploads/custom-logo.webp', banner: '/uploads/custom-banner.webp',
    extraOperatorField: { retain: true } };
  const baseline = await businessSnapshot();
  await fixture(content); await migrate('legacy');
  const migrated = await settings();
  assert.equal(migrated.storeName, 'Virar Organics');
  assert.equal(migrated.footer, 'Virar Organics · Rooted in goodness.');
  assert.equal(migrated.contactEmail, 'hello@virarorganics.test');
  for (const key of Object.keys(content).filter(key => !['storeName', 'footer', 'contactEmail'].includes(key))) {
    assert.deepEqual(migrated[key], content[key], key);
  }
  assert.deepEqual(await businessSnapshot(), baseline);
});

test('Migration preserves a custom store name and its complete settings document', async () => {
  const content = { ...originalSettings, storeName: 'Custom Operator Store',
    footer: 'Mitti & Meadow · Rooted in goodness.', contactEmail: 'hello@mitti.test' };
  await fixture(content); await migrate('custom-name');
  assert.deepEqual(await settings(), content);
});

test('Migration preserves custom footer and email while renaming the old default name', async () => {
  const content = { ...originalSettings, storeName: 'Mitti & Meadow',
    footer: 'My custom footer', contactEmail: 'custom-owner@example.test' };
  await fixture(content); await migrate('custom-fields');
  assert.deepEqual(await settings(), { ...content, storeName: 'Virar Organics' });
});

test('Repeated migration preserves later operator choices and creates no new settings hint', async () => {
  const content = { ...originalSettings, storeName: 'Mitti & Meadow', footer: 'Later operator choice' };
  await sql('UPDATE settings SET content=? WHERE id=1', [JSON.stringify(content)]);
  const [before] = await sql("SELECT COUNT(*) count FROM realtime_events WHERE event_name='settings'");
  await migrate('repeat');
  assert.deepEqual(await settings(), content);
  const [after] = await sql("SELECT COUNT(*) count FROM realtime_events WHERE event_name='settings'");
  assert.equal(after.count, before.count);
});
