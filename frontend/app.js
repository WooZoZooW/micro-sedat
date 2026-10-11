import { formatBytes, formatDuration, shortSubmissionId } from './lib/format.js';
import { uniqueName, isImageFile, fileExtensionLabel } from './lib/names.js';
import { pickRecorderMime, extensionForAudioMime } from './lib/mime.js';
import {
  CLIENT_LIMITS,
  createDraft,
  createSubmissionId,
  validateDraft,
  buildFormData,
  draftTotalBytes,
} from './lib/submission.js';
import { createStateMachine } from './lib/state.js';
import { submitSubmission, fetchHealth } from './lib/api.js';
import { messageForCode, messageForErrors } from './lib/errors.js';
import {
  saveDraft,
  loadDraft,
  clearDraft,
  isSupported as isDraftStoreSupported,
  draftToRecord,
  recordToDraft,
} from './lib/draft-store.js';

const MAX_RECORDING_MS = 10 * 60 * 1000;
const MIN_RECORDING_MS = 400;
const ACCESS_CODE_STORAGE_KEY = 'micro-sedat:access-code';

const runtimeConfig = window.MICRO_SEDAT_CONFIG && typeof window.MICRO_SEDAT_CONFIG === 'object'
  ? window.MICRO_SEDAT_CONFIG
  : {};
const apiBaseUrl = typeof runtimeConfig.apiBaseUrl === 'string'
  ? runtimeConfig.apiBaseUrl.replace(/\/+$/, '')
  : '';

const elements = {
  recordButton: document.getElementById('record-button'),
  recordTimer: document.getElementById('record-timer'),
  recordHint: document.getElementById('record-hint'),
  recordError: document.getElementById('record-error'),
  audioPreview: document.getElementById('audio-preview'),
  audioPlayer: document.getElementById('audio-player'),
  discardAudio: document.getElementById('discard-audio'),
  fileInput: document.getElementById('file-input'),
  addFiles: document.getElementById('add-files'),
  attachmentList: document.getElementById('attachment-list'),
  instructions: document.getElementById('instructions'),
  textCounter: document.getElementById('text-counter'),
  restoreBanner: document.getElementById('restore-banner'),
  restoreDraft: document.getElementById('restore-draft'),
  deleteDraft: document.getElementById('delete-draft'),
  submitButton: document.getElementById('submit-button'),
  progress: document.getElementById('progress'),
  progressBar: document.getElementById('progress-bar'),
  status: document.getElementById('status'),
  codeDialog: document.getElementById('code-dialog'),
  codeInput: document.getElementById('code-input'),
  codeError: document.getElementById('code-error'),
  codeSave: document.getElementById('code-save'),
  codeCancel: document.getElementById('code-cancel'),
};

const state = createStateMachine('idle');
const draftStoreAvailable = isDraftStoreSupported();

let draft = createDraft();
let recording = null;
let pressActive = false;
let pendingRelease = false;
let pendingRestore = null;
let persistTimer = null;

function getAccessCode() {
  if (typeof runtimeConfig.accessCode === 'string' && runtimeConfig.accessCode.trim()) {
    return runtimeConfig.accessCode.trim();
  }
  try {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const fromHash = fragment.get('code');
    if (fromHash) {
      setAccessCode(fromHash);
      return fromHash;
    }
  } catch {
    // Ignore malformed fragments.
  }
  try {
    return (window.localStorage.getItem(ACCESS_CODE_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

function setAccessCode(value) {
  try {
    window.localStorage.setItem(ACCESS_CODE_STORAGE_KEY, value);
  } catch {
    // Storage may be unavailable in private mode; the dialog will ask again.
  }
}

function showStatus(message, tone = 'info') {
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
  elements.status.hidden = false;
}

function clearStatus() {
  elements.status.textContent = '';
  elements.status.hidden = true;
}

function showRecordError(code) {
  if (!code) {
    elements.recordError.hidden = true;
    elements.recordError.textContent = '';
    return;
  }
  elements.recordError.textContent = messageForCode(code);
  elements.recordError.hidden = false;
}

function resetRecordingInterface() {
  elements.recordButton.classList.remove('is-recording');
  elements.recordButton.setAttribute('aria-pressed', 'false');
  elements.recordTimer.hidden = true;
  elements.recordTimer.textContent = '00:00';
  elements.recordHint.textContent = 'Нажмите и удерживайте кнопку, чтобы записать сообщение. Отпустите, чтобы закончить.';
}

function stopStream(stream) {
  try {
    for (const track of stream?.getTracks?.() || []) track.stop();
  } catch {
    // Tracks may already be stopped.
  }
}

function revokeUrl(url) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Ignore revoke errors.
  }
}

function updateInterface() {
  const current = state.get();
  const isSubmitting = current === 'submitting';
  const hasContent = Boolean(draft.audio || draft.files.length > 0 || draft.text.trim().length > 0);

  elements.submitButton.disabled = isSubmitting || !hasContent;
  elements.submitButton.textContent = current === 'error' && hasContent ? 'Повторить отправку' : 'Отправить';
  elements.recordButton.disabled = isSubmitting;
  elements.addFiles.disabled = isSubmitting;
  elements.instructions.disabled = isSubmitting;
  elements.textCounter.textContent = `${draft.text.length} / ${CLIENT_LIMITS.maxTextChars}`;

  if (draft.audio?.previewUrl) {
    elements.audioPreview.hidden = false;
    if (elements.audioPlayer.getAttribute('src') !== draft.audio.previewUrl) {
      elements.audioPlayer.setAttribute('src', draft.audio.previewUrl);
    }
  } else {
    elements.audioPreview.hidden = true;
    elements.audioPlayer.pause();
    elements.audioPlayer.removeAttribute('src');
  }
}

function renderAttachments() {
  elements.attachmentList.replaceChildren();
  for (const attachment of draft.files) {
    const item = document.createElement('li');
    item.className = 'attachment';

    if (attachment.previewUrl) {
      const image = document.createElement('img');
      image.className = 'attachment__thumb';
      image.src = attachment.previewUrl;
      image.alt = '';
      image.loading = 'lazy';
      item.appendChild(image);
    } else {
      const badge = document.createElement('span');
      badge.className = 'attachment__badge';
      badge.textContent = fileExtensionLabel(attachment.name);
      item.appendChild(badge);
    }

    const meta = document.createElement('div');
    meta.className = 'attachment__meta';
    const name = document.createElement('span');
    name.className = 'attachment__name';
    name.textContent = attachment.name;
    const size = document.createElement('span');
    size.className = 'attachment__size';
    size.textContent = formatBytes(attachment.size);
    meta.append(name, size);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'attachment__remove';
    remove.textContent = 'Удалить';
    remove.setAttribute('aria-label', `Удалить вложение ${attachment.name}`);
    remove.addEventListener('click', () => removeAttachment(attachment.id));

    item.append(meta, remove);
    elements.attachmentList.appendChild(item);
  }
}

function removeAttachment(id) {
  const index = draft.files.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [removed] = draft.files.splice(index, 1);
  revokeUrl(removed?.previewUrl);
  renderAttachments();
  updateInterface();
  clearStatus();
  persistDraftSoon();
}

function addFiles(fileList) {
  const incoming = Array.from(fileList || []);
  if (incoming.length === 0) return;
  const errors = [];

  for (const file of incoming) {
    if (!file || typeof file.size !== 'number' || file.size === 0) {
      errors.push('EMPTY_FILE');
      continue;
    }
    if (draft.files.length >= CLIENT_LIMITS.maxFiles) {
      errors.push('TOO_MANY_FILES');
      break;
    }
    if (file.size > CLIENT_LIMITS.maxFileBytes) {
      errors.push('FILE_TOO_LARGE');
      continue;
    }
    if (draftTotalBytes(draft) + file.size > CLIENT_LIMITS.maxTotalBytes) {
      errors.push('SUBMISSION_TOO_LARGE');
      break;
    }

    const name = uniqueName(
      typeof file.name === 'string' && file.name.length > 0 ? file.name : 'file',
      draft.files.map((item) => item.name),
    );
    const attachment = {
      id: createSubmissionId(),
      file,
      name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      previewUrl: null,
    };
    if (isImageFile(file)) {
      try {
        attachment.previewUrl = URL.createObjectURL(file);
      } catch {
        attachment.previewUrl = null;
      }
    }
    draft.files.push(attachment);
  }

  renderAttachments();
  updateInterface();
  if (errors.length > 0) {
    showStatus(messageForErrors(errors), 'error');
  } else {
    clearStatus();
  }
  persistDraftSoon();
}

function persistDraftSoon() {
  if (!draftStoreAvailable) return;
  if (persistTimer) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    void saveDraft(draftToRecord(draft));
  }, 400);
}

function applyDraft(next) {
  draft = next;
  for (const attachment of draft.files) {
    if (isImageFile(attachment.file) && !attachment.previewUrl) {
      try {
        attachment.previewUrl = URL.createObjectURL(attachment.file);
      } catch {
        attachment.previewUrl = null;
      }
    }
  }
  elements.instructions.value = draft.text;
  renderAttachments();
  updateInterface();
}

async function checkLocalDraft() {
  if (!draftStoreAvailable) return;
  const restored = recordToDraft(await loadDraft());
  if (!restored) return;
  const hasContent = Boolean(restored.audio || restored.files.length > 0 || restored.text.trim());
  if (!hasContent) {
    await clearDraft();
    return;
  }
  pendingRestore = restored;
  elements.restoreBanner.hidden = false;
}

function resetDraftContent() {
  revokeUrl(draft.audio?.previewUrl);
  for (const attachment of draft.files) revokeUrl(attachment.previewUrl);
  draft = createDraft();
  elements.instructions.value = '';
  renderAttachments();
  updateInterface();
}

function updateTimer(current) {
  if (recording !== current) return;
  const elapsed = Date.now() - current.startedAt;
  elements.recordTimer.textContent = formatDuration(elapsed);
  if (elapsed >= MAX_RECORDING_MS) {
    showRecordError('RECORDING_TOO_LONG');
    stopRecording();
  }
}

function microphoneErrorCode(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'MIC_PERMISSION_DENIED';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'MIC_NOT_FOUND';
    case 'NotReadableError':
    case 'AbortError':
      return 'MIC_BUSY';
    default:
      return 'RECORDING_FAILED';
  }
}

async function startRecording() {
  if (state.get() !== 'idle' || recording) return;

  if (!navigator.mediaDevices
    || typeof navigator.mediaDevices.getUserMedia !== 'function'
    || typeof window.MediaRecorder === 'undefined') {
    showRecordError('RECORDING_UNSUPPORTED');
    return;
  }

  clearStatus();
  showRecordError(null);
  state.to('recording');
  elements.recordButton.classList.add('is-recording');
  elements.recordButton.setAttribute('aria-pressed', 'true');
  elements.recordTimer.hidden = false;
  elements.recordTimer.textContent = '00:00';
  elements.recordHint.textContent = 'Идёт запись. Отпустите кнопку, чтобы завершить.';

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (error) {
    resetRecordingInterface();
    state.to('idle');
    showRecordError(microphoneErrorCode(error));
    return;
  }

  if (state.get() !== 'recording') {
    stopStream(stream);
    return;
  }

  const mime = pickRecorderMime(
    typeof window.MediaRecorder.isTypeSupported === 'function'
      ? (type) => window.MediaRecorder.isTypeSupported(type)
      : null,
  );

  let mediaRecorder;
  try {
    mediaRecorder = mime
      ? new window.MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 })
      : new window.MediaRecorder(stream);
  } catch {
    try {
      mediaRecorder = new window.MediaRecorder(stream);
    } catch {
      stopStream(stream);
      resetRecordingInterface();
      state.to('idle');
      showRecordError('RECORDING_FAILED');
      return;
    }
  }

  const current = {
    mediaRecorder,
    stream,
    chunks: [],
    startedAt: Date.now(),
    timerId: null,
    mimeType: mediaRecorder.mimeType || mime || '',
    cancelled: false,
  };
  recording = current;

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) current.chunks.push(event.data);
  };
  mediaRecorder.onerror = () => {
    if (recording === current) finalizeRecording('error');
  };
  mediaRecorder.onstop = () => {
    if (recording === current) finalizeRecording('stop');
  };

  try {
    mediaRecorder.start(500);
  } catch {
    recording = null;
    stopStream(stream);
    resetRecordingInterface();
    state.to('idle');
    showRecordError('RECORDING_FAILED');
    return;
  }

  current.timerId = window.setInterval(() => updateTimer(current), 250);

  if (pendingRelease || !pressActive) {
    pendingRelease = false;
    stopRecording();
  }
}

function stopRecording() {
  if (!recording) {
    pendingRelease = true;
    return;
  }
  const current = recording;
  try {
    if (current.mediaRecorder.state !== 'inactive') {
      current.mediaRecorder.stop();
    } else {
      finalizeRecording('stop');
    }
  } catch {
    finalizeRecording('stop');
  }
}

function cancelRecording(reason) {
  if (!recording) return;
  const current = recording;
  current.cancelled = true;
  if (reason === 'hidden') showRecordError('RECORDING_CANCELLED');
  try {
    if (current.mediaRecorder.state !== 'inactive') {
      current.mediaRecorder.stop();
    } else {
      finalizeRecording('cancel');
    }
  } catch {
    finalizeRecording('cancel');
  }
}

function finalizeRecording(result) {
  const current = recording;
  if (!current) return;
  recording = null;
  if (current.timerId) window.clearInterval(current.timerId);
  stopStream(current.stream);
  resetRecordingInterface();

  if (current.cancelled || result === 'cancel') {
    if (state.get() === 'recording') state.to('idle');
    updateInterface();
    return;
  }

  const durationMs = Math.max(0, Date.now() - current.startedAt);
  const chunks = current.chunks || [];

  if (chunks.length === 0 || durationMs < MIN_RECORDING_MS) {
    showRecordError('RECORDING_TOO_SHORT');
    if (state.get() === 'recording') state.to('idle');
    updateInterface();
    return;
  }

  const type = current.mimeType || chunks[0]?.type || 'audio/mp4';
  const blob = new Blob(chunks, { type });
  if (blob.size === 0) {
    showRecordError('RECORDING_FAILED');
    if (state.get() === 'recording') state.to('idle');
    updateInterface();
    return;
  }

  revokeUrl(draft.audio?.previewUrl);
  let previewUrl = null;
  try {
    previewUrl = URL.createObjectURL(blob);
  } catch {
    previewUrl = null;
  }
  draft.audio = {
    blob,
    name: `recording.${extensionForAudioMime(type)}`,
    type,
    durationMs,
    previewUrl,
  };

  if (state.get() === 'recording') state.to('idle');
  showRecordError(null);
  updateInterface();
  persistDraftSoon();
}

function openCodeDialog(message) {
  elements.codeError.textContent = message;
  elements.codeError.hidden = false;
  elements.codeDialog.hidden = false;
  elements.codeInput.value = '';
  try {
    elements.codeInput.focus();
  } catch {
    // Focus is best effort.
  }
}

function closeCodeDialog() {
  elements.codeDialog.hidden = true;
}

async function handleSubmit() {
  if (state.get() === 'submitting') return;

  const validation = validateDraft(draft);
  if (!validation.ok) {
    showStatus(messageForErrors(validation.errors), 'error');
    return;
  }

  if (state.get() === 'error') state.to('idle');
  state.to('submitting');
  clearStatus();
  elements.progress.hidden = false;
  elements.progressBar.style.width = '0%';
  updateInterface();

  const formData = buildFormData(draft);

  try {
    const result = await submitSubmission({
      apiBaseUrl,
      accessCode: getAccessCode(),
      formData,
      onProgress: (percent) => {
        elements.progressBar.style.width = `${percent}%`;
        showStatus(`Отправка… ${percent}%`, 'info');
      },
    });

    state.to('delivered');
    showStatus(`Готово. Материалы отправлены. Номер: ${shortSubmissionId(result.submissionId)}`, 'success');
    await clearDraft();
    resetDraftContent();
    state.to('idle');
  } catch (error) {
    const code = error?.code || 'INTERNAL';
    if (code === 'ACCESS_CODE_INVALID' || code === 'ACCESS_CODE_REQUIRED') {
      openCodeDialog(code === 'ACCESS_CODE_REQUIRED' ? 'Введите код доступа.' : 'Неверный код. Попробуйте ещё раз.');
    }
    showStatus(messageForCode(code), 'error');
    state.to('error');
    persistDraftSoon();
  } finally {
    elements.progress.hidden = true;
    elements.progressBar.style.width = '0%';
    updateInterface();
  }
}

function bindHoldInteractions() {
  const button = elements.recordButton;

  const pressStart = () => {
    if (state.get() !== 'idle') return;
    pressActive = true;
    pendingRelease = false;
    void startRecording();
  };

  const pressEnd = () => {
    pressActive = false;
    stopRecording();
  };

  if (typeof window.PointerEvent !== 'undefined') {
    button.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best effort.
      }
      pressStart();
    });
    button.addEventListener('pointerup', (event) => {
      event.preventDefault();
      pressEnd();
    });
    button.addEventListener('pointercancel', (event) => {
      event.preventDefault();
      pressActive = false;
      cancelRecording('pointercancel');
    });
    button.addEventListener('lostpointercapture', () => {
      if (pressActive) {
        pressActive = false;
        stopRecording();
      }
    });
  } else {
    button.addEventListener('touchstart', (event) => {
      event.preventDefault();
      pressStart();
    }, { passive: false });
    button.addEventListener('touchend', (event) => {
      event.preventDefault();
      pressEnd();
    });
    button.addEventListener('touchcancel', () => {
      pressActive = false;
      cancelRecording('touchcancel');
    });
    button.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      pressStart();
    });
    button.addEventListener('mouseup', (event) => {
      event.preventDefault();
      pressEnd();
    });
    button.addEventListener('mouseleave', () => {
      if (pressActive) pressEnd();
    });
  }

  button.addEventListener('keydown', (event) => {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      event.preventDefault();
      pressStart();
    }
  });
  button.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      pressEnd();
    }
  });
  window.addEventListener('keyup', (event) => {
    if (recording && (event.key === ' ' || event.key === 'Enter')) {
      pressActive = false;
      stopRecording();
    }
  });
  button.addEventListener('contextmenu', (event) => event.preventDefault());
}

function bindStaticHandlers() {
  elements.addFiles.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', () => {
    addFiles(elements.fileInput.files);
    elements.fileInput.value = '';
  });

  elements.instructions.addEventListener('input', () => {
    draft.text = elements.instructions.value;
    updateInterface();
    persistDraftSoon();
  });

  elements.discardAudio.addEventListener('click', () => {
    revokeUrl(draft.audio?.previewUrl);
    draft.audio = null;
    updateInterface();
    showRecordError(null);
    clearStatus();
    persistDraftSoon();
  });

  elements.submitButton.addEventListener('click', () => {
    void handleSubmit();
  });

  elements.restoreDraft.addEventListener('click', async () => {
    const restored = pendingRestore || recordToDraft(await loadDraft());
    if (!restored) return;
    applyDraft(restored);
    pendingRestore = null;
    elements.restoreBanner.hidden = true;
    showStatus('Черновик восстановлен.', 'info');
  });

  elements.deleteDraft.addEventListener('click', async () => {
    pendingRestore = null;
    elements.restoreBanner.hidden = true;
    await clearDraft();
    showStatus('Черновик удалён.', 'info');
  });

  elements.codeSave.addEventListener('click', () => {
    const value = elements.codeInput.value.trim();
    if (!value) {
      elements.codeError.textContent = 'Введите код.';
      elements.codeError.hidden = false;
      return;
    }
    if (/[^\x20-\x7E]/.test(value)) {
      elements.codeError.textContent = 'Код может содержать только латинские буквы, цифры и символы.';
      elements.codeError.hidden = false;
      return;
    }
    setAccessCode(value);
    closeCodeDialog();
    void handleSubmit();
  });

  elements.codeCancel.addEventListener('click', closeCodeDialog);

  elements.codeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      elements.codeSave.click();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && recording) cancelRecording('hidden');
  });
  window.addEventListener('pagehide', () => {
    if (recording) cancelRecording('hidden');
  });
}

async function initialize() {
  resetRecordingInterface();
  renderAttachments();
  updateInterface();
  bindStaticHandlers();
  bindHoldInteractions();
  await checkLocalDraft();

  const health = await fetchHealth({ apiBaseUrl });
  if (health && health.configured === false) {
    showStatus(messageForCode('SERVER_NOT_CONFIGURED'), 'info');
  }
}

void initialize();
