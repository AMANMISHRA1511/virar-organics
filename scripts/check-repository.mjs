#!/usr/bin/env node
/** Read-only Git index guard. No network calls, dependencies, source excerpts or secret values. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BLOB = 16 * 1024 * 1024;
const secretShapes = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['google-oauth-token', /\bya29\.[0-9A-Za-z._-]{20,}/],
  ['slack-token', /\bxox[baprs]-[0-9A-Za-z-]{15,}\b/],
  ['netlify-token', /\bnfp_[A-Za-z0-9]{20,}\b/],
  ['render-token', /\brnd_[A-Za-z0-9]{20,}\b/],
  ['razorpay-key', /\brzp_(?:live|test)_[A-Za-z0-9]{10,}\b/],
  ['twilio-account-or-key', /\b(?:AC|SK)[a-fA-F0-9]{32}\b/],
  ['stripe-secret', /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  ['jwt-token', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/],
];
const sensitiveField = key => /(?:^|_)(?:secret|password|passwd|token|api_key|private_key|access_key)$/i.test(key)
  || /^(?:clientSecret|accessToken|refreshToken|authToken|apiKey|privateKey|secretKey|dbPassword|smtpPassword|authorization)$/i.test(key);
const exampleFile = filename => /(?:^|[.])(?:example|sample|template)(?:[.]|$)/i.test(path.posix.basename(filename));
function placeholder(value) {
  const text = String(value).trim();
  return text === '' || /^<[^<>]+>$/.test(text) || /^\$\{[^}]+\}$/.test(text)
    || /^(?:replace[_ -]|change[_ -]|generate[_ -]|your[_ -]|placeholder(?:[_ -]|$)|example(?:[_ -]|$))/i.test(text)
    || /^(?:password|username|user|secret|token|api_key)$/i.test(text);
}
function fictionalFixture(value, filename, context = '') {
  // Recognized provider-token shapes are checked separately and never waived
  // just because a file lives in tests or calls the value a fixture.
  if (/^(?:local[-_]test|unit[-_]test|not[-_]a[-_]real|mock[-_]|test[-_]|fixture[-_]|demo[-_])/.test(value)) return true;
  if (/^(?:DemoOnly|TestOnly|TestCustomer|TestStaff|BrowserDemo|BrowserQA|CartRegression|LiveFixture|SyntheticFixture)[A-Za-z0-9!@#$%_.-]*$/.test(value)) return true;
  if (exampleFile(filename) && /(?:^|[_ -])(?:dev|test|demo|example|local)(?:[_ -]|$)/i.test(value)) return true;
  return /(?:^|\/)(?:tests?|test)\//.test(filename)
    && (/(?:test|fixture|demo|mock|synthetic|regression|unknown|incorrect|invalid|wrong|resetstaff|goodpassword)/i.test(value)
      || (/password/i.test(value) && /[A-Za-z0-9._+-]+@[A-Za-z0-9._-]+\.test\b/.test(context)));
}
function policyCategories(filename, github) {
  const name = filename.replaceAll('\\', '/'), base = path.posix.basename(name), findings = [];
  const isExample = exampleFile(name);
  if (!isExample && (base === '.env' || base.startsWith('.env.') || /\.env$/i.test(base))) findings.push('environment-file');
  if (!isExample && (/\.(?:pem|key|p12|pfx|p8|pkcs12|jks|keystore)$/i.test(base)
    || /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|\.netrc|\.pypirc|application_default_credentials\.json)$/i.test(base)
    || /(?:^|\/)(?:\.aws|\.ssh)\//i.test(name)
    || /(?:service[-_]?account|credentials?|secrets?)[^.\/]*\.(?:json|ya?ml)$/i.test(base))) findings.push('private-credential-file');
  if (github) {
    if (/^video\//i.test(name) || /\.(?:mp4|webm|mov|m4v|mkv|avi|mp3|wav|ogg|m4a|aac|flac|aiff?|opus)$/i.test(name)) findings.push('github-media-excluded');
    if (/^(?:HINDI|VIDEO)(?:[_.-]|$)/i.test(name)) findings.push('github-guide-excluded');
    if (/\.md$/i.test(name) && name !== 'README.md') findings.push('github-extra-markdown');
    if (/^(?:docs|tests\/results|test-results)\//i.test(name) || name === 'RELEASE_MANIFEST.json') findings.push('github-generated-or-guide-artifact');
    if (/(?:^|\/)(?:node_modules|\.netlify|\.run|\.runtime|__pycache__|coverage|playwright-report)\//i.test(name)
      || /^(?:frontend\/dist|tests\/tmp|runtime|deliverables)\//i.test(name)
      || (/^backend\/uploads\//.test(name) && name !== 'backend/uploads/.gitkeep')
      || /\.(?:log|pyc|zip|tgz|tar|tar\.gz|7z|rar)$/i.test(name)) findings.push('github-runtime-or-build-artifact');
  }
  return findings;
}

export function inspectRepositoryFile(filename, buffer, { github = false } = {}) {
  const findings = new Set(policyCategories(filename, github));
  if (findings.has('environment-file') || findings.has('private-credential-file')) return [...findings];
  if (buffer.length > MAX_BLOB) { findings.add('blob-exceeds-review-limit'); return [...findings]; }
  const text = buffer.toString('utf8');
  for (const [category, pattern] of secretShapes) if (pattern.test(text)) findings.add(category);
  const urls = /\b(?:https?|mysql2?|postgres(?:ql)?|rediss?|mongodb(?:\+srv)?)\:\/\/([^\s\"'`/@:]+):([^\s\"'`/@]+)@[^\s\"'`]+/gi;
  for (const match of text.matchAll(urls)) {
    let password = match[2]; try { password = decodeURIComponent(password); } catch { /* Raw value still checked. */ }
    if (!placeholder(password)) findings.add('credentialed-url');
  }
  // Inspect known ASCII token shapes in binary metadata, but do not interpret
  // binary bytes as JavaScript/JSON/environment assignments.
  if (buffer.subarray(0, 8000).includes(0)) return [...findings];
  const literalPatterns = [
    /(?:^|[,{;\r\n])[ \t]*["']?([A-Za-z_][A-Za-z0-9_]*)["']?[ \t]*:[ \t]*(["'`])([^"'`\r\n]*)\2(?=[ \t]*(?:[,;}\]\r\n]|$))/g,
    /\b(?:const|let|var)[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(["'`])([^"'`\r\n]*)\2(?=[ \t]*(?:[,;}\]\r\n]|$))/g,
    /\b(?:[A-Za-z_$][\w$]*\.)+([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(["'`])([^"'`\r\n]*)\2(?=[ \t]*(?:[,;}\]\r\n]|$))/g,
  ];
  for (const literals of literalPatterns) for (const match of text.matchAll(literals)) {
    if (!sensitiveField(match[1])) continue;
    const value = match[3];
    const context = text.slice(Math.max(0, match.index - 500), match.index + match[0].length + 500);
    if (!placeholder(value) && !fictionalFixture(value, filename, context) && !value.includes('${')) findings.add('literal-credential');
  }
  // Bare KEY=value assignments cover example dotenv files and shell config.
  const assignments = /^[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*([^\r\n]*)$/gm;
  for (const match of text.matchAll(assignments)) {
    if (!sensitiveField(match[1])) continue;
    const value = match[2].trim().replace(/\s+#.*$/, '').replace(/^(["'])(.*)\1$/, '$2');
    if (!placeholder(value) && !fictionalFixture(value, filename) && !/^(?:process\.env\.|\$[A-Z_{])/.test(value)) findings.add('literal-credential');
  }
  return [...findings].sort();
}

function git(args, cwd, maximum = MAX_BLOB + 65536) {
  const result = spawnSync('git', args, { cwd, encoding: null, maxBuffer: maximum, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('Git index could not be read.');
  return result.stdout;
}
export function checkRepository({ cwd = process.cwd(), tracked = false, github = false } = {}) {
  const directory = git(['rev-parse', '--show-toplevel'], cwd).toString().trim();
  const index = git(['ls-files', '--stage', '-z'], directory).toString().split('\0').filter(Boolean);
  const candidates = tracked ? null : new Set(git(['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=ACMR', '-z'], directory).toString().split('\0').filter(Boolean));
  const findings = [], seen = new Set(); let checked = 0;
  for (const record of index) {
    const match = /^(\d+) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error('Git index could not be parsed.');
    const [, mode, object, stage, filename] = match;
    if ((candidates && !candidates.has(filename)) || seen.has(filename)) continue;
    seen.add(filename); checked++;
    if (stage !== '0') { findings.push({ file: filename, categories: ['unresolved-index-entry'] }); continue; }
    if (mode === '160000') { findings.push({ file: filename, categories: ['submodule-not-inspected'] }); continue; }
    const filePolicy = policyCategories(filename, github);
    if (filePolicy.includes('environment-file') || filePolicy.includes('private-credential-file')) { findings.push({ file: filename, categories: filePolicy }); continue; }
    let buffer;
    try { buffer = git(['cat-file', 'blob', object], directory); }
    catch { findings.push({ file: filename, categories: ['blob-could-not-be-reviewed'] }); continue; }
    const categories = inspectRepositoryFile(filename, buffer, { github });
    if (categories.length) findings.push({ file: filename, categories });
  }
  return { checked, findings };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write('Usage: node scripts/check-repository.mjs [--tracked] [--github]\nChecks staged blobs by default; --tracked checks every indexed file. --github enforces the code-only export policy.\nNo files are changed. Output contains filenames/categories only.\n'); return;
  }
  if (args.some(arg => !['--tracked', '--github'].includes(arg))) { process.stderr.write('Repository check: unsupported option.\n'); process.exitCode = 2; return; }
  try {
    const result = checkRepository({ tracked: args.includes('--tracked'), github: args.includes('--github') });
    if (result.findings.length) {
      process.stderr.write('Repository check blocked:\n');
      for (const finding of result.findings) process.stderr.write(`${finding.file}: ${finding.categories.join(', ')}\n`);
      process.exitCode = 1;
    } else process.stdout.write(`Repository check passed: ${result.checked} indexed file(s).\n`);
  } catch { process.stderr.write('Repository check could not inspect the Git index. Run it inside the intended Git worktree.\n'); process.exitCode = 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
