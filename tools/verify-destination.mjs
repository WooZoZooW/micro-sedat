#!/usr/bin/env node
import { buildConfig } from '../backend/src/app.js';

const config = buildConfig(process.env);
const token = config.token;

if (!token) {
  console.error('GITHUB_TOKEN is not set.');
  console.error('Create a fine-grained PAT with "Contents: Read and write" on the inbox repository, then run:');
  console.error('  GITHUB_TOKEN=github_pat_... node tools/verify-destination.mjs');
  process.exit(1);
}

if (!config.owner || !config.repo) {
  console.error('GITHUB_OWNER and GITHUB_REPO must be set.');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'micro-sedat-verifier',
};

const url = `${config.apiBase.replace(/\/+$/, '')}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;

const response = await fetch(url, { headers });
if (!response.ok) {
  console.error(`Cannot access ${config.owner}/${config.repo}: HTTP ${response.status}`);
  if (response.status === 401) console.error('The token is invalid or expired.');
  if (response.status === 403) console.error('The token lacks permissions for this repository.');
  if (response.status === 404) console.error('The repository does not exist or the token cannot see it.');
  process.exit(1);
}

const repo = await response.json();
console.log(`repository: ${repo.full_name}`);
console.log(`visibility: ${repo.private ? 'private (good)' : 'PUBLIC (not recommended for submissions)'}`);

if (!repo.private) {
  console.error('WARNING: the submission destination is public. Do not send personal recordings or documents here.');
}

const probe = await fetch(`${url}/contents/submissions`, { headers });
if (probe.status === 404) {
  console.log('submissions/ directory: not created yet (it will be created on first delivery)');
} else if (probe.ok) {
  console.log('submissions/ directory: accessible');
} else {
  console.error(`submissions/ directory probe failed: HTTP ${probe.status}`);
}

console.log(`delivery mode: ${config.mode}`);
console.log('destination check: OK');
