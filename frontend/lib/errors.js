export const ERROR_MESSAGES_RU = Object.freeze({
  RECORDING_UNSUPPORTED: 'Запись с микрофона не поддерживается этим браузером. Откройте сайт в актуальном Safari.',
  MIC_PERMISSION_DENIED: 'Нет доступа к микрофону. Разрешите доступ в настройках Safari и попробуйте снова.',
  MIC_NOT_FOUND: 'Микрофон не найден.',
  MIC_BUSY: 'Микрофон занят другим приложением.',
  RECORDING_FAILED: 'Не удалось начать запись. Попробуйте ещё раз.',
  RECORDING_TOO_SHORT: 'Запись получилась слишком короткой. Удерживайте кнопку дольше.',
  RECORDING_CANCELLED: 'Запись отменена, потому что приложение было свёрнуто.',
  RECORDING_TOO_LONG: 'Достигнута максимальная длительность записи — она сохранена.',
  EMPTY_SUBMISSION: 'Добавьте запись, файл или текст.',
  TEXT_TOO_LONG: 'Текст слишком длинный. Сократите его.',
  TOO_MANY_FILES: 'Слишком много файлов. Удалите лишние.',
  EMPTY_FILE: 'Один из файлов пустой и не был добавлен.',
  FILE_TOO_LARGE: 'Файл слишком большой и не был добавлен.',
  AUDIO_TOO_LARGE: 'Запись слишком длинная или большая.',
  SUBMISSION_TOO_LARGE: 'Общий размер материалов превышает допустимый. Удалите часть файлов.',
  INVALID_SUBMISSION_ID: 'Внутренняя ошибка: обновите страницу и попробуйте снова.',
  ACCESS_CODE_REQUIRED: 'Введите код доступа.',
  ACCESS_CODE_INVALID: 'Неверный код доступа.',
  ORIGIN_NOT_ALLOWED: 'С этого адреса отправка запрещена.',
  SERVER_NOT_CONFIGURED: 'Сервер ещё не настроен. Сообщите владельцу сайта.',
  RATE_LIMITED: 'Слишком много попыток. Подождите немного и повторите.',
  PAYLOAD_TOO_LARGE: 'Материалы слишком большие. Уменьшите размер и попробуйте снова.',
  NETWORK_ERROR: 'Нет соединения. Проверьте интернет и повторите отправку.',
  TIMEOUT: 'Превышено время ожидания. Попробуйте ещё раз.',
  ABORTED: 'Отправка прервана.',
  GITHUB_AUTH_FAILED: 'Сервер не смог подключиться к хранилищу. Сообщите владельцу сайта.',
  GITHUB_NOT_FOUND: 'Хранилище не найдено. Сообщите владельцу сайта.',
  GITHUB_RATE_LIMITED: 'Хранилище временно недоступно. Повторите попытку позже.',
  GITHUB_FORBIDDEN: 'Недостаточно прав для сохранения. Сообщите владельцу сайта.',
  GITHUB_CONFLICT: 'Конфликт при сохранении. Попробуйте отправить ещё раз.',
  GITHUB_DELIVERY_FAILED: 'Не удалось сохранить материалы. Попробуйте ещё раз.',
  GITHUB_UNREACHABLE: 'Хранилище недоступно. Попробуйте ещё раз.',
  DUPLICATE_SUBMISSION: 'Это сообщение уже отправлено.',
  NOT_FOUND: 'Сервис недоступен. Сообщите владельцу сайта.',
  INTERNAL: 'Неожиданная ошибка сервера. Попробуйте ещё раз.',
});

export function messageForCode(code) {
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES_RU, code)) {
    return ERROR_MESSAGES_RU[code];
  }
  return 'Не удалось выполнить действие. Попробуйте ещё раз.';
}

export function messageForErrors(codes) {
  const list = Array.isArray(codes) ? codes : [codes];
  return list.filter(Boolean).map(messageForCode).join(' ');
}
