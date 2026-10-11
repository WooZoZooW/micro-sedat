import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatDuration, shortSubmissionId } from '../../frontend/lib/format.js';

test('formatBytes renders Russian unit labels', () => {
  assert.equal(formatBytes(0), '0 Б');
  assert.equal(formatBytes(512), '512 Б');
  assert.equal(formatBytes(1024), '1 КБ');
  assert.equal(formatBytes(1536), '1.5 КБ');
  assert.equal(formatBytes(15 * 1024 * 1024), '15 МБ');
  assert.equal(formatBytes(2 * 1024 * 1024 * 1024), '2 ГБ');
  assert.equal(formatBytes(-1), '—');
  assert.equal(formatBytes(Number.NaN), '—');
});

test('formatDuration renders mm:ss with padding', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(999), '00:00');
  assert.equal(formatDuration(1000), '00:01');
  assert.equal(formatDuration(61_000), '01:01');
  assert.equal(formatDuration(10 * 60_000), '10:00');
  assert.equal(formatDuration(-5), '00:00');
});

test('shortSubmissionId truncates safely', () => {
  assert.equal(shortSubmissionId('12345678-abcd'), '12345678');
  assert.equal(shortSubmissionId('abc'), 'abc');
  assert.equal(shortSubmissionId(undefined), '');
});
