import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, rows, transaction } from '../src/db.js';

// Opt in only against a disposable local database; never touch a hosted store.
const enabled = process.env.DB_CLIENT === 'postgres' && process.env.RUN_POSTGRES_TESTS === '1';
if (enabled && !/^\/[a-zA-Z][a-zA-Z0-9_]*_test$/.test(new URL(process.env.DATABASE_URL).pathname)) throw new Error('PostgreSQL integration checks require a dedicated database ending _test.');
after(() => db.end());
const options = { skip: !enabled };
const tag = randomUUID();
async function rollbackFixture(fn) {
  const marker = new Error('Rollback isolated PostgreSQL fixture.');
  try { await transaction(async c => { await fn(c); throw marker; }); }
  catch (error) { if (error !== marker) throw error; }
}
async function user(c) {
  return (await rows("INSERT INTO users(name,email,password,role) VALUES(?,?,?,'customer')", ['PostgreSQL fixture', `pg-${randomUUID()}@example.test`, 'TestOnlyUnusedPasswordHash'], c)).insertId;
}

test('Real PostgreSQL: insert IDs, numeric counts, UTC timestamps, DATE strings and bytea round-trip', options, async () => {
  await rollbackFixture(async c => {
    const userId = await user(c); assert.ok(Number.isSafeInteger(userId));
    const bytes = Buffer.from([0, 39, 92, 255, 127]);
    const upload = await rows('INSERT INTO uploads(filename,original_name,url,size_bytes,width,height,actor,storage,content,mime_type) VALUES(?,?,?,?,?,?,?,?,?,?)', [`fixture-${tag}.webp`, 'fixture.png', `/uploads/fixture-${tag}.webp`, bytes.length, 2, 3, userId, 'database', bytes, 'image/webp'], c);
    const [record] = await rows('SELECT * FROM uploads WHERE id=?', [upload.insertId], c);
    assert.equal(record.size_bytes, bytes.length); assert.deepEqual(record.content, bytes); assert.ok(record.created_at instanceof Date);
    const [flags] = await rows('SELECT active,phone_verified FROM users WHERE id=?', [userId], c); assert.deepEqual(flags, { active: 1, phone_verified: 0 });
    const [count] = await rows('SELECT COUNT(*) totalOrders FROM users WHERE id=?', [userId], c); assert.equal(count.totalOrders, 1);
    const lead = await rows("INSERT INTO leads(name,email,phone,product,quantity,message,followup) VALUES(?,?,?,?,?,?,?)", ['PG fixture', 'pg@example.test', '+919000000000', 'Rice', 1, 'Fixture', '2026-12-01'], c);
    assert.equal((await rows('SELECT followup FROM leads WHERE id=?', [lead.insertId], c))[0].followup, '2026-12-01');
  });
});

test('Real PostgreSQL: duplicate-ignore keeps transaction usable and emits exactly one insert marker', options, async () => {
  await rollbackFixture(async c => {
    const userId = await user(c);
    const sql = 'INSERT IGNORE INTO in_app_notifications(user_id,audience,event_key,type,title,body) VALUES(?,?,?,?,?,?)';
    const values = [userId, 'customer', `test-${tag}`, 'order.placed', 'Fixture', 'Fixture notice'];
    const first = await rows(sql, values, c), second = await rows(sql, values, c);
    assert.equal(first.affectedRows, 1); assert.ok(first.insertId > 0);
    assert.equal(second.affectedRows, 0); assert.equal(second.insertId, 0);
    assert.equal((await rows('SELECT COUNT(*) total FROM in_app_notifications WHERE user_id=?', [userId], c))[0].total, 1);
  });
});

test('Real PostgreSQL: JSON reference checks, upserts, case-insensitive search and updated timestamps', options, async () => {
  await rollbackFixture(async c => {
    const name = `PG Example ${tag}`;
    const product = await rows('INSERT INTO products(name,description,price,stock,images) VALUES(?,?,?,?,?)', [name, 'Fixture product', 145.2, 2, '["/uploads/fixture.webp"]'], c);
    const [before] = await rows('SELECT price,updated_at FROM products WHERE id=?', [product.insertId], c); assert.equal(before.price, 145.2);
    assert.equal((await rows('SELECT id FROM products WHERE id=? AND name LIKE ? AND images LIKE ?', [product.insertId, `%pg example%`, '%fixture.webp%'], c)).length, 1);
    await new Promise(resolve => setTimeout(resolve, 5));
    await rows('UPDATE products SET stock=stock-1 WHERE id=?', [product.insertId], c);
    const [changed] = await rows('SELECT stock,updated_at FROM products WHERE id=?', [product.insertId], c);
    assert.equal(changed.stock, 1); assert.ok(changed.updated_at > before.updated_at);
    const userId = await user(c);
    const sql = 'INSERT INTO carts(user_id,items) VALUES(?,?) ON DUPLICATE KEY UPDATE items=VALUES(items)';
    await rows(sql, [userId, '[]'], c); await rows(sql, [userId, '[{"id":1,"quantity":2}]'], c);
    assert.deepEqual((await rows('SELECT items FROM carts WHERE user_id=?', [userId], c))[0].items, [{ id: 1, quantity: 2 }]);
    const [time] = await rows("SELECT TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP()-INTERVAL 61 SECOND,UTC_TIMESTAMP()) age,DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+05:30'),'%Y-%m') month_key", [], c);
    assert.equal(time.age, 61); assert.match(time.month_key, /^\d{4}-\d{2}$/);
  });
});

test('Real PostgreSQL: case-insensitive category uniqueness maps to the existing conflict response', options, async () => {
  await rollbackFixture(async c => {
    const name = `Category ${tag}`;
    await rows('INSERT INTO categories(name,description) VALUES(?,?)', [name, 'Fixture'], c);
    await assert.rejects(rows('INSERT INTO categories(name,description) VALUES(?,?)', [name.toUpperCase(), 'Fixture'], c), error => error.code === 'ER_DUP_ENTRY');
  });
});

test('Real PostgreSQL: concurrent conditional deductions cannot consume the same stock twice', options, async () => {
  const product = await rows('INSERT INTO products(name,description,price,stock,images) VALUES(?,?,?,?,?)', [`Atomic fixture ${tag}`, 'Temporary isolated fixture', 150, 5, '[]']);
  try {
    const attempts = await Promise.all(Array.from({ length: 12 }, () => transaction(async c => {
      const [current] = await rows('SELECT stock FROM products WHERE id=? FOR UPDATE', [product.insertId], c);
      if (current.stock === 0) return 0;
      const updated = await rows('UPDATE products SET stock=stock-1 WHERE id=? AND stock>=1', [product.insertId], c);
      assert.equal(updated.affectedRows, 1); return 1;
    })));
    assert.equal(attempts.reduce((sum, n) => sum + n, 0), 5);
    assert.equal((await rows('SELECT stock FROM products WHERE id=?', [product.insertId]))[0].stock, 0);
  } finally { await rows('DELETE FROM products WHERE id=?', [product.insertId]); }
});
