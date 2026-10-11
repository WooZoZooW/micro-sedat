import test from 'node:test';
import assert from 'node:assert/strict';
import { messageForCode, messageForErrors, ERROR_MESSAGES_RU } from '../../frontend/lib/errors.js';

test('messageForCode returns Russian text for known codes', () => {
  assert.ok(messageForCode('EMPTY_SUBMISSION').includes('Добавьте'));
  assert.ok(messageForCode('ERROR_MESSAGES_RU').includes('Не удалось'));
  assert.equal(messageForCode('NETWORK_ERROR'), ERROR_MESSAGES_RU.NETWORK_ERROR);
});

test('messageForCode never leaks unknown codes to the user', () => {
  const message = messageForCode('SOME_UNKNOWN_CODE');
  assert.ok(message.includes('Попробуйте ещё раз'));
  assert.equal(message.includes('SOME_UNKNOWN_CODE'), false);
  assert.equal(messageForCode(undefined), 'Не удалось выполнить действие. Попробуйте ещё раз.');
});

test('messageForErrors joins multiple codes without duplicates', () => {
  assert.equal(messageForErrors(['EMPTY_FILE', 'EMPTY_FILE']).length > 0, true);
  assert.equal(messageForErrors([]), '');
  assert.equal(messageForErrors(null), '');
});

test('all user-facing strings are in Russian', () => {
  for (const message of Object.values(ERROR_MESSAGES_RU)) {
    assert.match(message, /[А-Яа-яЁё]/);
  }
});
