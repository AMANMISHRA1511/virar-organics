import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { rows, transaction } from './db.js';
import { email, password, text, parse, fail } from './util.js';

const bootstrapPassword = password.min(16)
  .refine(value => !/[\r\n\0]/.test(value), 'Password cannot contain line breaks or NUL characters.')
  .refine(value => [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(pattern => pattern.test(value)).length >= 3,
    'Use at least three of lowercase, uppercase, numbers and symbols.')
  .refine(value => !/demoonly|replace[-_ ]?me|change[-_ ]?me|password123/i.test(value), 'Choose a unique password, not a demonstration or replacement password.');

export function parseBootstrapAdmin(input) {
  return parse(z.object({ name: text(100, 2), email, password: bootstrapPassword }).strict(), input);
}

// This service has no HTTP route. It is called only by the explicit deployment CLI or opted-in protected startup.
export async function createFirstAdmin(input) {
  const account = parseBootstrapAdmin(input);
  const hashed = await bcrypt.hash(account.password, 12);
  return transaction(async connection => {
    // Every bootstrap process locks the same existing row before inspecting users.
    // The lock serializes an empty database too, without requiring a new schema.
    const [migration] = await rows('SELECT version FROM schema_migrations WHERE version=6 FOR UPDATE', [], connection);
    if (!migration) throw fail('Schema v6 is required. Run migrations before bootstrapping.', 409, 'BOOTSTRAP_MIGRATION');
    const [existing] = await rows("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1 FOR UPDATE", [], connection);
    if (existing) throw fail('An Admin account already exists. Use the existing Admin and Team & access.', 409, 'ADMIN_EXISTS');
    const [collision] = await rows('SELECT id FROM users WHERE email=? FOR UPDATE', [account.email], connection);
    if (collision) throw fail('This email belongs to an existing account. Bootstrap never changes its role.', 409, 'EMAIL_EXISTS');
    const result = await rows("INSERT INTO users(name,email,password,role) VALUES(?,?,?,'admin')", [account.name, account.email, hashed], connection);
    await rows("INSERT INTO audit_log(actor,action,entity_type,entity_id,detail) VALUES(?,'admin.bootstrap','user',?,?)", [result.insertId, String(result.insertId), JSON.stringify({ method: 'deployment-cli' })], connection);
    return { id: result.insertId, email: account.email, role: 'admin' };
  });
}
