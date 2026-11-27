// Explicit one-time deployment command. Never called by start, setup or migrate.
// Defaults prevent payment/messaging adapters from being activated by this command.
process.env.NODE_ENV ??= 'production';
process.env.PAYMENT_MODE ??= 'disabled';
process.env.PHONE_OTP_MODE ??= 'disabled';
process.env.NOTIFICATION_MODE ??= 'disabled';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Create the first Admin only. Set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME and a protected BOOTSTRAP_ADMIN_PASSWORD secret, then run npm run bootstrap:admin. Alternatively pipe only the password from a protected source with npm run bootstrap:admin -- --password-stdin. Requires migrated schema v6, production configuration, a unique password of at least 16 characters and no existing Admin. Never pass the password in command arguments.');
  process.exit(0);
}

let db;
try {
  if (args.some(arg => arg !== '--password-stdin') || args.length > 1) throw new Error('Only --password-stdin is supported. Use --help for instructions.');
  const { config, validateConfig } = await import('../src/config.js');
  if (!config.production) throw new Error('Bootstrap is a controlled production setup command. Set NODE_ENV=production explicitly.');
  validateConfig();
  let secret = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (args.includes('--password-stdin')) {
    if (secret !== undefined) throw new Error('Use one password source: protected environment or --password-stdin.');
    if (process.stdin.isTTY) throw new Error('Pipe the password from a protected source; interactive plaintext input is not supported.');
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 256) throw new Error('Password input is too long.');
      chunks.push(chunk);
    }
    secret = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  const input = { name: process.env.BOOTSTRAP_ADMIN_NAME, email: process.env.BOOTSTRAP_ADMIN_EMAIL, password: secret };
  const { parseBootstrapAdmin, createFirstAdmin } = await import('../src/bootstrap-admin.js');
  // Reject invalid input before opening a database connection.
  const account = parseBootstrapAdmin(input);
  ({ db } = await import('../src/db.js'));
  const created = await createFirstAdmin(account);
  console.log(JSON.stringify({ ok: true, message: 'First Admin created. Remove bootstrap secrets from the service environment; create later staff in Team & access.', ...created }));
} catch (error) {
  // Driver error messages can contain SQL values; log only safe validation messages/codes.
  const safe = error.code?.startsWith('ER_') ? `Database refused bootstrap (${error.code}). Verify schema and account state.` : error.message;
  console.error(JSON.stringify({ ok: false, error: safe, code: error.code || 'BOOTSTRAP_FAILED' }));
  process.exitCode = 1;
} finally {
  if (db) await db.end();
}
