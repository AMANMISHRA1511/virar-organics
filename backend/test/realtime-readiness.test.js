import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { subscriptionReadiness, acknowledgedPublications } from '../src/realtime-readiness.js';

function clientFixture() {
  const client = new EventEmitter(); client.status = 'ready'; client.requests = [];
  client.subscribe = channel => new Promise((resolve, reject) => client.requests.push({ channel, resolve, reject }));
  return client;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Live readiness waits for SUBSCRIBE acknowledgement even when Redis commands are ready', async () => {
  const client = clientFixture(), gate = subscriptionReadiness(client, 'test:internal-events');
  const pending = gate.enable(); assert.equal(gate.ready(), false); assert.equal(client.requests[0].channel, 'test:internal-events');
  client.requests[0].resolve(1); await pending; assert.equal(gate.ready(), true);
  client.status = 'reconnecting'; client.emit('close'); assert.equal(gate.ready(), false);
});

test('A stale subscription acknowledgement cannot mark a replacement connection ready', async () => {
  const client = clientFixture(), gate = subscriptionReadiness(client, 'test:internal-events');
  const stale = gate.enable(); client.emit('close'); client.emit('ready');
  client.requests[0].resolve(1); await stale; assert.equal(gate.ready(), false);
  client.requests[1].reject(new Error('fixture connection reset')); await tick(); assert.equal(gate.ready(), false);
  client.emit('ready'); client.requests[2].resolve(1); await tick(); assert.equal(gate.ready(), true);
  client.emit('end'); assert.equal(gate.ready(), false);
});

test('Durable hints require a complete successful PUBLISH result with at least one subscriber', () => {
  assert.equal(acknowledgedPublications([[null, 2], [null, 1]], 2), true);
  for (const results of [null, [], [[null, 0]], [[new Error('offline'), 2]], [[null, 1], [null, 0]], [[null, 1]], [[null, 'invalid'], [null, 1]]]) {
    assert.equal(acknowledgedPublications(results, 2), false);
  }
  assert.equal(acknowledgedPublications([[null, 0]], 1), false);
});
