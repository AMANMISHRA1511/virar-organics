import bcrypt from 'bcryptjs';
import { rows, transaction } from './db.js';
import { parse, email, password, fail } from './util.js';
import { z } from 'zod';

// Deployment-only emergency recovery. No HTTP endpoint. Credentials must
// arrive exclusively through the hosting provider's protected environment.
export async function resetExistingAdminOnce({ accountEmail, newPassword }) {
  const input = parse(z.object({
    accountEmail: email,
    newPassword: password
  }).strict(), { accountEmail, newPassword });
  const hash = await bcrypt.hash(input.newPassword, 12);
  return transaction(async connection => {
    const [user] = await rows(
      "SELECT id,role,active FROM users WHERE email=? FOR UPDATE",
      [input.accountEmail], connection
    );
    if (!user || user.role !== 'admin' || !user.active) {
      throw fail('The designated active Admin does not exist.', 409, 'ADMIN_RESET_DENIED');
    }
    await rows(
      'UPDATE users SET password=?,password_login_enabled=1,session_version=session_version+1 WHERE id=?',
      [hash, user.id], connection
    );
    await rows(
      "INSERT INTO audit_log(actor,action,entity_type,entity_id,detail) VALUES(?,'admin.password_recovered','user',?,?)",
      [user.id, String(user.id), JSON.stringify({ method: 'protected-deployment' })],
      connection
    );
    return { id: user.id };
  });
}
