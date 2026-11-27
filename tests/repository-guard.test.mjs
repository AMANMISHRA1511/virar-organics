import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const script = fileURLToPath(new URL('../scripts/check-repository.mjs', import.meta.url));
const token = () => ['gh', 'p_', 'A'.repeat(36)].join('');
async function repo(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mitti-git-guard-'));
  function git(...args) { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, 'Temporary Git operation failed'); return r; }
  async function write(filename, contents) { const p = path.join(root, filename); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, contents); }
  const scan = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  try { git('init', '--quiet'); await fn({ root, git, write, scan }); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('A forcibly staged environment file is blocked without exposing its value', () => repo(async ({ git, write, scan }) => {
  const secret = 'SyntheticUnpublishedCredential' + '9'.repeat(20);
  await write('.gitignore', '.env\n'); await write('.env', `JWT_SECRET=${secret}\n`); git('add', '-f', '.env');
  const r = scan(); assert.equal(r.status, 1); assert.match(r.stderr, /\.env: environment-file/); assert.ok(!r.stderr.includes(secret)); assert.ok(!r.stdout.includes(secret));
}));

test('Empty/example templates and explicit fictional test fixtures are allowed', () => repo(async ({ git, write, scan }) => {
  await write('backend/.env.example', 'JWT_SECRET=\nDB_PASSWORD=<your-isolated-database-password>\n');
  await write('tests/fixture.mjs', "const password = 'TestFixtureOnly123!';\nconst secret = 'local-test-not-a-real-provider-secret';\n");
  await write('README.md', '# Local setup\n'); git('add', '.'); const r = scan('--github'); assert.equal(r.status, 0, r.stderr);
}));

test('Provider-shaped credentials are blocked even in test files and example templates', () => repo(async ({ git, write, scan }) => {
  const secret = token(); await write('tests/provider.test.mjs', `const credential = '${secret}';\n`); await write('backend/.env.example', `GITHUB_TOKEN=${secret}\n`); git('add', '.');
  const r = scan(); assert.equal(r.status, 1); assert.match(r.stderr, /tests\/provider\.test\.mjs: github-token/); assert.match(r.stderr, /backend\/\.env\.example:.*github-token/);
  assert.ok(!r.stderr.includes(secret)); assert.ok(!r.stdout.includes(secret));
}));

test('Private-key contents and private credential filenames are blocked with redacted output', () => repo(async ({ git, write, scan }) => {
  const body = ['-----BEGIN ', 'PRIVATE KEY-----\n', 'SYNTHETIC_BODY_ONLY\n', '-----END ', 'PRIVATE KEY-----'].join('');
  await write('app/data.txt', body); await write('keys/client.pem', ''); git('add', '.'); const r = scan();
  assert.equal(r.status, 1); assert.match(r.stderr, /app\/data\.txt: private-key/); assert.match(r.stderr, /keys\/client\.pem: private-credential-file/); assert.ok(!r.stderr.includes('SYNTHETIC_BODY_ONLY'));
}));

test('Credentialed URLs and unlabelled literal passwords are rejected', () => repo(async ({ git, write, scan }) => {
  const credential = 'UnpublishedSyntheticValue' + '7'.repeat(18);
  await write('app/config.js', `const url = 'mysql://account:${credential}@localhost/example';\nconst password = '${credential}';\n`); git('add', '.'); const r = scan();
  assert.equal(r.status, 1); assert.match(r.stderr, /credentialed-url/); assert.match(r.stderr, /literal-credential/); assert.ok(!r.stderr.includes(credential));
}));

test('An opaque literal credential is still blocked inside the tests directory', () => repo(async ({ git, write, scan }) => {
  const credential = ['Q7v.', 'n4Z$Ar8', 'K2s9Pm6'].join('');
  await write('tests/opaque.test.js', `const password = '${credential}';\n`); git('add', '.');
  const r = scan(); assert.equal(r.status, 1); assert.match(r.stderr, /tests\/opaque\.test\.js: literal-credential/);
  assert.ok(!r.stderr.includes(credential)); assert.ok(!r.stdout.includes(credential));
}));

test('The scanner reads staged blobs rather than a sanitized unstaged working file', () => repo(async ({ git, write, scan }) => {
  const secret = token(); await write('app/config.js', `export const key='${secret}';\n`); git('add', '.'); await write('app/config.js', 'export const key=undefined;\n');
  const r = scan(); assert.equal(r.status, 1); assert.match(r.stderr, /github-token/); assert.ok(!r.stderr.includes(secret));
}));

test('Tracked mode checks committed files that are absent from the current staged diff', () => repo(async ({ git, write, scan }) => {
  await write('app/config.js', `export const key='${token()}';\n`); git('add', '.');
  git('-c', 'user.name=Guard Fixture', '-c', 'user.email=guard@example.test', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '-m', 'Synthetic guard fixture');
  assert.equal(scan().status, 0); const r = scan('--tracked'); assert.equal(r.status, 1); assert.match(r.stderr, /github-token/);
}));

test('GitHub mode blocks media, Hindi/extra guides and generated results while preserving app assets', () => repo(async ({ git, write, scan }) => {
  await write('README.md', '# Code-only project\n'); await write('backend/seed-assets/sample.png', Buffer.from([137, 80, 78, 71, 0, 1, 2, 3]));
  git('add', '.'); assert.equal(scan('--github').status, 0);
  await write('video/clip.mp4', Buffer.from([0, 0, 0, 0])); await write('HINDI_GUIDE.md', '# Synthetic guide\n'); await write('backend/README.md', '# Extra guide\n'); await write('tests/results/report.json', '{}'); git('add', '.');
  const r = scan('--github'); assert.equal(r.status, 1); assert.match(r.stderr, /github-media-excluded/); assert.match(r.stderr, /github-guide-excluded/); assert.match(r.stderr, /github-extra-markdown/); assert.match(r.stderr, /github-generated-or-guide-artifact/);
  assert.ok(!r.stderr.includes('backend/seed-assets/sample.png')); assert.ok(!/^README\.md:/m.test(r.stderr));
}));
