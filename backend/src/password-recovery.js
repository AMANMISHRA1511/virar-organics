import { Router } from 'express';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { randomBytes, randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { rows, transaction } from './db.js';
import { rateLimit, revokeUser, audit, redis, redisReady } from './infra.js';
import { setSession, publicUser } from './auth.js';
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
export async function sendRecoveryEmail({ to, subject, text: message }) {
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
// Sign in existing active customer accounts by verified-email delivery.
// Redis provides bounded TTL, replay prevention and cross-instance persistence.
const otpKey = address => config.redisPrefix + ':email-otp:' + digest(address);
const publicOtpMessage = 'If an active customer account exists, a sign-in code will be emailed.';
passwordRecoveryRouter.post('/auth/email-otp/request',
  rateLimit('email-otp-request', 8, 3600), wrap(async (req,res) => {
    const { email: address } = parse(z.object({ email }),req.body);
    if (!passwordRecoveryReady()) throw fail('Email delivery is not configured.',503,'EMAIL_OTP_UNAVAILABLE');
    if (!redisReady()) throw fail('Email verification is temporarily unavailable.',503,'EMAIL_OTP_UNAVAILABLE');
    const [user] = await rows("SELECT id,email,role,active FROM users WHERE email=?", [address]);
    if (!user || !user.active || user.role !== 'customer') return res.json({message:publicOtpMessage});
    const key=otpKey(address);
    if (await redis.set(key+':cooldown','1','EX',60,'NX')!=='OK') return res.json({message:publicOtpMessage});
    const code=String(randomInt(100000,1000000)), nonce=randomBytes(16).toString('hex');
    await redis.set(key,JSON.stringify({userId:user.id,nonce,hash:digest(nonce+':'+code)}),'EX',300);
    await redis.del(key+':attempts');
    try {
      await sendRecoveryEmail({
        to:user.email, subject:'Virar Organics - email sign-in code',
        text:'Your Virar Organics sign-in code is '+code+
          '. It expires in 5 minutes. Do not share it. Ignore this email if you did not request it.'
      });
    } catch {
      await redis.del(key);
      // Hide account-existence and delivery details from the public response.
    }
    res.json({message:publicOtpMessage,expiresIn:300,retryAfter:60});
  }));
passwordRecoveryRouter.post('/auth/email-otp/verify',
  rateLimit('email-otp-verify', 24, 3600), wrap(async(req,res) => {
    const {email:address,code}=parse(z.object({
      email,code:z.string().regex(/^[0-9]{6}$/)
    }),req.body);
    if (!redisReady()) throw fail('Email verification is temporarily unavailable.',503,'EMAIL_OTP_UNAVAILABLE');
    const key=otpKey(address);
    const [raw,attempts]=await Promise.all([redis.get(key),redis.incr(key+':attempts')]);
    if(attempts===1) await redis.expire(key+':attempts',300);
    if(attempts>5){await redis.del(key);throw fail('Too many attempts. Request another code.',429,'EMAIL_OTP_ATTEMPTS');}
    if(!raw)throw fail('Invalid or expired code. Request another.',400,'EMAIL_OTP_INVALID');
    let record;try{record=JSON.parse(raw);}catch{throw fail('Invalid or expired code.',400,'EMAIL_OTP_INVALID');}
    const computed=digest(record.nonce+':'+code);
    if(typeof record.hash!=='string'||computed.length!==record.hash.length||
       !timingSafeEqual(Buffer.from(computed),Buffer.from(record.hash)))
      throw fail('Invalid or expired code. Request another.',400,'EMAIL_OTP_INVALID');
    const claimed=await redis.eval(
      "if redis.call('GET',KEYS[1])==ARGV[1] then redis.call('DEL',KEYS[1]); return 1 else return 0 end",
      1,key,raw);
    if(claimed!==1)throw fail('Code was already used.',409,'EMAIL_OTP_USED');
    const [user]=await rows("SELECT * FROM users WHERE id=? AND email=? AND role='customer' AND active=1",[record.userId,address]);
    if(!user)throw fail('Account unavailable.',401,'EMAIL_OTP_INVALID');
    await audit(user.id,'auth.email_otp_login','user',user.id);
    setSession(res,user);
    res.json(publicUser(user));
  }));
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
