import test from 'node:test';
import assert from 'node:assert/strict';
import { config, validateConfig } from '../src/config.js';

function validLocalConfig(t) {
  const previous = { ...config };
  t.after(() => Object.assign(config, previous));
  Object.assign(config, {
    secret: 'b'.repeat(64), production: false, paymentMode: 'disabled',
    phoneOtpMode: 'disabled', notificationMode: 'disabled', googleClientId: '',
    locationProvider: 'disabled', rateMultiplier: 1,
    mapTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    socketPingInterval: 25000, socketPingTimeout: 20000,
  });
}

test('Socket heartbeat accepts ordinary defaults and a bounded proxy deployment configuration', t => {
  validLocalConfig(t);
  assert.doesNotThrow(validateConfig);
  config.socketPingInterval = 10000;
  config.socketPingTimeout = 10000;
  assert.doesNotThrow(validateConfig);
  assert.ok(config.socketPingInterval + config.socketPingTimeout < 26000);
});

test('Socket heartbeat rejects invalid intervals or timeouts before the server starts', t => {
  validLocalConfig(t);
  for (const [key, name] of [['socketPingInterval', 'SOCKET_PING_INTERVAL_MS'], ['socketPingTimeout', 'SOCKET_PING_TIMEOUT_MS']]) {
    for (const value of [NaN, Infinity, -1, 0, 4999, 10000.5, 60001]) {
      config[key] = value;
      assert.throws(validateConfig, new RegExp(name));
    }
    config[key] = 10000;
  }
});
