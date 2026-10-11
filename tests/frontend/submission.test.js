import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_LIMITS,
  createDraft,
  validateDraft,
  buildFormData,
  draftTotalBytes,
  summarizePayload,
} from '../../frontend/lib/submission.js';

function makeAttachment(name, size, type = 'application/octet-stream') {
  return {
    id: `att-${name}`,
    file: new File([new Uint8Array(size).fill(1)], name, { type }),
    name,
    type,
    size,
    previewUrl: null,
  };
}

test('createDraft produces a valid unique identifier and empty content', () => {
  const draft = createDraft();
  assert.match(draft.id, /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/);
  assert.equal(draft.text, '');
  assert.equal(draft.audio, null);
  assert.deepEqual(draft.files, []);
  const other = createDraft();
  assert.notEqual(draft.id, other.id);
});

test('validateDraft rejects an empty submission and allows each content kind', () => {
  const empty = validateDraft(createDraft());
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.errors, ['EMPTY_SUBMISSION']);

  const withText = createDraft();
  withText.text = 'Измените заголовок';
  assert.equal(validateDraft(withText).ok, true);

  const withFile = createDraft();
  withFile.files.push(makeAttachment('photo.jpg', 10, 'image/jpeg'));
  assert.equal(validateDraft(withFile).ok, true);

  const withAudio = createDraft();
  withAudio.audio = { blob: new File([new Uint8Array(10)], 'r.m4a', { type: 'audio/mp4' }), name: 'r.m4a', type: 'audio/mp4', durationMs: 1200 };
  assert.equal(validateDraft(withAudio).ok, true);
});

test('validateDraft enforces client-side limits', () => {
  const many = createDraft();
  for (let i = 0; i <= CLIENT_LIMITS.maxFiles; i += 1) many.files.push(makeAttachment(`f${i}.txt`, 4));
  assert.ok(validateDraft(many).errors.includes('TOO_MANY_FILES'));

  const big = createDraft();
  big.files.push({ ...makeAttachment('big.bin', CLIENT_LIMITS.maxFileBytes + 1), size: CLIENT_LIMITS.maxFileBytes + 1 });
  assert.ok(validateDraft(big).errors.includes('FILE_TOO_LARGE'));

  const longText = createDraft();
  longText.text = 'я'.repeat(CLIENT_LIMITS.maxTextChars + 1);
  assert.ok(validateDraft(longText).errors.includes('TEXT_TOO_LONG'));

  const broken = createDraft();
  broken.id = 'bad id!';
  assert.ok(validateDraft(broken).errors.includes('INVALID_SUBMISSION_ID'));
});

test('buildFormData serializes all submission fields', () => {
  const draft = createDraft();
  draft.text = '  Текст с пробелами  ';
  draft.audio = {
    blob: new File([new Uint8Array([1, 2])], 'recording.m4a', { type: 'audio/mp4' }),
    name: 'recording.m4a',
    type: 'audio/mp4',
    durationMs: 2500,
  };
  draft.files.push(makeAttachment('note.txt', 3, 'text/plain'));

  const form = buildFormData(draft);
  assert.equal(form.get('submissionId'), draft.id);
  assert.equal(form.get('createdAt'), draft.createdAt);
  assert.equal(form.get('text'), 'Текст с пробелами');
  assert.equal(form.get('durationMs'), '2500');
  const audio = form.get('audio');
  assert.equal(audio.name, 'recording.m4a');
  assert.equal(audio.type, 'audio/mp4');
  const file = form.get('files');
  assert.equal(file.name, 'note.txt');
});

test('buildFormData omits empty text and supports overrides', () => {
  const draft = createDraft();
  draft.files.push(makeAttachment('a.bin', 2));
  const form = buildFormData(draft, { submissionId: 'sub-override01', createdAt: '2025-01-01T00:00:00.000Z' });
  assert.equal(form.get('submissionId'), 'sub-override01');
  assert.equal(form.get('createdAt'), '2025-01-01T00:00:00.000Z');
  assert.equal(form.get('text'), null);
  assert.equal(form.get('audio'), null);
});

test('draftTotalBytes and summarizePayload aggregate sizes', () => {
  const draft = createDraft();
  draft.text = 'привет';
  draft.files.push(makeAttachment('a.bin', 5), makeAttachment('b.bin', 7));
  draft.audio = { blob: new File([new Uint8Array(9)], 'r.webm', { type: 'audio/webm' }), name: 'r.webm', type: 'audio/webm', durationMs: 500 };
  assert.equal(draftTotalBytes(draft), 21);
  assert.deepEqual(summarizePayload(draft), { audio: 1, files: 2, textChars: 6, totalBytes: 21 });
});
