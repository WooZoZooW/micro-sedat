import test from 'node:test';
import assert from 'node:assert/strict';
import {
  draftToRecord,
  recordToDraft,
  isSupported,
} from '../../frontend/lib/draft-store.js';

test('reports IndexedDB availability honestly (Node has no indexedDB)', () => {
  assert.equal(isSupported(), false);
});

test('draftToRecord strips UI-only fields and keeps binary blobs', () => {
  const draft = {
    id: 'sub-12345678',
    createdAt: '2025-05-01T10:00:00.000Z',
    text: 'привет',
    audio: {
      blob: new File([new Uint8Array(4)], 'recording.m4a', { type: 'audio/mp4' }),
      name: 'recording.m4a',
      type: 'audio/mp4',
      durationMs: 1200,
      previewUrl: 'blob:fake',
    },
    files: [
      {
        id: 'att-1',
        file: new File([new Uint8Array(2)], 'a.txt', { type: 'text/plain' }),
        name: 'a.txt',
        type: 'text/plain',
        size: 2,
        previewUrl: 'blob:fake2',
      },
    ],
  };
  const record = draftToRecord(draft);
  assert.equal(record.id, 'sub-12345678');
  assert.equal(record.audio.durationMs, 1200);
  assert.equal(record.audio.blob.size, 4);
  assert.equal(record.files.length, 1);
  assert.equal(record.files[0].blob.size, 2);
  assert.equal('previewUrl' in record, false);
  assert.equal('previewUrl' in record.files[0], false);
});

test('recordToDraft restores attachments with fresh UI ids', () => {
  const record = {
    id: 'sub-87654321',
    createdAt: '2025-05-01T10:00:00.000Z',
    text: 'текст',
    audio: {
      blob: new File([new Uint8Array(3)], 'r.webm', { type: 'audio/webm' }),
      name: 'r.webm',
      type: 'audio/webm',
      durationMs: 500,
    },
    files: [
      { blob: new File([new Uint8Array(1)], 'x.bin', { type: 'application/octet-stream' }), name: 'x.bin', type: 'application/octet-stream' },
    ],
  };
  const draft = recordToDraft(record);
  assert.equal(draft.id, 'sub-87654321');
  assert.equal(draft.audio.name, 'r.webm');
  assert.equal(draft.files.length, 1);
  assert.ok(draft.files[0].id);
  assert.equal(draft.files[0].previewUrl, null);
  assert.equal(draft.files[0].size, 1);
});

test('handles missing or malformed persisted records gracefully', () => {
  assert.equal(recordToDraft(null), null);
  assert.equal(recordToDraft(undefined), null);
  assert.equal(draftToRecord(null), null);
  const draft = recordToDraft({ files: [null, { name: 'no-blob.txt' }] });
  assert.equal(draft.files.length, 0);
});
