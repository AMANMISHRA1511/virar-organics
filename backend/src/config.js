import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const bool = (v, fallback = false) => v === undefined ? fallback : v === 'true';
export const config = {
  port: Number(process.env.PORT || 4000), host: process.env.HOST || '127.0.0.1', production: process.env.NODE_ENV === 'production',
  secret: process.env.JWT_SECRET || '', cookieName: 'session',
  origins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4000,http://127.0.0.1:4000').split(',').map(x => x.trim()),
  db: { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'mitti', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'mitti', connectionLimit: Number(process.env.DB_POOL_SIZE || 12), connectTimeout: 10000, timezone: 'Z', decimalNumbers: true, dateStrings: ['DATE'], charset: 'utf8mb4' },
  redisPrefix: process.env.REDIS_PREFIX || 'mitti', redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379', uploads: path.resolve(root, process.env.UPLOAD_DIR || 'uploads'),
  paymentMode: process.env.PAYMENT_MODE || 'mock', razorpayId: process.env.RAZORPAY_KEY_ID || '', razorpaySecret: process.env.RAZORPAY_KEY_SECRET || '', webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '', phoneOtpMode: process.env.PHONE_OTP_MODE || 'simulated',
  notificationMode: process.env.NOTIFICATION_MODE || 'simulated', workerEmbedded: bool(process.env.EMBEDDED_WORKER, true),
  socketPingInterval: Number(process.env.SOCKET_PING_INTERVAL_MS ?? 25000), socketPingTimeout: Number(process.env.SOCKET_PING_TIMEOUT_MS ?? 20000),
  locationProvider: process.env.LOCATION_PROVIDER || 'bigdatacloud',
  mapEnabled: bool(process.env.MAP_ENABLED, true), mapTileUrl: process.env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  rateMultiplier: Number(process.env.RATE_LIMIT_MULTIPLIER || 1), trustProxy: Number(process.env.TRUST_PROXY || 0),
};
export function validateConfig() {
  if (config.secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters. Copy .env.example and run setup.');
  const mapUrl=new URL(config.mapTileUrl);if(!['https:','http:'].includes(mapUrl.protocol)||(config.production&&mapUrl.protocol!=='https:'))throw new Error('MAP_TILE_URL must use HTTPS (HTTP allowed only in local development).');
  if (!['bigdatacloud','disabled'].includes(config.locationProvider)) throw new Error('LOCATION_PROVIDER must be bigdatacloud or disabled.');
  if (!['mock', 'razorpay', 'disabled'].includes(config.paymentMode)) throw new Error('Invalid PAYMENT_MODE');
  if (!['simulated', 'twilio', 'disabled'].includes(config.phoneOtpMode)) throw new Error('Invalid PHONE_OTP_MODE');
  if(config.production && config.phoneOtpMode==='simulated') throw new Error('Simulated phone verification is forbidden in production. Use twilio or disabled.');
  if(config.phoneOtpMode==='twilio' && (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM)) throw new Error('Twilio phone OTP requires account SID, auth token and sender.');
  if(config.googleClientId && !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(config.googleClientId)) throw new Error('GOOGLE_CLIENT_ID must be a Google web client ID.');
  if (!['simulated', 'configured', 'disabled'].includes(config.notificationMode)) throw new Error('Invalid NOTIFICATION_MODE');
  if (config.production && /replace|local|demo|test|change/i.test(config.secret)) throw new Error('Replace the example JWT_SECRET before production.');
  if (config.production && config.paymentMode === 'mock') throw new Error('Mock payments are forbidden in production. Use razorpay TEST or disabled.');
  if (config.paymentMode === 'razorpay' && (!config.razorpayId.startsWith('rzp_test_') || !config.razorpaySecret || !config.webhookSecret)) throw new Error('Razorpay requires TEST credentials and webhook secret.');
  if (!Number.isInteger(config.rateMultiplier) || config.rateMultiplier < 1 || (config.production && config.rateMultiplier !== 1)) throw new Error('Rate limit multiplier is only for local tests.');
  for (const [name, value] of [['SOCKET_PING_INTERVAL_MS', config.socketPingInterval], ['SOCKET_PING_TIMEOUT_MS', config.socketPingTimeout]]) {
    if (!Number.isInteger(value) || value < 5000 || value > 60000) throw new Error(`${name} must be an integer between 5000 and 60000 milliseconds.`);
  }
}
export function paymentConfig() { return { mode: config.paymentMode, keyId: config.paymentMode === 'razorpay' ? config.razorpayId : null }; }
