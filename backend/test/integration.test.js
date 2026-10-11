import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockGitHub } from './helpers/mock-github.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(moduleDir, '../src/node-server.js');

async function startServer(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`server did not start in time: ${output}`)), 15000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('local server started')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early with code ${code}: ${output}`));
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill('SIGTERM');
    }),
  };
}

function makeFormData({ submissionId, text }) {
  const form = new FormData();
  form.append('submissionId', submissionId);
  if (text !== undefined) form.append('text', text);
  form.append('files', new File([new Uint8Array([77, 77, 77])], 'заметка.txt', { type: 'text/plain' }));
  return form;
}

test('serves the Russian single-page interface over the local server', async (t) => {
  const mock = await startMockGitHub();
  const server = await startServer({
    GITHUB_OWNER: 'owner',
    GITHUB_REPO: 'inbox',
    GITHUB_TOKEN: 'test-token',
    GITHUB_API_BASE: mock.baseUrl,
    GITHUB_UPLOAD_BASE: mock.baseUrl,
  });
  t.after(async () => {
    await server.stop();
    await mock.close();
  });

  const index = await fetch(`${server.baseUrl}/`);
  assert.equal(index.status, 200);
  const html = await index.text();
  assert.ok(html.includes('<html lang="ru">'));
  assert.ok(html.includes('Передать информацию'));
  assert.ok(html.includes('record-button'));
  assert.ok(!html.toLowerCase().includes('chat'));

  const css = await fetch(`${server.baseUrl}/styles.css`);
  assert.equal(css.status, 200);
  assert.ok(css.headers.get('content-type').includes('text/css'));

  const app = await fetch(`${server.baseUrl}/lib/format.js`);
  assert.equal(app.status, 200);
  assert.ok(app.headers.get('content-type').includes('javascript'));
});

test('performs an end-to-end submission through the local HTTP server', async (t) => {
  const mock = await startMockGitHub();
  const server = await startServer({
    GITHUB_OWNER: 'owner',
    GITHUB_REPO: 'inbox',
    GITHUB_TOKEN: 'test-token',
    GITHUB_API_BASE: mock.baseUrl,
    GITHUB_UPLOAD_BASE: mock.baseUrl,
    ACCESS_CODE: 'integration-code',
  });
  t.after(async () => {
    await server.stop();
    await mock.close();
  });

  const response = await fetch(`${server.baseUrl}/api/submissions`, {
    method: 'POST',
    headers: { 'X-Access-Code': 'integration-code' },
    body: makeFormData({ submissionId: 'sub-integration1', text: 'Проверка интеграции' }),
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.status, 'delivered');

  const stored = mock.getMetadata('submissions/sub-integration1.json');
  assert.equal(stored.text, 'Проверка интеграции');
  assert.equal(stored.files[0].name, 'заметка.txt');

  const releaseId = mock.state.releaseIdByTag.get('sub-sub-integration1');
  assert.deepEqual([...mock.getAssetBytes(releaseId, '01-заметка.txt')], [77, 77, 77]);

  const retry = await fetch(`${server.baseUrl}/api/submissions`, {
    method: 'POST',
    headers: { 'X-Access-Code': 'integration-code' },
    body: makeFormData({ submissionId: 'sub-integration1', text: 'Проверка интеграции' }),
  });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).duplicate, true);
  assert.equal(mock.state.releases.size, 1);
});

test('rejects directory traversal attempts and unknown API routes', async (t) => {
  const mock = await startMockGitHub();
  const server = await startServer({
    GITHUB_OWNER: 'owner',
    GITHUB_REPO: 'inbox',
    GITHUB_TOKEN: 'test-token',
    GITHUB_API_BASE: mock.baseUrl,
    GITHUB_UPLOAD_BASE: mock.baseUrl,
  });
  t.after(async () => {
    await server.stop();
    await mock.close();
  });

  const traversal = await fetch(`${server.baseUrl}/%2e%2e/package.json`);
  assert.equal(traversal.status, 404);

  const unknown = await fetch(`${server.baseUrl}/api/unknown`);
  assert.equal(unknown.status, 404);
  const payload = await unknown.json();
  assert.equal(payload.error.code, 'NOT_FOUND');
});
