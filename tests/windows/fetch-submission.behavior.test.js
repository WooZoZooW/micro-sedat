import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assetEntry,
  buildMetadata,
  buildView,
  createFakeGh,
} from './helpers/fake-gh.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(here, '../../windows/fetch-submission.ps1');

const PRIMARY_ID = 'abcdef01-2345-4678-89ab-cdef01234567';
const PRIMARY_PREFIX = 'abcdef01';
const DRAFT_SIBLING_ID = 'abcdef01-ffff-4fff-8fff-ffffffffffff';
const AMBIGUOUS_A = 'deadbeef-1111-4111-8111-111111111111';
const AMBIGUOUS_B = 'deadbeef-2222-4222-8222-222222222222';
const UNKNOWN_ID = '99999999-0000-4000-8000-000000000000';

function resolvePwsh() {
  const explicit = process.env.MICRO_SEDAT_PWSH;
  if (explicit) {
    const probe = spawnSync(explicit, ['-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8', timeout: 180000 });
    return probe.status === 0 ? { cmd: explicit, baseArgs: [], wrapper: true } : null;
  }
  const probe = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8', timeout: 60000 });
  return probe.status === 0 ? { cmd: 'pwsh', baseArgs: ['-NoProfile'], wrapper: false } : null;
}

const pwsh = resolvePwsh();

function tempRoot() {
  const base = process.env.MICRO_SEDAT_TEST_TMP || os.tmpdir();
  return mkdtempSync(path.join(base, 'micro-sedat-win-'));
}

function runScript(args, { ghPath, cwd }) {
  const env = { ...process.env };
  if (pwsh.wrapper) {
    env.MICRO_SEDAT_PWSH_PATH = ghPath;
  } else {
    env.PATH = ghPath;
  }
  const result = spawnSync(pwsh.cmd, [...pwsh.baseArgs, '-File', scriptPath, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 180000,
  });
  return { status: result.status, output: `${result.stdout || ''}\n${result.stderr || ''}` };
}

function ghPathFor(gh) {
  return `${gh.binDir}:/usr/bin:/bin`;
}

function partialDirs(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => name.includes('.partial-'));
}

function setupHappy(rootDir, { withFile = true } = {}) {
  const gh = createFakeGh(rootDir);
  const audio = Buffer.alloc(2048, 7);
  const image = Buffer.alloc(512, 9);
  const meta = buildMetadata({
    id: PRIMARY_ID,
    audioBytes: audio,
    fileExpected: withFile ? '01-images (1) (8).jpeg' : null,
    fileBytes: withFile ? image : null,
  });
  gh.setMetadata(PRIMARY_ID, meta);
  gh.setReleases([{ tagName: `sub-${PRIMARY_ID}`, isDraft: false }]);
  const assets = [assetEntry('recording.m4a', audio)];
  gh.addAsset(PRIMARY_ID, 'recording.m4a', audio);
  if (withFile) {
    assets.push(assetEntry('01-images.1.8.jpeg', image));
    gh.addAsset(PRIMARY_ID, '01-images.1.8.jpeg', image);
  }
  gh.setView(PRIMARY_ID, buildView(PRIMARY_ID, assets));
  return { gh, audio, image };
}

if (process.platform === 'win32') {
  test('Windows retrieval script behavior (real PowerShell)', {
    skip: 'these behavior tests drive a POSIX fake gh shim; use the documented Windows acceptance test instead',
  }, () => {});
} else if (!pwsh) {
  test('Windows retrieval script behavior (real PowerShell)', {
    skip: 'pwsh is not available; run on a machine with PowerShell or set MICRO_SEDAT_PWSH',
  }, () => {});
} else {
  test('downloads a full UUID with validation, BOM-free metadata and normalized filename', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { gh, audio, image } = setupHappy(root);
    const outRoot = path.join(root, 'out');

    const result = runScript(['-SubmissionId', PRIMARY_ID, '-OutputDir', outRoot], { ghPath: ghPathFor(gh), cwd: root });
    assert.equal(result.status, 0, result.output);

    const dest = path.join(outRoot, PRIMARY_ID);
    assert.ok(existsSync(path.join(dest, 'metadata.json')), result.output);
    assert.deepEqual(readFileSync(path.join(dest, 'recording.m4a')), audio);
    assert.deepEqual(readFileSync(path.join(dest, '01-images.1.8.jpeg')), image);

    const metaBytes = readFileSync(path.join(dest, 'metadata.json'));
    assert.notDeepEqual([...metaBytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'metadata.json must not start with a UTF-8 BOM');
    const parsed = JSON.parse(metaBytes.toString('utf8'));
    assert.equal(parsed.id, PRIMARY_ID);
    assert.ok(parsed.text.includes('привет'), 'Cyrillic text must survive the retrieval');
    assert.match(result.output, /Hand the folder to Antigravity manually/);
    assert.equal(partialDirs(outRoot).length, 0);
  });

  test('resolves a unique 8-character prefix and ignores draft releases', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { gh } = setupHappy(root);
    gh.setReleases([
      { tagName: `sub-${DRAFT_SIBLING_ID}`, isDraft: true },
      { tagName: `sub-${PRIMARY_ID}`, isDraft: false },
    ]);
    const outRoot = path.join(root, 'out');

    const result = runScript(['-SubmissionId', PRIMARY_PREFIX, '-OutputDir', outRoot], { ghPath: ghPathFor(gh), cwd: root });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, new RegExp(`Prefix resolved to ${PRIMARY_ID}`));
    assert.ok(existsSync(path.join(outRoot, PRIMARY_ID, 'metadata.json')));
  });

  test('stops with a clear error when the prefix matches nothing', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { gh } = setupHappy(root);
    gh.setReleases([]);
    const outRoot = path.join(root, 'out');

    const result = runScript(['-SubmissionId', PRIMARY_PREFIX, '-OutputDir', outRoot], { ghPath: ghPathFor(gh), cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /No published submission found/);
    assert.equal(existsSync(path.join(outRoot, PRIMARY_ID)), false);
    assert.equal(partialDirs(outRoot).length, 0);
  });

  test('stops with an ambiguity error without downloading anything', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const gh = createFakeGh(root);
    gh.setReleases([
      { tagName: `sub-${AMBIGUOUS_A}`, isDraft: false },
      { tagName: `sub-${AMBIGUOUS_B}`, isDraft: false },
    ]);
    const outRoot = path.join(root, 'out');

    const result = runScript(['-SubmissionId', 'deadbeef', '-OutputDir', outRoot], { ghPath: ghPathFor(gh), cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /ambiguous/i);
    assert.match(result.output, new RegExp(AMBIGUOUS_A));
    assert.match(result.output, new RegExp(AMBIGUOUS_B));
    assert.equal(existsSync(outRoot), false);
  });

  test('rejects malformed submission ids before any download', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const gh = createFakeGh(root);
    const outRoot = path.join(root, 'out');

    const result = runScript(['-SubmissionId', 'not-a-valid-id', '-OutputDir', outRoot], { ghPath: ghPathFor(gh), cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Invalid submission id/);
    assert.equal(existsSync(outRoot), false);
  });

  test('fails early when gh is not installed', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const outRoot = path.join(root, 'out');

    const result = runScript(['-SubmissionId', PRIMARY_ID, '-OutputDir', outRoot], { ghPath: '/usr/bin:/bin', cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /not installed/);
    assert.equal(existsSync(outRoot), false);
  });

  test('fails before downloading when GitHub authentication is missing', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { gh } = setupHappy(root);
    gh.flag('auth-fail');
    const outRoot = path.join(root, 'out');

    const result = runScript(['-SubmissionId', PRIMARY_ID, '-OutputDir', outRoot], { ghPath: ghPathFor(gh), cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /not authenticated/);
    assert.equal(existsSync(outRoot), false);
  });

  test('rejects invalid metadata JSON and cleans the temporary folder', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { gh } = setupHappy(root);
    gh.flag('api-bad-json');
    const outRoot = path.join(root, 'out');

    const result = runScript(['-SubmissionId', PRIMARY_ID, '-OutputDir', outRoot], { ghPath: ghPathFor(gh), cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /not valid JSON/);
    assert.equal(existsSync(path.join(outRoot, PRIMARY_ID)), false);
    assert.equal(partialDirs(outRoot).length, 0);
  });

  test('rejects metadata whose id does not match the requested submission', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { gh } = setupHappy(root);
    gh.setMetadata(PRIMARY_ID, buildMetadata({ id: AMBIGUOUS_A }));
    const outRoot = path.join(root, 'out');

    const result = runScript(['-SubmissionId', PRIMARY_ID, '-OutputDir', outRoot], { ghPath: ghPathFor(gh), cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /does not match/);
    assert.equal(existsSync(path.join(outRoot, PRIMARY_ID)), false);
  });

  test('reports a missing expected asset', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { gh, audio } = setupHappy(root);
    gh.setView(PRIMARY_ID, buildView(PRIMARY_ID, [assetEntry('recording.m4a', audio)]));
    const outRoot = path.join(root, 'out');

    const result = runScript(['-SubmissionId', PRIMARY_ID, '-OutputDir', outRoot], { ghPath: ghPathFor(gh), cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /was not found in release/);
    assert.equal(existsSync(path.join(outRoot, PRIMARY_ID)), false);
  });

  test('reports a size mismatch between metadata and the release', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { gh, audio, image } = setupHappy(root);
    gh.setView(PRIMARY_ID, buildView(PRIMARY_ID, [
      assetEntry('recording.m4a', audio),
      { name: '01-images.1.8.jpeg', size: image.length + 1, state: 'uploaded' },
    ]));
    const outRoot = path.join(root, 'out');

    const result = runScript(['-SubmissionId', PRIMARY_ID, '-OutputDir', outRoot], { ghPath: ghPathFor(gh), cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Size mismatch/);
    assert.equal(existsSync(path.join(outRoot, PRIMARY_ID)), false);
  });

  test('reports unexpected release assets', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { gh, audio, image } = setupHappy(root);
    gh.setView(PRIMARY_ID, buildView(PRIMARY_ID, [
      assetEntry('recording.m4a', audio),
      assetEntry('01-images.1.8.jpeg', image),
      assetEntry('99-unexpected.bin', Buffer.alloc(4, 1)),
    ]));
    const outRoot = path.join(root, 'out');

    const result = runScript(['-SubmissionId', PRIMARY_ID, '-OutputDir', outRoot], { ghPath: ghPathFor(gh), cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /does not describe/);
    assert.equal(existsSync(path.join(outRoot, PRIMARY_ID)), false);
  });

  test('refuses to overwrite an existing folder without -Force', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { gh } = setupHappy(root);
    const outRoot = path.join(root, 'out');
    const dest = path.join(outRoot, PRIMARY_ID);
    mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(dest, 'keep-me.txt'), 'user data');

    const result = runScript(['-SubmissionId', PRIMARY_ID, '-OutputDir', outRoot], { ghPath: ghPathFor(gh), cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /already contains files/);
    assert.equal(readFileSync(path.join(dest, 'keep-me.txt'), 'utf8'), 'user data');
    assert.equal(existsSync(path.join(dest, 'metadata.json')), false);
    assert.equal(partialDirs(outRoot).length, 0);
  });

  test('fills an existing empty destination folder without -Force', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { gh } = setupHappy(root);
    const outRoot = path.join(root, 'out');
    mkdirSync(path.join(outRoot, PRIMARY_ID), { recursive: true });

    const result = runScript(['-SubmissionId', PRIMARY_ID, '-OutputDir', outRoot], { ghPath: ghPathFor(gh), cwd: root });
    assert.equal(result.status, 0, result.output);
    assert.ok(existsSync(path.join(outRoot, PRIMARY_ID, 'metadata.json')));
  });

  test('replaces an existing folder only after -Force and a successful download', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { gh } = setupHappy(root);
    const outRoot = path.join(root, 'out');
    const dest = path.join(outRoot, PRIMARY_ID);
    mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(dest, 'old-file.txt'), 'old');

    const result = runScript(['-SubmissionId', PRIMARY_ID, '-OutputDir', outRoot, '-Force'], { ghPath: ghPathFor(gh), cwd: root });
    assert.equal(result.status, 0, result.output);
    assert.equal(existsSync(path.join(dest, 'old-file.txt')), false);
    assert.ok(existsSync(path.join(dest, 'metadata.json')));
    assert.equal(partialDirs(outRoot).length, 0);
  });

  test('keeps the previous download intact when a -Force re-download fails', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { gh } = setupHappy(root);
    gh.flag('download-fail-once');
    const outRoot = path.join(root, 'out');
    const dest = path.join(outRoot, PRIMARY_ID);
    mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(dest, 'keep-me.txt'), 'previous valid download');

    const result = runScript(['-SubmissionId', PRIMARY_ID, '-OutputDir', outRoot, '-Force'], { ghPath: ghPathFor(gh), cwd: root });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(path.join(dest, 'keep-me.txt'), 'utf8'), 'previous valid download');
    assert.equal(existsSync(path.join(dest, 'metadata.json')), false);
    assert.equal(partialDirs(outRoot).length, 0);
  });

  test('never touches unrelated files in the output root', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { gh } = setupHappy(root);
    const outRoot = path.join(root, 'out');
    mkdirSync(outRoot, { recursive: true });
    writeFileSync(path.join(outRoot, 'sibling.txt'), 'unrelated');

    const result = runScript(['-SubmissionId', PRIMARY_ID, '-OutputDir', outRoot], { ghPath: ghPathFor(gh), cwd: root });
    assert.equal(result.status, 0, result.output);
    assert.equal(readFileSync(path.join(outRoot, 'sibling.txt'), 'utf8'), 'unrelated');
  });

  test('handles a text-only submission without binary assets', (t) => {
    const root = tempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { gh } = setupHappy(root, { withFile: false });
    const meta = buildMetadata({ id: UNKNOWN_ID, text: 'Только текст' });
    gh.setMetadata(UNKNOWN_ID, meta);
    gh.setReleases([{ tagName: `sub-${UNKNOWN_ID}`, isDraft: false }]);
    gh.setView(UNKNOWN_ID, buildView(UNKNOWN_ID, []));
    const outRoot = path.join(root, 'out');

    const result = runScript(['-SubmissionId', UNKNOWN_ID, '-OutputDir', outRoot], { ghPath: ghPathFor(gh), cwd: root });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /text-only/);
    const parsed = JSON.parse(readFileSync(path.join(outRoot, UNKNOWN_ID, 'metadata.json'), 'utf8'));
    assert.equal(parsed.text, 'Только текст');
    assert.equal(partialDirs(outRoot).length, 0);
  });
}
