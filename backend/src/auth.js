import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { rows, transaction } from './db.js';
import { parse, fail, wrap, text, email, phone, password } from './util.js';
import { audit, rateLimit, revokeSession, revokeUser, customerChanged, flushRealtime } from './infra.js';
const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/' };
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const signCsrf = token => createHmac('sha256', config.secret).update(token).digest('hex');
export function validCsrf(cookie, header) { if (!safeEqual(cookie, header)) return false; const [token, signature] = String(cookie).split('.'); return token?.length === 64 && safeEqual(signCsrf(token), signature); }
export function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers.origin && !config.origins.includes(req.headers.origin)) return next(fail('Origin denied', 403));
  if (!validCsrf(req.cookies.csrf, req.get('X-CSRF-Token'))) return next(fail('Security token expired. Refresh and try again.', 403, 'CSRF'));
  next();
}
export const publicUser = u => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, google_linked: Boolean(u.google_sub || u.google_linked), password_login_enabled: u.password_login_enabled === undefined ? true : Boolean(u.password_login_enabled), has_password: u.password_login_enabled === undefined ? true : Boolean(u.password_login_enabled), phone_verified: Boolean(u.phone_verified), phone_verification_method: u.phone_verification_method || null, phone_verified_at: u.phone_verified_at || null });
export async function verifySession(token) {
  let payload; try { payload = jwt.verify(token, config.secret, { algorithms: ['HS256'], issuer: 'mitti-meadow', audience: 'mitti-web' }); } catch { throw fail('Please sign in.', 401); }
  const [user] = await rows('SELECT id,name,email,phone,role,active,session_version,google_sub,password_login_enabled,phone_verified,phone_verification_method,phone_verified_at FROM users WHERE id=?', [payload.id]);
  if (!user || !user.active || user.session_version !== payload.sv) throw fail('Session expired. Please sign in again.', 401);
  return { ...publicUser(user), jti: payload.jti, exp: payload.exp };
}
export const auth = (...roles) => wrap(async (req, res, next) => { req.user = await verifySession(req.cookies.session); if (roles.length && !roles.includes(req.user.role)) throw fail('You do not have access to this section.', 403); next(); });
export const admin = auth('admin');
export const staff = auth('admin', 'sales');
export function setSession(res, user) { const token = jwt.sign({ id: user.id, sv: user.session_version }, config.secret, { expiresIn: '8h', jwtid: randomUUID(), issuer: 'mitti-meadow', audience: 'mitti-web' }); res.cookie('session', token, { ...cookieOptions, maxAge: 8 * 3600000 }); }
export const authRouter = Router();
authRouter.get('/csrf', (req, res) => { let token = req.cookies.csrf; if (!validCsrf(token, token)) { const nonce = randomBytes(32).toString('hex'); token = nonce + '.' + signCsrf(nonce); res.cookie('csrf', token, { ...cookieOptions, maxAge: 24 * 3600000 }); } res.set('Cache-Control', 'no-store').json({ csrfToken: token }); });
authRouter.post('/register', rateLimit('register', 10, 3600), wrap(async (req, res) => {
  const input = parse(z.object({ name: text(100, 2), email, phone: phone.or(z.literal('')).optional().default(''), password }), req.body);
  const hash = await bcrypt.hash(input.password, 12);
  const result = await transaction(async c=>{const result=await rows("INSERT INTO users(name,email,phone,password,role) VALUES(?,?,?,?,'customer')", [input.name, input.email, input.phone, hash],c);await customerChanged(c,result.insertId);return result;});await flushRealtime();
  const [user] = await rows('SELECT * FROM users WHERE id=?', [result.insertId]); setSession(res, user); res.status(201).json(publicUser(user));
}));
authRouter.post('/login', rateLimit('login', 12, 900), wrap(async (req, res) => {
  const input = parse(z.object({ email, password: z.string().max(200) }), req.body); const [user] = await rows('SELECT * FROM users WHERE email=?', [input.email]);
  const ok = await bcrypt.compare(input.password, user?.password || '$2b$12$1S3oH/3Cgbcq8j31mZVxw.5r3XyC.RqSB7kR8jG8rAYna.QE4Tg1y');
  if (!user || !user.active || !user.password_login_enabled || !ok) throw fail('Email or password is incorrect.', 401);
  await audit(user.id, 'auth.login', 'user', user.id); setSession(res, user); res.json(publicUser(user));
}));
authRouter.get('/me', auth(), (req, res) => res.json(publicUser(req.user)));
authRouter.post('/logout', wrap(async (req, res) => { try { const user = await verifySession(req.cookies.session); await rows('UPDATE users SET session_version=session_version+1 WHERE id=?', [user.id]); revokeUser(user.id); } catch { /* idempotent logout */ } res.clearCookie('session', cookieOptions).json({ ok: true }); }));
authRouter.get('/account', auth('customer'), (req, res) => res.json(publicUser(req.user)));
authRouter.patch('/account', auth('customer'), wrap(async (req, res) => { const input = parse(z.object({ name: text(100, 2), phone }), req.body); await transaction(async c=>{const [existing]=await rows('SELECT * FROM users WHERE id=? FOR UPDATE',[req.user.id],c);const changed=existing.phone!==input.phone;if(changed){await rows('UPDATE users SET name=?,phone=?,phone_verified=0,phone_verification_method=NULL,phone_verified_at=NULL WHERE id=?',[input.name,input.phone,req.user.id],c);await rows('UPDATE phone_verifications SET consumed_at=UTC_TIMESTAMP() WHERE user_id=? AND consumed_at IS NULL',[req.user.id],c);}else await rows('UPDATE users SET name=? WHERE id=?',[input.name,req.user.id],c);await customerChanged(c,req.user.id);});await flushRealtime();res.json(publicUser((await rows('SELECT * FROM users WHERE id=?',[req.user.id]))[0])); }));
authRouter.patch('/account/password', auth(), rateLimit('password', 6, 3600, true), wrap(async (req, res) => {
  const input = parse(z.object({ currentPassword: z.string().max(200), newPassword: password }), req.body); const [user] = await rows('SELECT * FROM users WHERE id=?', [req.user.id]);
  if (!await bcrypt.compare(input.currentPassword, user.password)) throw fail('Current password is incorrect.', 400);
  await rows('UPDATE users SET password=?,session_version=session_version+1 WHERE id=?', [await bcrypt.hash(input.newPassword, 12), user.id]); revokeUser(user.id); res.clearCookie('session', cookieOptions).json({ ok: true, message: 'Password changed. Sign in again.' });
}));
authRouter.get('/admin/staff', admin, wrap(async (req, res) => res.json(await rows("SELECT id,name,email,phone,role,active,created_at FROM users WHERE role IN ('admin','sales') ORDER BY id"))));
authRouter.post('/admin/staff', admin, wrap(async (req, res) => {
  const input = parse(z.object({ name: text(100, 2), email, phone: phone.or(z.literal('')).optional().default(''), password, role: z.enum(['admin', 'sales']) }), req.body);
  const r = await transaction(async c => { const r = await rows('INSERT INTO users(name,email,phone,password,role) VALUES(?,?,?,?,?)', [input.name, input.email, input.phone, await bcrypt.hash(input.password, 12), input.role], c); await audit(req.user.id, 'staff.created', 'user', r.insertId, { role: input.role }, c); return r; }); res.status(201).json({ id: r.insertId });
}));
authRouter.patch('/admin/staff/:id', admin, wrap(async (req, res) => {
  const userId = parse(z.coerce.number().int().positive(), req.params.id); const input = parse(z.object({ name: text(100, 2).optional(), phone: phone.or(z.literal('')).optional(), role: z.enum(['admin','sales']).optional(), active: z.boolean().optional() }), req.body);
  await transaction(async c => {
    // Serialize every active-admin mutation in deterministic order, preventing concurrent last-admin removal.
    const admins = await rows("SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id FOR UPDATE", [], c);
    const [u] = await rows("SELECT * FROM users WHERE id=? AND role IN ('admin','sales') FOR UPDATE", [userId], c); if (!u) throw fail('Staff member not found.', 404);
    const role = input.role ?? u.role, active = input.active ?? Boolean(u.active);
    if (u.role === 'admin' && u.active && (role !== 'admin' || !active) && admins.length <= 1) throw fail('At least one active Admin must remain.', 409);
    await rows('UPDATE users SET name=?,phone=?,role=?,active=?,session_version=session_version+1 WHERE id=?', [input.name ?? u.name, input.phone ?? u.phone, role, active, userId], c); await audit(req.user.id, 'staff.updated', 'user', userId, { role, active }, c);
  }); revokeUser(userId); res.json({ ok: true });
}));
authRouter.post('/admin/staff/:id/password', admin, wrap(async (req, res) => { const userId = parse(z.coerce.number().int().positive(), req.params.id); const input = parse(z.object({ password }), req.body); const [u] = await rows("SELECT id FROM users WHERE id=? AND role IN ('admin','sales')", [userId]); if (!u) throw fail('Staff member not found.', 404); await transaction(async c => { await rows('UPDATE users SET password=?,session_version=session_version+1 WHERE id=?', [await bcrypt.hash(input.password, 12), userId], c); await audit(req.user.id, 'staff.password_reset', 'user', userId, {}, c); }); revokeUser(userId); res.json({ ok: true }); }));
