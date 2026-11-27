import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function scan(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { if (['node_modules','uploads','seed-assets'].includes(entry.name)) continue; const path = `${dir}/${entry.name}`; if (entry.isDirectory()) await scan(path); else if (/\.(js|mjs)$/.test(path)) { const r = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' }); if (r.status) process.exit(r.status); } } }
await scan('.'); console.log('All backend JavaScript syntax checks passed.');
