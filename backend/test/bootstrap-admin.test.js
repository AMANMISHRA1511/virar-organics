import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBootstrapAdmin } from '../src/bootstrap-admin.js';

const valid = { name: 'Store Owner', email: 'owner@example.test', password: 'TestOnlyBootstrap2026!' };

test('Admin bootstrap validates and normalizes explicit identity without accepting a role override', () => {
  const account = parseBootstrapAdmin({ ...valid, name: '  Store Owner  ', email: '  OWNER@example.test  ' });
  assert.equal(account.name, 'Store Owner');
  assert.equal(account.email, 'owner@example.test');
  assert.equal(account.password, valid.password);
  assert.throws(() => parseBootstrapAdmin({ ...valid, role: 'customer' }));
  assert.throws(() => parseBootstrapAdmin({ ...valid, email: undefined }));
  assert.throws(() => parseBootstrapAdmin({ ...valid, name: '' }));
});

test('Admin bootstrap rejects demonstration, weak, malformed and bcrypt-truncated passwords', () => {
  for (const candidate of ['DemoOnly123!', 'ChangeMe123456789!', 'onlylowercaseletters', 'Short1!', '🙂'.repeat(18) + 'Aa1!', valid.password + '\n', valid.password + '\0']) {
    assert.throws(() => parseBootstrapAdmin({ ...valid, password: candidate }), undefined, 'unsafe bootstrap input must be rejected');
  }
  assert.throws(() => parseBootstrapAdmin({ ...valid, password: undefined }));
});

test('Admin bootstrap validation messages do not expose the submitted password', () => {
  const candidate = 'ChangeMeA4!do-not-echo-this';
  try { parseBootstrapAdmin({ ...valid, password: candidate }); assert.fail('expected rejection'); }
  catch (error) { assert.equal(error.message.includes(candidate), false); }
});
