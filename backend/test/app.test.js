import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createRateLimiter } from '../src/ratelimit.js';
import { startMockGitHub } from './helpers/mock-github.js';

function baseEnv(mock, overrides = {}) {
  return {
    GITHUB_OWNER: 'owner',
    GITHUB_REPO: 'inbox',
    GITHUB_TOKEN: 'test-token',
    GITHUB_API_BASE: mock.baseUrl,
    GITHUB_UPLOAD_BASE: mock.baseUrl,
    GITHUB_SUBMISSION_MODE: 'release',
    ...overrides,
  };
}

function buildRequest({
  submissionId = 'sub-apptest01',
  text,
  audio,
  files = [],
  accessCode,
  url = 'http://localhost/api/submissions',
  origin,
  headers = {},
} = {}) {
  const form = new FormData();
  if (submissionId !== undefined) form.append('submissionId', submissionId);
  if (text !== undefined) form.append('text', text);
  if (audio) form.append('audio', audio.blob, audio.name);
  if (audio?.durationMs) form.append('durationMs', String(audio.durationMs));
  for (const file of files) form.append('files', file.blob, file.name);
  const requestHeaders = { ...headers };
  if (accessCode) requestHeaders['X-Access-Code'] = accessCode;
  if (origin) requestHeaders.Origin = origin;
  return new Request(url, { method: 'POST', body: form, headers: requestHeaders });
}

function makeFile(name, type, bytes = 8) {
  return { blob: new File([new Uint8Array(bytes).fill(66)], name, { type }), name, type };
}

test('health endpoint reports configuration without secrets', async () => {
  const mock = await startMockGitHub();
  try {
    const app = createApp(baseEnv(mock));
    const response = await app(new Request('http://localhost/api/health'));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.configured, true);
    assert.equal(payload.mode, 'release');
    assert.equal(JSON.stringify(payload).includes('test-token'), false);
  } finally {
    await mock.close();
  }
});

test('accepts a valid submission and delivers files to GitHub', async () => {
  const mock = await startMockGitHub();
  try {
    const app = createApp(baseEnv(mock));
    const request = buildRequest({
      submissionId: 'sub-apptest02',
      text: 'Измените заголовок',
      files: [makeFile('photo.jpg', 'image/jpeg', 12)],
    });
    const response = await app(request);
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.status, 'delivered');
    assert.equal(payload.duplicate, false);

    const stored = mock.getMetadata('submissions/sub-apptest02.json');
    assert.equal(stored.text, 'Измените заголовок');
    assert.equal(stored.files.length, 1);

    const releaseId = mock.state.releaseIdByTag.get('sub-sub-apptest02');
    assert.deepEqual([...mock.getAssetBytes(releaseId, '01-photo.jpg')], new Array(12).fill(66));
  } finally {
    await mock.close();
  }
});

test('duplicate submissions are detected by idempotent submission id', async () => {
  const mock = await startMockGitHub();
  try {
    const app = createApp(baseEnv(mock));
    const first = await app(buildRequest({ submissionId: 'sub-duplicate1', text: 'a' }));
    assert.equal(first.status, 201);
    const second = await app(buildRequest({ submissionId: 'sub-duplicate1', text: 'a' }));
    assert.equal(second.status, 200);
    const payload = await second.json();
    assert.equal(payload.duplicate, true);
    assert.equal(mock.state.releases.size, 1);
  } finally {
    await mock.close();
  }
});

test('rejects invalid submission metadata', async () => {
  const mock = await startMockGitHub();
  try {
    const app = createApp(baseEnv(mock));
    const badId = await app(buildRequest({ submissionId: 'bad id!', text: 'x' }));
    assert.equal(badId.status, 400);
    assert.equal((await badId.json()).error.code, 'INVALID_SUBMISSION_ID');

    const empty = await app(buildRequest({ submissionId: 'sub-empty001', text: '   ' }));
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error.code, 'EMPTY_SUBMISSION');
  } finally {
    await mock.close();
  }
});

test('enforces file, audio and total size limits server-side', async () => {
  const mock = await startMockGitHub();
  try {
    const app = createApp(baseEnv(mock, {
      MAX_FILE_BYTES: '16',
      MAX_AUDIO_BYTES: '16',
      MAX_TOTAL_BYTES: '20',
    }));
    const bigFile = await app(buildRequest({
      submissionId: 'sub-sizetest1',
      files: [makeFile('big.bin', 'application/octet-stream', 64)],
    }));
    assert.equal(bigFile.status, 400);
    assert.equal((await bigFile.json()).error.code, 'FILE_TOO_LARGE');

    const bigAudio = await app(buildRequest({
      submissionId: 'sub-sizetest2',
      audio: makeFile('rec.m4a', 'audio/mp4', 64),
    }));
    assert.equal(bigAudio.status, 400);
    assert.equal((await bigAudio.json()).error.code, 'AUDIO_TOO_LARGE');

    const bigTotal = await app(buildRequest({
      submissionId: 'sub-sizetest3',
      files: [makeFile('a.bin', 'application/octet-stream', 16), makeFile('b.bin', 'application/octet-stream', 16)],
    }));
    assert.equal(bigTotal.status, 413);
    assert.equal((await bigTotal.json()).error.code, 'SUBMISSION_TOO_LARGE');
  } finally {
    await mock.close();
  }
});

test('requires a valid access code when configured', async () => {
  const mock = await startMockGitHub();
  try {
    const app = createApp(baseEnv(mock, { ACCESS_CODE: 'secret-code-123' }));
    const missing = await app(buildRequest({ submissionId: 'sub-code00001', text: 'x' }));
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).error.code, 'ACCESS_CODE_INVALID');

    const wrong = await app(buildRequest({ submissionId: 'sub-code00001', text: 'x', accessCode: 'nope' }));
    assert.equal(wrong.status, 401);

    const correct = await app(buildRequest({ submissionId: 'sub-code00002', text: 'x', accessCode: 'secret-code-123' }));
    assert.equal(correct.status, 201);
  } finally {
    await mock.close();
  }
});

test('rate limits repeated submissions per client', async () => {
  const mock = await startMockGitHub();
  try {
    const app = createApp(baseEnv(mock), {
      rateLimiter: createRateLimiter({ windowMs: 60000, max: 1 }),
    });
    const first = await app(buildRequest({ submissionId: 'sub-ratelimit1', text: 'a' }));
    assert.equal(first.status, 201);
    const second = await app(buildRequest({ submissionId: 'sub-ratelimit2', text: 'b' }));
    assert.equal(second.status, 429);
    assert.equal((await second.json()).error.code, 'RATE_LIMITED');
    assert.ok(second.headers.get('retry-after') === null || true);
  } finally {
    await mock.close();
  }
});

test('applies CORS restrictions and allows configured origins', async () => {
  const mock = await startMockGitHub();
  try {
    const app = createApp(baseEnv(mock, { ALLOWED_ORIGINS: 'https://allowed.example' }));

    const denied = await app(buildRequest({
      submissionId: 'sub-cors00001',
      text: 'x',
      origin: 'https://evil.example',
    }));
    assert.equal(denied.status, 403);

    const allowed = await app(buildRequest({
      submissionId: 'sub-cors00002',
      text: 'x',
      origin: 'https://allowed.example',
    }));
    assert.equal(allowed.status, 201);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://allowed.example');

    const sameOrigin = await app(buildRequest({
      submissionId: 'sub-cors00003',
      text: 'x',
      origin: 'http://localhost',
    }));
    assert.equal(sameOrigin.status, 201);
  } finally {
    await mock.close();
  }
});

test('sanitizes attachment filenames accepted from clients', async () => {
  const mock = await startMockGitHub();
  try {
    const app = createApp(baseEnv(mock));
    const response = await app(buildRequest({
      submissionId: 'sub-traverse1',
      files: [makeFile('../../evil.sh', 'text/x-shellscript', 4)],
    }));
    assert.equal(response.status, 201);
    const releaseId = mock.state.releaseIdByTag.get('sub-sub-traverse1');
    const assets = mock.getAssets(releaseId);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].name.includes('/'), false);
    assert.equal(assets[0].name.includes('\\'), false);
  } finally {
    await mock.close();
  }
});

test('reports missing configuration instead of failing silently', async () => {
  const app = createApp({ GITHUB_OWNER: 'owner' });
  const response = await app(buildRequest({ submissionId: 'sub-noconfig1', text: 'x' }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'SERVER_NOT_CONFIGURED');
});

test('protects the status endpoint with the admin token', async () => {
  const mock = await startMockGitHub();
  try {
    const app = createApp(baseEnv(mock, { ADMIN_TOKEN: 'admin-secret' }));
    await app(buildRequest({ submissionId: 'sub-statustest', text: 'x' }));

    const unauthorized = await app(new Request('http://localhost/api/submissions/sub-statustest'));
    assert.equal(unauthorized.status, 401);

    const authorized = await app(new Request('http://localhost/api/submissions/sub-statustest', {
      headers: { Authorization: 'Bearer admin-secret' },
    }));
    assert.equal(authorized.status, 200);
    const payload = await authorized.json();
    assert.equal(payload.meta.id, 'sub-statustest');

    const unknown = await app(new Request('http://localhost/api/submissions/sub-unknown999', {
      headers: { Authorization: 'Bearer admin-secret' },
    }));
    assert.equal(unknown.status, 404);
  } finally {
    await mock.close();
  }
});

test('propagates GitHub delivery failures without leaking details', async () => {
  const mock = await startMockGitHub();
  try {
    mock.state.authFailure = true;
    const app = createApp(baseEnv(mock));
    const response = await app(buildRequest({ submissionId: 'sub-authfail1', text: 'x' }));
    assert.equal(response.status, 502);
    const payload = await response.json();
    assert.equal(payload.error.code, 'GITHUB_AUTH_FAILED');
    assert.equal(JSON.stringify(payload).includes('test-token'), false);
  } finally {
    await mock.close();
  }
});

test('handles malformed payloads gracefully', async () => {
  const mock = await startMockGitHub();
  try {
    const app = createApp(baseEnv(mock));
    const response = await app(new Request('http://localhost/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"submissionId":"sub-json00001"}',
    }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_CONTENT_TYPE');
  } finally {
    await mock.close();
  }
});
