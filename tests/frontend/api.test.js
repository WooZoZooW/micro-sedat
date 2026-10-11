import test from 'node:test';
import assert from 'node:assert/strict';
import { submitSubmission } from '../../frontend/lib/api.js';

function fakeXhr({
  status = 201,
  responseText = JSON.stringify({ ok: true, submissionId: 'sub-1', status: 'delivered' }),
  outcome = 'load',
  throwOnSend = false,
} = {}) {
  return {
    upload: {},
    headers: {},
    open(method, url) {
      this.method = method;
      this.url = url;
    },
    setRequestHeader(key, value) {
      this.headers[key] = value;
    },
    send(body) {
      this.body = body;
      if (throwOnSend) throw new Error('send failed');
      if (outcome === 'error') {
        this.onerror();
        return;
      }
      if (outcome === 'timeout') {
        this.ontimeout();
        return;
      }
      if (outcome === 'abort') {
        this.onabort();
        return;
      }
      if (this.upload.onprogress) {
        this.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
      }
      this.status = status;
      this.responseText = responseText;
      this.onload();
    },
  };
}

function makeFormData() {
  const form = new FormData();
  form.append('submissionId', 'sub-1');
  form.append('text', 'привет');
  return form;
}

test('resolves with the server payload and reports upload progress', async () => {
  const progress = [];
  const result = await submitSubmission({
    formData: makeFormData(),
    accessCode: 'секрет',
    xhrFactory: () => fakeXhr(),
    onProgress: (percent) => progress.push(percent),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(progress, [50, 100]);
});

test('sends the access code header and posts to the configured base URL', async () => {
  let captured;
  await submitSubmission({
    apiBaseUrl: 'https://api.example.test',
    formData: makeFormData(),
    accessCode: 'code-123',
    xhrFactory: () => {
      captured = fakeXhr();
      return captured;
    },
  });
  assert.equal(captured.url, 'https://api.example.test/api/submissions');
  assert.equal(captured.headers['X-Access-Code'], 'code-123');
  assert.equal(captured.headers.Accept, 'application/json');
});

test('maps server error codes to client error codes', async () => {
  await assert.rejects(
    () => submitSubmission({
      formData: makeFormData(),
      xhrFactory: () => fakeXhr({
        status: 401,
        responseText: JSON.stringify({ ok: false, error: { code: 'ACCESS_CODE_INVALID', message: 'nope' } }),
      }),
    }),
    (error) => error.code === 'ACCESS_CODE_INVALID',
  );

  await assert.rejects(
    () => submitSubmission({
      formData: makeFormData(),
      xhrFactory: () => fakeXhr({ status: 503, responseText: 'not json' }),
    }),
    (error) => error.code === 'HTTP_503',
  );
});

test('reports network, timeout and abort failures accurately', async () => {
  await assert.rejects(
    () => submitSubmission({ formData: makeFormData(), xhrFactory: () => fakeXhr({ outcome: 'error' }) }),
    (error) => error.code === 'NETWORK_ERROR',
  );
  await assert.rejects(
    () => submitSubmission({ formData: makeFormData(), xhrFactory: () => fakeXhr({ outcome: 'timeout' }) }),
    (error) => error.code === 'TIMEOUT',
  );
  await assert.rejects(
    () => submitSubmission({ formData: makeFormData(), xhrFactory: () => fakeXhr({ outcome: 'abort' }) }),
    (error) => error.code === 'ABORTED',
  );
});

test('rejects when send throws synchronously', async () => {
  await assert.rejects(
    () => submitSubmission({ formData: makeFormData(), xhrFactory: () => fakeXhr({ throwOnSend: true }) }),
    (error) => error.code === 'NETWORK_ERROR',
  );
});
