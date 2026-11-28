import { Router } from 'express';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { randomBytes, createHmac } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { rows, transaction } from './db.js';
import { rateLimit, revokeUser } from './infra.js';
import { parse, wrap, fail, email, password } from './util.js';

export const passwordRecoveryRouter = Router();
const brevoReady = () => Boolean(
  process.env.BREVO_API_KEY &&
  process.env.BREVO_SENDER_EMAIL &&
  /^[^@ ]+@[^@ ]+[.][^@ ]+$/.test(process.env.BREVO_SENDER_EMAIL)
);
const smtpReady = () => Boolean(
  process.env.SMTP_HOST && process.env.SMTP_FROM &&
  process.env.SMTP_USER && process.env.SMTP_PASSWORD
);
export const passwordRecoveryReady = () => Boolean(
  (brevoReady() || smtpReady()) &&
  process.env.PASSWORD_RESET_PUBLIC_ORIGIN &&
  config.origins.includes(process.env.PASSWORD_RESET_PUBLIC_ORIGIN)
);
const digest = token => createHmac('sha256', config.secret).update('password-reset:' + token).digest('hex');
const publicMessage = 'If that account exists, a password reset link will be emailed to it.';
function resetOrigin() {
  const value = process.env.PASSWORD_RESET_PUBLIC_ORIGIN;
  let origin;
  try { origin = new URL(value); } catch { throw fail('Password recovery has not been configured.', 503, 'RECOVERY_UNAVAILABLE'); }
  if (origin.origin !== value || (config.production && origin.protocol !== 'https:') || !config.origins.includes(origin.origin)) {
    throw fail('Password recovery has not been configured.', 503, 'RECOVERY_UNAVAILABLE');
  }
  return origin.origin;
}
function mailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    requireTLS: process.env.SMTP_SECURE !== 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
}
async function sendRecoveryEmail({ to, subject, text: message }) {
  if (brevoReady()) {
    // Render Free blocks outgoing SMTP; Brevo HTTPS API works over port 443.
    // Never include API keys or provider error payloads in logs/responses.
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: process.env.BREVO_SENDER_EMAIL, name: 'Virar Organics' },
        to: [{ email: to }],
        subject,
        textContent: message,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Email provider rejected the message');
    return;
  }
  const transporter = mailer();
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to, subject, text: message,
    });
  } finally {
    transporter.close();
  }
}
passwordRecoveryRouter.post('/auth/password/forgot',
  rateLimit('password-forgot', 5, 3600, true), wrap(async (req, res) => {
    const { email: address } = parse(z.object({ email }), req.body);
    if (!passwordRecoveryReady()) throw fail('Password reset email is not configured yet. Contact the store administrator.', 503, 'RECOVERY_UNAVAILABLE');
    const origin = resetOrigin();
    const [user] = await rows('SELECT id,email,active FROM users WHERE email=?', [address]);
    // Identical public response for missing, disabled and existing accounts.
    if (!user || !user.active) return res.json({ message: publicMessage });
    const token = randomBytes(32).toString('base64url');
    const hash = digest(token);
    const requested = await transaction(async connection => {
      const [locked] = await rows('SELECT id,active FROM users WHERE id=? FOR UPDATE', [user.id], connection);
      if (!locked || !locked.active) return false;
      const [last] = await rows('SELECT created_at FROM password_reset_tokens WHERE user_id=? ORDER BY created_at DESC LIMIT 1', [user.id], connection);
      if (last && Date.now() - new Date(last.created_at).getTime() < 60000) return false;
      await rows('UPDATE password_reset_tokens SET consumed_at=UTC_TIMESTAMP() WHERE user_id=? AND consumed_at IS NULL', [user.id], connection);
      await rows('INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE))', [user.id, hash], connection);
      return true;
    });
    if (requested) {
      try {
        // The URL fragment prevents token transmission in ordinary HTTP request logs.
        const url = origin + '/reset-password#' + token;
        await sendRecoveryEmail({
          to: user.email,
          subject: 'Virar Organics - password reset',
          text: 'A password reset was requested for your Virar Organics account.\n\nOpen this link within 15 minutes:\n' +
            url + '\n\nIf you did not request this, ignore the message. Never share this link.',
        });
      } catch {
        await rows('UPDATE password_reset_tokens SET consumed_at=UTC_TIMESTAMP() WHERE token_hash=?', [hash]);
        // Do not reveal whether the address is registered or the provider failed.
      }
    }
    return res.json({ message: publicMessage });
  }));
passwordRecoveryRouter.post('/auth/password/reset',
  rateLimit('password-reset', 10, 3600, true), wrap(async (req, res) => {
    const { token, newPassword } = parse(z.object({
      token: z.string().min(40).max(128).regex(/^[A-Za-z0-9_-]+$/),
      newPassword: password,
    }), req.body);
    const hash = digest(token);
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const result = await transaction(async connection => {
      const [record] = await rows('SELECT user_id,consumed_at,expires_at FROM password_reset_tokens WHERE token_hash=? FOR UPDATE', [hash], connection);
      if (!record || record.consumed_at || new Date(record.expires_at).getTime() <= Date.now())
        return { ok: false };
      const [user] = await rows('SELECT id,active FROM users WHERE id=? FOR UPDATE', [record.user_id], connection);
      if (!user || !user.active) return { ok: false };
      await rows('UPDATE users SET password=?,password_login_enabled=1,session_version=session_version+1 WHERE id=?', [hashedPassword, user.id], connection);
      await rows('UPDATE password_reset_tokens SET consumed_at=UTC_TIMESTAMP() WHERE user_id=? AND consumed_at IS NULL', [user.id], connection);
      await rows("INSERT INTO audit_log(actor,action,entity_type,entity_id,detail) VALUES(?,'auth.password_reset','user',?,?)", [user.id,String(user.id),JSON.stringify({ method: 'verified-email' })], connection);
      return { ok: true, id: user.id };
    });
    if (!result.ok) throw fail('This reset link is invalid or expired. Request another.', 400, 'RESET_INVALID');
    revokeUser(result.id);
    res.json({ ok: true, message: 'Password changed. Sign in with the new password.' });
  }));
