import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const script = readFileSync(path.join(root, 'windows/fetch-submission.ps1'), 'utf8');
const doc = readFileSync(path.join(root, 'docs/WINDOWS_WORKFLOW.md'), 'utf8');

test('script avoids PowerShell cmdlets with version-dependent encodings', () => {
  for (const forbidden of ['Set-Content', 'Out-File', 'Add-Content', '-Encoding UTF8']) {
    assert.equal(script.includes(forbidden), false, `fetch-submission.ps1 must not use ${forbidden}`);
  }
});

test('script writes metadata through .NET UTF-8 without BOM and verifies it', () => {
  assert.ok(script.includes('UTF8Encoding($false)'), 'must construct UTF8Encoding without BOM');
  assert.ok(script.includes('[System.IO.File]::WriteAllText'), 'must write through File::WriteAllText');
  assert.ok(script.includes('0xEF'), 'must detect a BOM after writing');
  assert.ok(script.includes('ReadAllText'), 'must parse the written metadata back');
});

test('script checks gh availability and authentication first', () => {
  assert.ok(script.includes('Get-Command gh'), 'must check for gh on PATH');
  assert.match(script, /'auth',\s*'status'/, 'must call gh auth status');
  assert.ok(script.includes('not authenticated'), 'must fail with an actionable auth message');
  assert.ok(script.includes('not installed'), 'must fail with an actionable install message');
});

test('script validates full UUIDs and 8-character prefixes', () => {
  assert.ok(script.includes('UuidPattern'), 'must define the UUID pattern');
  assert.ok(script.includes('PrefixPattern'), 'must define the prefix pattern');
  assert.ok(script.includes('{8}-'), 'UUID pattern must include groups');
  assert.match(script, /\^\[0-9a-fA-F\]\{8\}\$/, 'prefix pattern must be exactly 8 hex characters');
});

test('script resolves prefixes without guessing', () => {
  assert.ok(script.includes('isDraft'), 'must ignore draft releases when resolving');
  assert.ok(script.includes('No published submission found'), 'must fail on no match');
  assert.ok(script.includes('ambiguous'), 'must fail on multiple matches');
  assert.ok(script.includes('Prefix resolved to'), 'must report the resolution result');
});

test('script maps GitHub-normalized asset names deterministically', () => {
  assert.ok(script.includes('Get-GitHubAssetName'), 'must normalize names before matching');
  assert.ok(script.includes('[^A-Za-z0-9._-]+'), 'must use the GitHub normalization rule');
  assert.ok(script.includes('\\.{2,}'), 'must collapse consecutive periods after normalization');
  assert.ok(script.includes('Ambiguous asset mapping'), 'must refuse ambiguous matches');
});

test('script validates sizes, missing assets and unexpected assets', () => {
  assert.ok(script.includes('Size mismatch'), 'must compare release sizes with metadata');
  assert.ok(script.includes('was not found in release'), 'must report missing assets');
  assert.ok(script.includes('does not describe'), 'must report unexpected assets');
  assert.ok(script.includes('skipping the size comparison'), 'must explain when metadata lacks a size');
});

test('script downloads to a temporary folder and cleans up on failure', () => {
  assert.ok(script.includes('.partial-'), 'must download into a partial folder');
  assert.ok(script.includes('finally'), 'must clean up in a finally block');
  assert.ok(script.includes('Move-Item'), 'must move the validated folder into place');
});

test('script protects existing folders and supports explicit -Force replacement', () => {
  assert.ok(script.includes('[switch]$Force'), 'must expose a -Force switch');
  assert.ok(script.includes('already contains files'), 'must refuse silent overwrites');
  assert.ok(script.includes('Replacing existing folder'), 'must announce replacement');
  assert.ok(script.includes('was not changed'), 'must state that a failed download left the old folder intact');
});

test('script warns when a custom output directory leaves the ignored submissions area', () => {
  assert.ok(script.includes("notcontains 'submissions'"), 'must warn when the output path lacks a submissions segment');
  assert.ok(script.includes('check-ignore'), 'must use git check-ignore when available');
  assert.ok(script.includes('Do not commit downloaded submissions'), 'must warn about accidental commits');
});

test('documentation matches the script contract', () => {
  assert.ok(doc.includes('PowerShell 5.1'), 'must document Windows PowerShell 5.1');
  assert.ok(doc.includes('PowerShell 7'), 'must document PowerShell 7');
  assert.ok(doc.includes('gh auth login'), 'must document GitHub authentication');
  assert.ok(doc.includes('- Force') || doc.includes('-Force'), 'must document -Force');
  assert.ok(doc.includes('3118fb4e'), 'must show a short-prefix example');
  assert.ok(/UTF-8\s+\*{0,2}without/i.test(doc), 'must document BOM-free metadata');
  assert.ok(doc.includes('-OutputDir'), 'must document the output directory option');
  assert.ok(doc.includes('-List'), 'must document list mode');
  assert.ok(doc.includes('-Repo'), 'must document the repository option');
});

test('documentation avoids unreliable Base64 redirection procedures', () => {
  assert.equal(doc.includes('meta.b64'), false, 'must not document the broken meta.b64 flow');
  assert.equal(/--jq[^\n]*>\s*\S/.test(doc), false, 'must not pipe base64 through shell redirection');
  assert.ok(doc.includes('FromBase64String'), 'manual retrieval must decode Base64 explicitly');
});
