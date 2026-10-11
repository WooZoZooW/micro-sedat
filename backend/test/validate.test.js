import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIMITS,
  audioAssetName,
  extensionForAudioMime,
  fileAssetName,
  limitsFromEnv,
  sanitizeFilename,
  uniqueFilename,
  validateSubmission,
} from '../src/validate.js';

function makeFile(name, type, byteCount = 16) {
  return new File([new Uint8Array(byteCount).fill(65)], name, { type });
}

test('accepts a text-only submission and trims text', () => {
  const result = validateSubmission(
    { submissionId: 'sub-12345678', text: '  Привет  ' },
    DEFAULT_LIMITS,
  );
  assert.equal(result.id, 'sub-12345678');
  assert.equal(result.text, 'Привет');
  assert.equal(result.files.length, 0);
  assert.equal(result.audio, null);
  assert.equal(result.totalBytes, 0);
});

test('accepts audio and files together and assigns asset names', () => {
  const result = validateSubmission(
    {
      submissionId: 'sub-abcdefgh',
      text: '',
      audio: { blob: makeFile('recording.m4a', 'audio/mp4', 32), name: 'recording.m4a', type: 'audio/mp4' },
      files: [
        makeFile('photo.jpg', 'image/jpeg', 10),
        makeFile('photo.jpg', 'image/jpeg', 20),
      ],
    },
    DEFAULT_LIMITS,
  );
  assert.equal(result.audio.asset, 'recording.m4a');
  assert.deepEqual(result.files.map((file) => file.asset), ['01-photo.jpg', '02-photo (2).jpg']);
  assert.equal(result.totalBytes, 62);
});

test('rejects missing or malformed submission ids', () => {
  for (const id of [undefined, '', 'short', 'bad id!', 'x'.repeat(80)]) {
    assert.throws(
      () => validateSubmission({ submissionId: id, text: 'ok' }, DEFAULT_LIMITS),
      (error) => error.code === 'INVALID_SUBMISSION_ID',
    );
  }
});

test('rejects an empty submission', () => {
  assert.throws(
    () => validateSubmission({ submissionId: 'sub-12345678', text: '   ' }, DEFAULT_LIMITS),
    (error) => error.code === 'EMPTY_SUBMISSION',
  );
});

test('rejects oversized files, audio and totals', () => {
  assert.throws(
    () => validateSubmission(
      { submissionId: 'sub-12345678', files: [makeFile('big.bin', 'application/octet-stream', 100)] },
      { ...DEFAULT_LIMITS, maxFileBytes: 50 },
    ),
    (error) => error.code === 'FILE_TOO_LARGE',
  );
  assert.throws(
    () => validateSubmission(
      { submissionId: 'sub-12345678', audio: { blob: makeFile('rec.m4a', 'audio/mp4', 100) } },
      { ...DEFAULT_LIMITS, maxAudioBytes: 50 },
    ),
    (error) => error.code === 'AUDIO_TOO_LARGE',
  );
  assert.throws(
    () => validateSubmission(
      { submissionId: 'sub-12345678', files: [makeFile('big.bin', 'application/octet-stream', 80)] },
      { ...DEFAULT_LIMITS, maxFileBytes: 100, maxTotalBytes: 50 },
    ),
    (error) => error.code === 'SUBMISSION_TOO_LARGE',
  );
});

test('rejects too many files and empty files', () => {
  assert.throws(
    () => validateSubmission(
      {
        submissionId: 'sub-12345678',
        files: [makeFile('a.txt', 'text/plain'), makeFile('b.txt', 'text/plain')],
      },
      { ...DEFAULT_LIMITS, maxFiles: 1 },
    ),
    (error) => error.code === 'TOO_MANY_FILES',
  );
  assert.throws(
    () => validateSubmission(
      { submissionId: 'sub-12345678', files: [makeFile('empty.txt', 'text/plain', 0)] },
      DEFAULT_LIMITS,
    ),
    (error) => error.code === 'EMPTY_FILE',
  );
});

test('rejects non-audio payloads in the audio field', () => {
  assert.throws(
    () => validateSubmission(
      { submissionId: 'sub-12345678', audio: { blob: makeFile('video.mp4', 'video/mp4', 20) } },
      DEFAULT_LIMITS,
    ),
    (error) => error.code === 'INVALID_AUDIO',
  );
});

test('sanitizes filenames and prevents path traversal', () => {
  const traversal = sanitizeFilename('../../etc/passwd');
  assert.equal(traversal.includes('/'), false);
  assert.equal(traversal.includes('\\'), false);
  assert.equal(sanitizeFilename('..'), 'file');
  assert.equal(sanitizeFilename(''), 'file');
  assert.equal(sanitizeFilename('отчёт 2025.pdf'), 'отчёт 2025.pdf');
  const long = sanitizeFilename(`${'a'.repeat(300)}.jpg`);
  assert.ok(long.length <= 120);
  assert.ok(long.endsWith('.jpg'));
});

test('deduplicates identical filenames safely', () => {
  const used = new Set();
  assert.equal(uniqueFilename('photo.jpg', used), 'photo.jpg');
  assert.equal(uniqueFilename('photo.jpg', used), 'photo (2).jpg');
  assert.equal(uniqueFilename('photo.jpg', used), 'photo (3).jpg');
  assert.equal(uniqueFilename('photo.JPG', used), 'photo (4).JPG');
});

test('builds audio asset names with a proper extension', () => {
  assert.equal(audioAssetName({ name: 'recording', type: 'audio/mp4;codecs=mp4a.40.2' }), 'recording.m4a');
  assert.equal(audioAssetName({ name: 'take.webm', type: 'audio/webm' }), 'take.webm');
  assert.equal(audioAssetName({ name: '', type: 'audio/ogg' }), 'recording.ogg');
  assert.equal(extensionForAudioMime('audio/mpeg'), 'mp3');
  assert.equal(extensionForAudioMime('audio/unknown'), 'bin');
  assert.equal(fileAssetName('photo.jpg', 0), '01-photo.jpg');
  assert.equal(fileAssetName('photo.jpg', 11), '12-photo.jpg');
});

test('parses limits from environment with safe fallbacks', () => {
  assert.deepEqual(limitsFromEnv({}), DEFAULT_LIMITS);
  const parsed = limitsFromEnv({
    MAX_TOTAL_BYTES: '1048576',
    MAX_FILE_BYTES: 'not-a-number',
    MAX_FILES: '3',
  });
  assert.equal(parsed.maxTotalBytes, 1048576);
  assert.equal(parsed.maxFileBytes, DEFAULT_LIMITS.maxFileBytes);
  assert.equal(parsed.maxFiles, 3);
});
