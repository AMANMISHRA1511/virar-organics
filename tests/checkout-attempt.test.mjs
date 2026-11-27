/** Deterministic checks of the browser's account-scoped checkout recovery rules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkoutFingerprint, readCheckoutAttempt, prepareCheckoutAttempt,
  markCheckoutRejected, clearCheckoutAttempt,
} from '../frontend/src/checkout-attempt.js';
const payload = () => ({ items: [{ id: 2, quantity: 1 }, { id: 1, quantity: 3 }], payment_method: 'cod', address: { name: 'Synthetic person', line1: 'Synthetic Test Lane', city: 'Virar', pincode: '401303' } });
function storage() {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}

test('Checkout fingerprints are stable across item/object order and ignore the request key', () => {
  const first = payload();
  const reordered = { address: { pincode: '401303', city: 'Virar', line1: 'Synthetic Test Lane', name: 'Synthetic person' }, payment_method: 'cod', items: [...first.items].reverse(), idempotency_key: 'independent-request-key' };
  assert.equal(checkoutFingerprint(first), checkoutFingerprint(reordered));
  assert.notEqual(checkoutFingerprint(first), checkoutFingerprint({ ...first, items: [{ id: 2, quantity: 2 }, { id: 1, quantity: 3 }] }));
});

test('Repeated clicks and a reload reuse exactly one key and retain the original payload', () => {
  const store = storage(); let created = 0;
  const factory = () => `checkout-key-${++created}`;
  const original = payload(), first = prepareCheckoutAttempt(store, 11, original, factory);
  const second = prepareCheckoutAttempt(store, 11, payload(), factory);
  const reloaded = readCheckoutAttempt(store, 11);
  const third = prepareCheckoutAttempt(store, 11, payload(), factory);
  assert.equal(created, 1); assert.equal(first.key, second.key); assert.equal(second.key, reloaded.key); assert.equal(third.key, first.key);
  original.address.line1 = 'Changed local object';
  assert.equal(first.payload.address.line1, 'Synthetic Test Lane');
});

test('Recovery attempts remain isolated by signed-in account', () => {
  const store = storage();
  const first = prepareCheckoutAttempt(store, 11, payload(), () => 'first-account-key');
  assert.equal(readCheckoutAttempt(store, 12), null);
  const second = prepareCheckoutAttempt(store, 12, payload(), () => 'second-account-key');
  assert.notEqual(first.key, second.key); assert.equal(store.data.size, 2);
  clearCheckoutAttempt(store, 12, first.key); assert.equal(readCheckoutAttempt(store, 11).key, first.key);
  assert.equal(readCheckoutAttempt(store, 12).key, second.key);
});

test('Guest or invalid account identifiers cannot write a checkout/address recovery record', () => {
  for (const userId of [null, undefined, '', 0, -1, NaN, 'guest']) {
    const store = storage(); assert.throws(() => prepareCheckoutAttempt(store, userId, payload(), () => 'guest-attempt-key'), /Sign in/i);
    assert.equal(store.data.size, 0);
  }
});

test('An unresolved attempt blocks a different address, quantity or payment method', () => {
  const store = storage(); const saved = prepareCheckoutAttempt(store, 11, payload(), () => 'unresolved-key');
  for (const next of [
    { ...payload(), payment_method: 'mock' },
    { ...payload(), items: [{ id: 1, quantity: 2 }] },
    { ...payload(), address: { ...payload().address, line1: 'A different address' } },
  ]) {
    assert.throws(() => prepareCheckoutAttempt(store, 11, next, () => 'must-not-be-used'), error => error.code === 'PENDING_CHECKOUT' && error.attempt.key === saved.key);
    assert.equal(readCheckoutAttempt(store, 11).key, saved.key);
  }
});

test('Only a matching checkout key can clear the persisted attempt', () => {
  const store = storage(); const current = prepareCheckoutAttempt(store, 11, payload(), () => 'current-order-key');
  clearCheckoutAttempt(store, 11, 'older-order-key'); assert.equal(readCheckoutAttempt(store, 11).key, current.key);
  clearCheckoutAttempt(store, 11, current.key); assert.equal(readCheckoutAttempt(store, 11), null); assert.equal(store.data.size, 0);
});

test('Rejected attempts remain reviewable until an explicit matching-key clear', () => {
  const store = storage(); const current = prepareCheckoutAttempt(store, 11, payload(), () => 'rejected-order-key');
  markCheckoutRejected(store, 11, { key: 'other-order-key' }, 'Stale failure'); assert.equal(readCheckoutAttempt(store, 11).status, 'pending');
  const rejected = markCheckoutRejected(store, 11, current, 'Only two units are available.');
  assert.equal(rejected.status, 'rejected'); assert.equal(readCheckoutAttempt(store, 11).message, 'Only two units are available.');
  assert.deepEqual(readCheckoutAttempt(store, 11).payload, payload());
  clearCheckoutAttempt(store, 11, current.key);
  const retry = prepareCheckoutAttempt(store, 11, { ...payload(), items: [{ id: 1, quantity: 2 }] }, () => 'reviewed-new-key');
  assert.equal(retry.status, 'pending'); assert.notEqual(retry.key, current.key);
});

test('Corrupt, foreign-owner or modified stored data is ignored', () => {
  const store = storage(); const current = prepareCheckoutAttempt(store, 11, payload(), () => 'integrity-test-key');
  for (const invalid of ['{', JSON.stringify({ ...current, userId: 12 }), JSON.stringify({ ...current, payload: { ...current.payload, payment_method: 'mock' } }), JSON.stringify({ ...current, key: 'x' })]) {
    store.setItem('mm-checkout:user:11', invalid); assert.equal(readCheckoutAttempt(store, 11), null);
  }
});

test('Unavailable browser storage prevents starting an untracked checkout attempt', () => {
  const blocked = { getItem: () => null, setItem: () => { throw new Error('Storage blocked'); }, removeItem: () => {} };
  assert.throws(() => prepareCheckoutAttempt(blocked, 11, payload(), () => 'storage-error-key'), /cannot save.*recovery key/i);
});
