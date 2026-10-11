import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFilename, uniqueName, isImageFile, fileExtensionLabel } from '../../frontend/lib/names.js';

test('sanitizeFilename removes path separators and control characters', () => {
  assert.equal(sanitizeFilename('../../evil.sh').includes('/'), false);
  assert.equal(sanitizeFilename('..\\..\\evil.sh').includes('\\'), false);
  assert.equal(sanitizeFilename('bad\u0000name.txt'), 'badname.txt');
  assert.equal(sanitizeFilename(''), 'файл');
  assert.equal(sanitizeFilename('..'), 'файл');
  assert.equal(sanitizeFilename('фото 1.jpg'), 'фото 1.jpg');
});

test('uniqueName generates safe duplicate names without overwriting', () => {
  const existing = ['photo.jpg', 'photo (2).jpg'];
  assert.equal(uniqueName('photo.jpg', existing), 'photo (3).jpg');
  assert.equal(uniqueName('other.jpg', existing), 'other.jpg');
  assert.equal(uniqueName('PHOTO.JPG', existing), 'PHOTO (3).JPG');
});

test('isImageFile detects image MIME types', () => {
  assert.equal(isImageFile({ type: 'image/jpeg' }), true);
  assert.equal(isImageFile({ type: 'image/heic' }), true);
  assert.equal(isImageFile({ type: 'application/pdf' }), false);
  assert.equal(isImageFile(null), false);
});

test('fileExtensionLabel produces short uppercase labels', () => {
  assert.equal(fileExtensionLabel('report.pdf'), 'PDF');
  assert.equal(fileExtensionLabel('archive.tar.gz'), 'GZ');
  assert.equal(fileExtensionLabel('noextension'), 'ФАЙЛ');
  assert.equal(fileExtensionLabel(''), 'ФАЙЛ');
});
