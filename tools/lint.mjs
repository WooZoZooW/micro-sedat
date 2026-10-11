#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirs = new Set(['node_modules', '.git', '.wrangler', 'tmp', 'coverage']);
const failures = [];
const notes = [];

async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), files);
    } else {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

const files = await walk(root);
const relative = (file) => path.relative(root, file);

const secretPatterns = [
  { name: 'GitHub classic token', pattern: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'GitHub fine-grained token', pattern: /github_pat_[A-Za-z0-9_]{30,}/ },
  { name: 'Private key block', pattern: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'Slack token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'Google API key', pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'Stripe secret key', pattern: /sk_live_[0-9a-zA-Z]{20,}/ },
];

const scriptFiles = [];
for (const file of files) {
  const rel = relative(file);
  const info = await stat(file);
  if (info.size === 0) {
    failures.push(`empty file: ${rel}`);
    continue;
  }

  if (/\.(js|mjs|cjs)$/.test(rel)) {
    scriptFiles.push(rel);
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      failures.push(`syntax error in ${rel}: ${(result.stderr || '').trim().split('\n').slice(0, 2).join(' ')}`);
    }
  }

  if (info.size > 2 * 1024 * 1024) {
    failures.push(`suspiciously large file (possible binary/cache): ${rel}`);
  }

  const content = await readFile(file, 'utf8');
  for (const { name, pattern } of secretPatterns) {
    if (pattern.test(content)) {
      failures.push(`possible ${name} in ${rel}`);
    }
  }
}

const envExample = await readFile(path.join(root, '.env.example'), 'utf8').catch(() => '');
const gitignore = await readFile(path.join(root, '.gitignore'), 'utf8').catch(() => '');
if (!gitignore.split('\n').some((line) => line.trim() === '.env')) {
  failures.push('.gitignore must ignore .env');
}
if (!envExample.includes('GITHUB_TOKEN=')) {
  failures.push('.env.example must document GITHUB_TOKEN');
}

const indexHtml = await readFile(path.join(root, 'frontend/index.html'), 'utf8');
if (!indexHtml.includes('lang="ru"')) failures.push('frontend/index.html must declare lang="ru"');
if (!indexHtml.includes('viewport')) failures.push('frontend/index.html must define a viewport');
if (/<script[^>]+src=["']https?:/i.test(indexHtml)) failures.push('frontend must not load external scripts');
if (/<(img|link)[^>]+href=["']https?:/i.test(indexHtml)) failures.push('frontend must not load external assets');
for (const requiredId of ['record-button', 'file-input', 'instructions', 'submit-button', 'status', 'progress']) {
  if (!indexHtml.includes(`id="${requiredId}"`)) failures.push(`frontend/index.html missing element #${requiredId}`);
}

const appJs = await readFile(path.join(root, 'frontend/app.js'), 'utf8');
if (!appJs.includes('getUserMedia')) failures.push('frontend/app.js must use getUserMedia');
if (!appJs.includes('MediaRecorder')) failures.push('frontend/app.js must use MediaRecorder');

const frontendBundle = [...scriptFiles.filter((file) => file.startsWith('frontend/')).map(async (file) => `${file}\n${await readFile(path.join(root, file), 'utf8')}`)];
for (const promise of frontendBundle) {
  const content = await promise;
  if (/GITHUB_TOKEN|ADMIN_TOKEN|ACCESS_CODE\s*=/.test(content)) {
    failures.push(`possible secret reference in frontend file: ${content.split('\n')[0]}`);
  }
}

const wrangler = await readFile(path.join(root, 'backend/wrangler.toml'), 'utf8');
if (!wrangler.includes('main = "src/worker.js"')) failures.push('wrangler.toml must reference src/worker.js');
if (!wrangler.includes('[assets]')) failures.push('wrangler.toml must configure static assets');
if (/GITHUB_TOKEN\s*=/.test(wrangler)) failures.push('wrangler.toml must not contain GITHUB_TOKEN');
if (/ACCESS_CODE\s*=/.test(wrangler)) failures.push('wrangler.toml must not contain ACCESS_CODE');

notes.push(`checked ${files.length} files, ${scriptFiles.length} scripts`);

if (failures.length > 0) {
  console.error('lint: FAILED');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('lint: OK');
for (const note of notes) console.log(`  - ${note}`);
