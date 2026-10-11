import test from 'node:test';
import assert from 'node:assert/strict';
import { pickRecorderMime, extensionForAudioMime, RECORDER_MIME_CANDIDATES } from '../../frontend/lib/mime.js';

test('pickRecorderMime prefers Safari-friendly mp4 when supported', () => {
  const supported = new Set(['audio/mp4', 'audio/webm;codecs=opus']);
  const picked = pickRecorderMime((type) => supported.has(type));
  assert.equal(picked, 'audio/mp4');
});

test('pickRecorderMime falls back to webm for Chrome-like browsers', () => {
  const supported = new Set(['audio/webm;codecs=opus', 'audio/webm']);
  const picked = pickRecorderMime((type) => supported.has(type));
  assert.equal(picked, 'audio/webm;codecs=opus');
});

test('pickRecorderMime returns null when nothing is supported', () => {
  assert.equal(pickRecorderMime(() => false), null);
  assert.equal(pickRecorderMime(null), null);
});

test('pickRecorderMime tolerates throwing probes', () => {
  let calls = 0;
  const picked = pickRecorderMime((type) => {
    calls += 1;
    if (type.includes('codecs')) throw new Error('probe failed');
    return type === 'audio/mp4';
  });
  assert.equal(picked, 'audio/mp4');
  assert.ok(calls >= 2);
});

test('candidate list covers both Apple and Chromium codecs', () => {
  assert.ok(RECORDER_MIME_CANDIDATES.some((type) => type.startsWith('audio/mp4')));
  assert.ok(RECORDER_MIME_CANDIDATES.some((type) => type.startsWith('audio/webm')));
});

test('extensionForAudioMime maps recorded MIME types', () => {
  assert.equal(extensionForAudioMime('audio/mp4;codecs=mp4a.40.2'), 'm4a');
  assert.equal(extensionForAudioMime('audio/webm;codecs=opus'), 'webm');
  assert.equal(extensionForAudioMime('audio/ogg'), 'ogg');
  assert.equal(extensionForAudioMime('audio/mpeg'), 'mp3');
  assert.equal(extensionForAudioMime(''), 'bin');
});
