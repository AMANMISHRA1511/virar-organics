/** Execute the real location request helper with deterministic device/fetch mocks.
 * No test in this file calls a device or an external network service.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestCurrentLocation } from '../frontend/src/location.js';
const provider = { locality: 'Synthetic Area', city: 'Virar', principalSubdivision: 'Maharashtra', postcode: '401303', countryCode: 'IN', countryName: 'India' };
const position = () => ({ coords: { latitude: 19.4559, longitude: 72.8114, accuracy: 20 }, timestamp: Date.now() });
const successGeo = value => ({ getCurrentPosition: success => success(value ?? position()) });
const response = (data = provider) => ({ ok: true, json: async () => data });

test('Granted current-location request uses fresh device options and a minimal credential-free lookup', async () => {
  let deviceOptions, requested, requestOptions, calls = 0; const phases = [];
  const geolocation = { getCurrentPosition(success, _error, options) { deviceOptions = options; success(position()); } };
  const found = await requestCurrentLocation({ geolocation, onPhase: phase => phases.push(phase), fetchImpl: async (url, options) => { calls++; requested = new URL(url); requestOptions = options; return response(); } });
  assert.deepEqual(deviceOptions, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  assert.equal(calls, 1); assert.equal(requested.origin, 'https://api.bigdatacloud.net'); assert.equal(requested.pathname, '/data/reverse-geocode-client');
  assert.deepEqual([...requested.searchParams.keys()].sort(), ['latitude', 'localityLanguage', 'longitude']);
  assert.equal(requested.searchParams.get('latitude'), '19.4559'); assert.equal(requested.searchParams.get('longitude'), '72.8114');
  assert.equal(requestOptions.credentials, 'omit'); assert.equal(requestOptions.referrerPolicy, 'no-referrer'); assert.ok(requestOptions.signal instanceof AbortSignal);
  assert.deepEqual(phases, ['permission', 'lookup']); assert.equal(found.pincode, '401303'); assert.equal(found.accuracy, 20);
});

test('Permission denial, unavailable location and device timeout make zero provider requests', async () => {
  for (const [code, message] of [[1, /permission was denied/i], [2, /could not be determined/i], [3, /could not find.*in time/i]]) {
    let calls = 0;
    await assert.rejects(requestCurrentLocation({ geolocation: { getCurrentPosition(_success, error) { error({ code }); } }, fetchImpl: async () => { calls++; return response(); } }), message);
    assert.equal(calls, 0, `geolocation error ${code}`);
  }
});

test('A browser without geolocation keeps the manual path and performs no lookup', async () => {
  let calls = 0;
  await assert.rejects(requestCurrentLocation({ geolocation: undefined, fetchImpl: async () => { calls++; return response(); } }), /browser cannot share.*manually/i);
  assert.equal(calls, 0);
});

test('Missing, invalid or older device coordinates are rejected before any provider request', async () => {
  for (const value of [{}, { coords: { latitude: null, longitude: null } }, { coords: { latitude: 91, longitude: 72 } }, { ...position(), timestamp: Date.now() - 61000 }]) {
    let calls = 0;
    await assert.rejects(requestCurrentLocation({ geolocation: successGeo(value), fetchImpl: async () => { calls++; return response(); } }), /valid coordinates|older location/i);
    assert.equal(calls, 0);
  }
});

test('An already cancelled request neither asks for device location nor fetches', async () => {
  const controller = new AbortController(); controller.abort(); let geoCalls = 0, fetchCalls = 0;
  await assert.rejects(requestCurrentLocation({ signal: controller.signal, geolocation: { getCurrentPosition() { geoCalls++; } }, fetchImpl: async () => { fetchCalls++; return response(); } }), { name: 'AbortError' });
  assert.equal(geoCalls, 0); assert.equal(fetchCalls, 0);
});

test('Cancelling while permission is pending ignores a later device callback', async () => {
  let acceptLocation, calls = 0; const controller = new AbortController();
  const pending = requestCurrentLocation({ signal: controller.signal, geolocation: { getCurrentPosition(success) { acceptLocation = success; } }, fetchImpl: async () => { calls++; return response(); } });
  const rejected = assert.rejects(pending, { name: 'AbortError' }); controller.abort(); await rejected;
  acceptLocation(position()); await Promise.resolve(); assert.equal(calls, 0);
});

test('Cancelling an active lookup aborts its request and ignores its later response', async () => {
  let complete, providerSignal; const controller = new AbortController();
  const pending = requestCurrentLocation({ signal: controller.signal, geolocation: successGeo(), fetchImpl: (_url, options) => { providerSignal = options.signal; return new Promise(resolve => { complete = resolve; }); } });
  const rejected = assert.rejects(pending, { name: 'AbortError' }); controller.abort(); await rejected;
  assert.equal(providerSignal.aborted, true); complete(response()); await Promise.resolve();
});

test('HTTP errors, malformed provider data and network failure return a manual-entry error', async () => {
  for (const fetchImpl of [async () => ({ ok: false }), async () => response({ error: 'Synthetic provider failure' }), async () => { throw new Error('Synthetic network failure'); }]) {
    await assert.rejects(requestCurrentLocation({ geolocation: successGeo(), fetchImpl }), /manually|Synthetic network failure/i);
  }
});

test('A stalled provider lookup is aborted at its ten-second deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let signal;
  const pending = requestCurrentLocation({ geolocation: successGeo(), fetchImpl: (_url, options) => { signal = options.signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted fixture'), { name: 'AbortError' })), { once: true })); } });
  const rejected = assert.rejects(pending, /lookup timed out.*manually/i);
  t.mock.timers.tick(10000); await rejected; assert.equal(signal.aborted, true);
});
