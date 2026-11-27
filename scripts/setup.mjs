import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { root, npm, run, requireNode } from './common.mjs';
try {
  requireNode();
  const envPath = path.join(root, 'backend', '.env');
  try {
    await fs.access(envPath);
    console.log('Keeping your existing backend/.env.');
  } catch {
    const template = await fs.readFile(path.join(root, 'backend', '.env.example'), 'utf8');
    await fs.writeFile(envPath, template.replace(/^JWT_SECRET=.*$/m, 'JWT_SECRET=' + crypto.randomBytes(48).toString('base64url')), { flag: 'wx', mode: 0o600 });
    console.log('Created backend/.env with a fresh local authentication secret.');
  }
  if (!process.argv.includes('--skip-docker')) {
    console.log('Starting MySQL and Redis. Docker Desktop must be running.');
    await run('docker', ['compose', 'up', '-d', '--wait', '--wait-timeout', '180']);
  }
  for (const folder of ['backend', 'frontend']) {
    console.log('Installing the locked ' + folder + ' dependencies...');
    await run(npm, ['ci', '--no-fund'], { cwd: path.join(root, folder) });
  }
  console.log('Applying safe schema migrations and development seed...');
  await run(npm, ['run', 'migrate'], { cwd: path.join(root, 'backend') });
  await run(npm, ['run', 'seed'], { cwd: path.join(root, 'backend') });
  console.log('\nSetup complete. Run .\\start.ps1 on Windows, or npm start.');
  console.log('Store: http://localhost:5173  |  Admin: http://localhost:5173/admin');
} catch (error) {
  console.error('\nSetup stopped: ' + error.message);
  console.error('Existing configuration and database records were kept. See README.md.');
  process.exitCode = 1;
}
