import test from 'node:test';
import assert from 'node:assert/strict';
import { startMockGitHub } from './helpers/mock-github.js';
import { createGitHubDelivery } from '../src/github.js';

function assetFile(bytes, name, type) {
  return { blob: new File([new Uint8Array(bytes)], name, { type }), name, type };
}

function makeSubmission(id, { text = 'Привет', files = [], audio = null } = {}) {
  return {
    id,
    text,
    createdAt: null,
    audio: audio
      ? {
        blob: audio.blob,
        name: audio.name,
        type: audio.type,
        size: audio.blob.size,
        durationMs: 2500,
        asset: audio.name,
      }
      : null,
    files: files.map((file, index) => ({
      blob: file.blob,
      name: file.name,
      type: file.type,
      size: file.blob.size,
      asset: `${String(index + 1).padStart(2, '0')}-${file.name}`,
    })),
  };
}

function makeMeta(id, mode = 'release') {
  return {
    schema: 'micro-sedat/submission@1',
    id,
    status: 'delivered',
    receivedAt: new Date().toISOString(),
    text: 'Привет',
    audio: null,
    files: [],
    delivery: { mode, repo: 'owner/inbox', releaseTag: `sub-${id}` },
  };
}

function deliveryFor(mock, mode = 'release') {
  return createGitHubDelivery({
    owner: 'owner',
    repo: 'inbox',
    token: 'test-token',
    mode,
    apiBase: mock.baseUrl,
    uploadBase: mock.baseUrl,
  });
}

test('release mode uploads raw bytes, publishes and stores metadata', async () => {
  const mock = await startMockGitHub();
  try {
    const delivery = deliveryFor(mock);
    const submission = makeSubmission('sub-11111111', {
      files: [assetFile([1, 2, 3], 'photo.jpg', 'image/jpeg')],
      audio: assetFile([9, 8, 7], 'recording.m4a', 'audio/mp4'),
    });

    const info = await delivery.deliver(submission, makeMeta(submission.id));
    assert.equal(info.mode, 'release');
    assert.equal(info.assets, 2);

    const releaseId = mock.state.releaseIdByTag.get('sub-sub-11111111');
    assert.ok(releaseId, 'release tag should exist');
    const assets = mock.getAssets(releaseId);
    assert.deepEqual(assets.map((asset) => asset.name).sort(), ['01-photo.jpg', 'recording.m4a']);
    assert.deepEqual([...mock.getAssetBytes(releaseId, '01-photo.jpg')], [1, 2, 3]);
    assert.deepEqual([...mock.getAssetBytes(releaseId, 'recording.m4a')], [9, 8, 7]);
    assert.equal(mock.state.releases.get(releaseId).draft, false);

    const stored = mock.getMetadata(`submissions/${submission.id}.json`);
    assert.equal(stored.id, submission.id);
    assert.equal(stored.status, 'delivered');
  } finally {
    await mock.close();
  }
});

test('detects existing submissions through metadata', async () => {
  const mock = await startMockGitHub();
  try {
    const delivery = deliveryFor(mock);
    const before = await delivery.getSubmissionMeta('sub-22222222');
    assert.equal(before.exists, false);

    const submission = makeSubmission('sub-22222222', { text: 'тест' });
    await delivery.deliver(submission, makeMeta(submission.id));

    const after = await delivery.getSubmissionMeta('sub-22222222');
    assert.equal(after.exists, true);
    assert.equal(after.meta.id, 'sub-22222222');
  } finally {
    await mock.close();
  }
});

test('maps rate limiting to GITHUB_RATE_LIMITED', async () => {
  const mock = await startMockGitHub();
  try {
    mock.state.rateLimitNext = true;
    const delivery = deliveryFor(mock);
    await assert.rejects(
      () => delivery.getSubmissionMeta('sub-33333333'),
      (error) => error.code === 'GITHUB_RATE_LIMITED' && error.status === 503,
    );
  } finally {
    await mock.close();
  }
});

test('maps authentication failures to GITHUB_AUTH_FAILED', async () => {
  const mock = await startMockGitHub();
  try {
    mock.state.authFailure = true;
    const delivery = deliveryFor(mock);
    await assert.rejects(
      () => delivery.getSubmissionMeta('sub-44444444'),
      (error) => error.code === 'GITHUB_AUTH_FAILED' && error.status === 502,
    );
  } finally {
    await mock.close();
  }
});

test('cleans up the draft release when a partial upload fails', async () => {
  const mock = await startMockGitHub();
  try {
    mock.state.failNextAssetUpload = true;
    const delivery = deliveryFor(mock);
    const submission = makeSubmission('sub-55555555', {
      files: [assetFile([1], 'a.txt', 'text/plain')],
    });

    await assert.rejects(
      () => delivery.deliver(submission, makeMeta(submission.id)),
      (error) => error.code === 'GITHUB_DELIVERY_FAILED',
    );
    assert.equal(mock.state.releaseIdByTag.has('sub-sub-55555555'), false);
    assert.equal(mock.getMetadata(`submissions/${submission.id}.json`), null);
  } finally {
    await mock.close();
  }
});

test('reports conflicts when the release tag already exists', async () => {
  const mock = await startMockGitHub();
  try {
    const delivery = deliveryFor(mock);
    const submission = makeSubmission('sub-66666666', { text: 'a' });
    await delivery.deliver(submission, makeMeta(submission.id));
    await assert.rejects(
      () => delivery.deliver(submission, makeMeta(submission.id)),
      (error) => error.code === 'GITHUB_CONFLICT',
    );
  } finally {
    await mock.close();
  }
});

test('contents mode stores files and metadata through the contents API', async () => {
  const mock = await startMockGitHub();
  try {
    const delivery = deliveryFor(mock, 'contents');
    const submission = makeSubmission('sub-77777777', {
      files: [assetFile([5, 5], 'note.txt', 'text/plain')],
    });
    const info = await delivery.deliver(submission, makeMeta(submission.id, 'contents'));
    assert.equal(info.mode, 'contents');
    assert.ok(mock.state.contents.has('submissions/sub-77777777/files/01-note.txt'));
    assert.equal(mock.getMetadata('submissions/sub-77777777.json').id, 'sub-77777777');
  } finally {
    await mock.close();
  }
});
