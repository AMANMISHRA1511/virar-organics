import { spawn } from 'node:child_process';

// Free web services have no pre-deploy command or deployment shell. Run the
// non-destructive migration before opening HTTP; never run the development seed.
const bootstrapRequested = process.env.BOOTSTRAP_ADMIN_ON_START === 'true';
const bootstrap = { name: process.env.BOOTSTRAP_ADMIN_NAME, email: process.env.BOOTSTRAP_ADMIN_EMAIL, password: process.env.BOOTSTRAP_ADMIN_PASSWORD };
for (const key of ['BOOTSTRAP_ADMIN_ON_START', 'BOOTSTRAP_ADMIN_NAME', 'BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD']) delete process.env[key];
let database;
try {
  const { validateConfig } = await import('../src/config.js');
  validateConfig();
  if (bootstrapRequested) {
    const { parseBootstrapAdmin } = await import('../src/bootstrap-admin.js');
    parseBootstrapAdmin(bootstrap);
  }
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['migrate.js'], { cwd: new URL('..', import.meta.url), stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(Object.assign(new Error('Database migration failed.'), { code: 'MIGRATION_FAILED' })));
  });
  ({ db: database } = await import('../src/db.js'));
  if (process.env.IMPORT_BUNDLED_CATALOGUE === 'true') {
    const { importBundledCatalogue } = await import('./import-catalogue.mjs');
    console.log(JSON.stringify({ step: 'catalogue', ...await importBundledCatalogue() }));
  }
  if (bootstrapRequested) {
    const { createFirstAdmin } = await import('../src/bootstrap-admin.js');
    try {
      const account = await createFirstAdmin(bootstrap);
      console.log(JSON.stringify({ step: 'admin-bootstrap', created: true, id: account.id, message: 'Remove bootstrap variables from the protected service environment.' }));
    } catch (error) {
      if (error.code !== 'ADMIN_EXISTS') throw error;
      console.log(JSON.stringify({ step: 'admin-bootstrap', created: false, message: 'An Admin already exists. No account or password was changed. Remove bootstrap variables.' }));
    }
  }
  bootstrap.password = undefined;
  await import('../server.js');
} catch (error) {
  bootstrap.password = undefined;
  console.error(JSON.stringify({ level: 'error', message: 'Startup failed. Check database migrations and protected environment configuration.', code: /^[A-Z0-9_]{1,50}$/.test(error.code || '') ? error.code : 'STARTUP_CONFIGURATION' }));
  if (database) await database.end();
  process.exitCode = 1;
}
