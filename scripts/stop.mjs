import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { root } from './common.mjs';
const execute = promisify(execFile);
const stateFile = path.join(root, '.run', 'dev.json');
try {
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  if (!Number.isSafeInteger(state.pid) || state.pid < 1 || state.root !== root || !/^[a-f0-9-]{36}$/.test(state.runId)) throw new Error('Invalid process record. Use Ctrl+C in the startup terminal.');
  let command;
  if (process.platform === 'win32') {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Process -Filter "ProcessId = ' + state.pid + '").CommandLine']);
    command = stdout;
  } else if (process.platform === 'linux') {
    command = await fs.readFile('/proc/' + state.pid + '/cmdline', 'utf8');
  } else {
    command = (await execute('ps', ['-p', String(state.pid), '-o', 'command='])).stdout;
  }
  if (!command.includes(state.runId) || !command.includes('dev.mjs')) throw new Error('The recorded process is not this project. Nothing was stopped. Use Ctrl+C in its terminal.');
  if (process.platform === 'win32') {
    await execute('taskkill', ['/PID', String(state.pid), '/T', '/F']);
    await fs.unlink(stateFile).catch(() => {});
  } else process.kill(state.pid, 'SIGTERM');
  console.log('Stopped the tracked Virar Organics application processes. Database services are unchanged.');
} catch (error) {
  if (error.code === 'ENOENT' || error.code === 'ESRCH') {
    await fs.unlink(stateFile).catch(() => {});
    console.log('No tracked project process is running.');
  } else { console.error(error.message); process.exitCode = 1; }
}
