import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { root, requireNode } from './common.mjs';
requireNode();
if (!process.argv.includes('--run-id')) {
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'dev.mjs'), '--run-id', crypto.randomUUID()], { stdio: 'inherit' });
  child.once('exit', code => process.exit(code ?? 0));
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
} else {
  const runId = process.argv[process.argv.indexOf('--run-id') + 1];
  const stateDir = path.join(root, '.run');
  const stateFile = path.join(stateDir, 'dev.json');
  const children = [];
  let stopping = false;
  await fs.mkdir(stateDir, { recursive: true });
  try {
    const previous = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    try { process.kill(previous.pid, 0); throw new Error('The project appears to be running. Use npm stop or Ctrl+C first.'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
    try {
      const current = JSON.parse(await fs.readFile(stateFile, 'utf8'));
      if (current.runId === runId) await fs.unlink(stateFile);
    } catch {}
    const timer = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(code); }, 5000);
    timer.unref();
    await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))));
    process.exit(code);
  };
  for (const folder of ['backend', 'frontend']) {
    const args = folder === 'backend' ? [path.join(root, 'backend', 'server.js')] : [path.join(root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'];
    const child = spawn(process.execPath, args, { cwd: path.join(root, folder), stdio: 'inherit' });
    child.once('error', error => { console.error(error.message); stop(1); });
    child.once('exit', code => { if (!stopping) { console.error(folder + ' stopped (' + code + ').'); stop(code || 1); } });
    children.push(child);
  }
  await fs.writeFile(stateFile, JSON.stringify({ pid: process.pid, runId, root, children: children.map(c => c.pid) }, null, 2));
  console.log('Starting Virar Organics. MySQL and Redis must already be running.');
  console.log('Store: http://localhost:5173 | Admin: http://localhost:5173/admin');
  console.log('Use Ctrl+C here or npm stop in another terminal.');
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());
}
