import { extensionForAudioMime } from './mime.js';

export const CLIENT_LIMITS = Object.freeze({
  maxTotalBytes: 20 * 1024 * 1024,
  maxFileBytes: 15 * 1024 * 1024,
  maxAudioBytes: 15 * 1024 * 1024,
  maxFiles: 12,
  maxTextChars: 4000,
});

const SUBMISSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;

export function createSubmissionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDraft(now = new Date()) {
  return {
    id: createSubmissionId(),
    createdAt: now.toISOString(),
    text: '',
    audio: null,
    files: [],
  };
}

export function draftTotalBytes(draft) {
  const audioBytes = draft?.audio?.blob?.size || 0;
  const fileBytes = (draft?.files || []).reduce((sum, file) => sum + (file?.size || 0), 0);
  return audioBytes + fileBytes;
}

export function validateDraft(draft, limits = CLIENT_LIMITS) {
  const errors = [];
  if (!draft || typeof draft !== 'object') {
    return { ok: false, errors: ['EMPTY_SUBMISSION'] };
  }
  const text = typeof draft.text === 'string' ? draft.text.trim() : '';
  if (text.length > limits.maxTextChars) errors.push('TEXT_TOO_LONG');
  if (!SUBMISSION_ID_RE.test(draft.id || '')) errors.push('INVALID_SUBMISSION_ID');

  const audio = draft.audio?.blob && draft.audio.blob.size > 0 ? draft.audio : null;
  const files = Array.isArray(draft.files) ? draft.files : [];

  if (!text && !audio && files.length === 0) errors.push('EMPTY_SUBMISSION');
  if (files.length > limits.maxFiles) errors.push('TOO_MANY_FILES');

  for (const file of files) {
    if (!file || !file.size) {
      errors.push('EMPTY_FILE');
    } else if (file.size > limits.maxFileBytes) {
      errors.push('FILE_TOO_LARGE');
    }
  }
  if (audio && audio.blob.size > limits.maxAudioBytes) errors.push('AUDIO_TOO_LARGE');
  if (draftTotalBytes(draft) > limits.maxTotalBytes) errors.push('SUBMISSION_TOO_LARGE');

  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

export function buildFormData(draft, { submissionId, createdAt, durationMs } = {}) {
  const form = new FormData();
  form.append('submissionId', submissionId || draft.id);
  form.append('createdAt', createdAt || draft.createdAt);
  const text = typeof draft.text === 'string' ? draft.text.trim() : '';
  if (text) form.append('text', text);
  if (draft.audio?.blob) {
    const type = draft.audio.type || 'audio/mp4';
    const name = draft.audio.name || `recording.${extensionForAudioMime(type)}`;
    form.append('audio', draft.audio.blob, name);
    form.append('durationMs', String(Math.max(0, Math.round(durationMs ?? draft.audio.durationMs ?? 0))));
  }
  for (const file of draft.files || []) {
    const blob = file.file || file.blob;
    if (blob) form.append('files', blob, file.name);
  }
  return form;
}

export function summarizePayload(draft) {
  const audio = draft?.audio ? 1 : 0;
  const files = Array.isArray(draft?.files) ? draft.files.length : 0;
  return { audio, files, textChars: (draft?.text || '').trim().length, totalBytes: draftTotalBytes(draft) };
}
