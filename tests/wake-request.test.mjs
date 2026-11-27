import test from 'node:test';
import assert from 'node:assert/strict';
import { wakeRequest } from '../frontend/src/wake-request.js';
const deps = fetch => ({ fetch, wait: async () => {}, timeout: () => new AbortController().signal });
test('safe reads recover from a sleeping backend and proxy timeout', async () => {
  let calls = 0;
  const response = await wakeRequest('/api/products', {}, deps(async () => new Response('{}', { status: ++calls < 3 ? 504 : 200 })));
  assert.equal(response.status, 200); assert.equal(calls, 3);
});
test('checkout mutations are never repeated after a network failure or 503', async () => {
  for (const failure of ['network', 'http']) {
    let calls = 0;
    const request = () => wakeRequest('/api/checkout', { method: 'POST', body: '{}' }, deps(async () => { calls++; if (failure === 'network') throw new TypeError('Network unavailable'); return new Response('{}', { status: 503 }); }));
    if (failure === 'network') await assert.rejects(request, TypeError); else assert.equal((await request()).status, 503);
    assert.equal(calls, 1);
  }
});
test('authentication and validation failures are returned immediately', async () => {
  for (const status of [400, 401, 403, 404, 422, 429, 500]) {
    let calls = 0;
    assert.equal((await wakeRequest('/api/me', {}, deps(async () => { calls++; return new Response('{}', { status }); }))).status, status);
    assert.equal(calls, 1);
  }
});
test('safe-read retries are bounded and caller cancellation stops them', async () => {
  let calls = 0;
  assert.equal((await wakeRequest('/api/products', {}, deps(async () => { calls++; return new Response('{}', { status: 503 }); }))).status, 503);
  assert.equal(calls, 4);
  const controller = new AbortController(); calls = 0;
  await assert.rejects(() => wakeRequest('/api/products', { signal: controller.signal }, deps(async () => { calls++; controller.abort(); throw new TypeError('Interrupted'); })));
  assert.equal(calls, 1);
});
