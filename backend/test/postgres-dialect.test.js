import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { compilePostgres, safeInteger, finiteDecimal, normalizePostgresError } from '../src/postgres-dialect.js';

test('PostgreSQL placeholders never rewrite quoted data, comments or bound values', () => {
  const value = "literal ? UTC_TIMESTAMP() LIKE INSERT IGNORE '";
  const q = compilePostgres("SELECT '?' literal, 'UTC_TIMESTAMP() LIKE' text, ? value /* ? */ -- ?\n", [value]);
  assert.match(q.text, /SELECT '\?' literal, 'UTC_TIMESTAMP\(\) LIKE' text, \$1 value/);
  assert.deepEqual(q.values, [value]);
  assert.throws(() => compilePostgres('SELECT ?', []), /parameter count/);
  assert.throws(() => compilePostgres('SELECT ?', [undefined]), /undefined/);
  assert.throws(() => compilePostgres('SELECT ?; DROP TABLE users', [1]), /one SQL statement/);
});

test('PostgreSQL bytea binds preserve binary buffers and normalize only top-level flags', () => {
  const bytes = Buffer.from([0, 255, 92, 39, 63]);
  const q = compilePostgres('INSERT INTO uploads(filename,content,storage) VALUES(?,?,?)', ['test.webp', bytes, 'database']);
  assert.equal(q.values[1], bytes);
  assert.match(q.text, /VALUES\(\$1, \$2, \$3\) RETURNING id$/);
  assert.deepEqual(compilePostgres('SELECT ?, ?, ?', [true, false, '{"active":true}']).values, [1, 0, '{"active":true}']);
});

test('Duplicate-ignore returns an insert marker only for newly created durable events', () => {
  const q = compilePostgres('INSERT IGNORE INTO in_app_notifications(user_id,audience,event_key,type,title,body) VALUES(?,?,?,?,?,?)', [1, 'customer', 'key', 'order', 'Title', 'Body']);
  assert.match(q.text, /^INSERT\s+INTO in_app_notifications/);
  assert.match(q.text, /ON CONFLICT DO NOTHING RETURNING id$/);
  assert.equal(q.insertKey, 'id');
});

test('Audited upserts have explicit conflict targets and EXCLUDED values', () => {
  const settings = compilePostgres('INSERT INTO settings(id,content) VALUES(1,?) ON DUPLICATE KEY UPDATE content=VALUES(content)', ['{}']);
  assert.match(settings.text, /ON CONFLICT \(id\) DO UPDATE SET content=EXCLUDED.content RETURNING id$/);
  const cart = compilePostgres('INSERT INTO carts(user_id,items) VALUES(?,?) ON DUPLICATE KEY UPDATE items=VALUES(items)', [4, '[]']);
  assert.match(cart.text, /ON CONFLICT \(user_id\) DO UPDATE SET items=EXCLUDED.items RETURNING user_id$/);
  const upload = compilePostgres('INSERT INTO uploads(filename,size_bytes) VALUES(?,?) ON DUPLICATE KEY UPDATE size_bytes=VALUES(size_bytes)', ['x.webp', 12]);
  assert.match(upload.text, /ON CONFLICT \(filename\)/);
  assert.throws(() => compilePostgres('INSERT INTO unknown_table(id) VALUES(?)', [1]), /Unregistered/);
  assert.throws(() => compilePostgres('INSERT INTO users(email) VALUES(?) ON DUPLICATE KEY UPDATE email=VALUES(email)', ['fixture@example.test']), /Unsupported upsert/);
});

test('PostgreSQL time expressions preserve UTC expiry, cooldown and India dashboard dates', () => {
  const q = compilePostgres("SELECT TIMESTAMPDIFF(SECOND,created_at,UTC_TIMESTAMP()) age,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE) expires,DATE_FORMAT(CONVERT_TZ(created_at,'+00:00','+05:30'),'%Y-%m') month FROM phone_verifications WHERE expires_at>UTC_TIMESTAMP()-INTERVAL 1 SECOND");
  assert.match(q.text, /TRUNC\(EXTRACT\(EPOCH FROM \(\(CURRENT_TIMESTAMP\) - \(created_at\)\)\) \/ 1\)/);
  assert.match(compilePostgres('SELECT TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP()-INTERVAL 61 SECOND,UTC_TIMESTAMP()) age').text, /\(CURRENT_TIMESTAMP-INTERVAL '61 second'\)/);
  assert.match(q.text, /CURRENT_TIMESTAMP \+ INTERVAL '5 minute'/);
  assert.match(q.text, /TO_CHAR\(\(created_at AT TIME ZONE 'Asia\/Kolkata'\), 'YYYY-MM'\)/);
  assert.match(q.text, /CURRENT_TIMESTAMP-INTERVAL '1 second'/);
  assert.throws(() => compilePostgres("SELECT CONVERT_TZ(created_at,'+00:00','unknown') FROM orders"), /Unsupported timezone/);
});

test('Case-insensitive searches, JSON reference checks and order ID text casts remain valid', () => {
  const q = compilePostgres('SELECT id FROM products WHERE images LIKE ? UNION ALL SELECT id FROM settings WHERE content LIKE ? UNION ALL SELECT id FROM orders WHERE CAST(id AS CHAR) LIKE ?', ['%a%', '%b%', '%1%']);
  assert.match(q.text, /CAST\(images AS TEXT\) ILIKE \$1/);
  assert.match(q.text, /CAST\(content AS TEXT\) ILIKE \$2/);
  assert.match(q.text, /CAST\(id AS TEXT\) ILIKE \$3/);
  assert.match(compilePostgres('SELECT p.id FROM products p WHERE p.images NOT LIKE ?', ['%a%']).text, /CAST\(p.images AS TEXT\) NOT ILIKE \$1/);
  assert.match(compilePostgres('SELECT name FROM users WHERE name LIKE ?', ['%name%']).text, /name ILIKE \$1/);
});

test('Dashboard aliases retain their public JSON spelling', () => {
  const q = compilePostgres('SELECT COUNT(*) totalOrders, COUNT(*) lowStock, SUM(CASE WHEN status=? THEN 1 ELSE 0 END) ordersToday FROM orders', ['Pending']);
  for (const alias of ['totalOrders', 'lowStock', 'ordersToday']) assert.ok(q.text.includes('"' + alias + '"'));
});

test('Row locks, SKIP LOCKED and bound pagination are retained without weakening transactions', () => {
  const q = compilePostgres('SELECT * FROM realtime_events WHERE published_at IS NULL ORDER BY id LIMIT ? OFFSET ? FOR UPDATE SKIP LOCKED', [100, 0]);
  assert.match(q.text, /LIMIT \$1 OFFSET \$2 FOR UPDATE SKIP LOCKED$/);
  assert.throws(() => compilePostgres('SELECT GET_LOCK(?,?)', ['migration', 5]), /no implicit PostgreSQL substitute/);
});

test('PostgreSQL unique, deadlock and serialization errors map to existing conflict/retry handling', () => {
  for (const [state, code] of [['23505', 'ER_DUP_ENTRY'], ['40P01', 'ER_LOCK_DEADLOCK'], ['40001', 'ER_LOCK_DEADLOCK']]) {
    const error = normalizePostgresError(Object.assign(new Error('synthetic database error'), { code: state }));
    assert.equal(error.code, code); assert.equal(error.sqlState, state);
  }
});

test('Numeric normalization preserves counts and rejects unsafe integer precision', () => {
  assert.equal(safeInteger('42'), 42); assert.equal(finiteDecimal('145.20'), 145.2);
  assert.throws(() => safeInteger('9007199254740993'), /safe-integer/);
  assert.throws(() => finiteDecimal('Infinity'), /non-finite/);
});

test('Native PostgreSQL parameters cannot be mixed with MySQL placeholders', () => {
  assert.equal(compilePostgres('SELECT $1 value', [4]).text, 'SELECT $1 value');
  assert.throws(() => compilePostgres('SELECT $1, ?', [4, 5]), /mix SQL placeholder/);
});

test('PostgreSQL schema includes durable media, original uniqueness and updated-at semantics', async () => {
  const sql = await readFile(new URL('../schema-postgres.sql', import.meta.url), 'utf8');
  assert.equal((sql.match(/CREATE TABLE IF NOT EXISTS/g) || []).length, 21);
  assert.match(sql, /unique_users_email_ci ON users\(LOWER\(email\)\)/);
  assert.match(sql, /unique_categories_name_ci ON categories\(LOWER\(name\)\)/);
  assert.match(sql, /CONSTRAINT unique_checkout UNIQUE\(user_id,idempotency_key\)/);
  assert.match(sql, /CONSTRAINT unique_default_address UNIQUE\(default_owner\)/);
  assert.match(sql, /CONSTRAINT unique_in_app_event UNIQUE\(user_id,audience,event_key\)/);
  assert.match(sql, /content BYTEA/);
  assert.equal((sql.match(/CREATE OR REPLACE TRIGGER/g) || []).length, 6);
  assert.ok(!sql.includes('DROP TABLE'));
});

function configuration(extra) {
  const source = "import {config,validateDatabaseConfig} from './src/config.js';validateDatabaseConfig();console.log(JSON.stringify({client:config.dbClient,pool:config.db.connectionLimit,storage:config.uploadStorage}));";
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: new URL('../', import.meta.url), encoding: 'utf8', env: { PATH: process.env.PATH, ...extra } });
}
test('Driver selection preserves MySQL defaults and uses a four-connection PostgreSQL pool', () => {
  const mysql = configuration({}); assert.equal(mysql.status, 0, mysql.stderr);
  assert.deepEqual(JSON.parse(mysql.stdout.trim()), { client: 'mysql', pool: 12, storage: 'filesystem' });
  const postgres = configuration({ DB_CLIENT: 'postgres', DATABASE_URL: 'postgresql://TestOnlyUser@localhost/virar_test', UPLOAD_STORAGE: 'database' });
  assert.equal(postgres.status, 0, postgres.stderr);
  assert.deepEqual(JSON.parse(postgres.stdout.trim()), { client: 'postgres', pool: 4, storage: 'database' });
});
test('Invalid database driver, URL, storage and oversized PostgreSQL pool fail before connecting', () => {
  for (const env of [
    { DB_CLIENT: 'unknown' }, { DB_CLIENT: 'postgres' },
    { DB_CLIENT: 'postgres', DATABASE_URL: 'https://not-a-database.test/store' },
    { DB_CLIENT: 'postgres', DATABASE_URL: 'postgresql://TestOnlyUser@localhost/virar_test', DB_POOL_SIZE: '100' },
    { UPLOAD_STORAGE: 'temporary' },
  ]) assert.notEqual(configuration(env).status, 0);
});
