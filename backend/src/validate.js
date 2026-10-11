import { badRequest, payloadTooLarge } from './errors.js';

export const DEFAULT_LIMITS = Object.freeze({
  maxTotalBytes: 20 * 1024 * 1024,
  maxFileBytes: 15 * 1024 * 1024,
  maxAudioBytes: 15 * 1024 * 1024,
  maxFiles: 12,
  maxTextChars: 4000,
});

export const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

const SUBMISSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;

export function parsePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function limitsFromEnv(env = {}) {
  return {
    maxTotalBytes: parsePositiveInt(env.MAX_TOTAL_BYTES, DEFAULT_LIMITS.maxTotalBytes),
    maxFileBytes: parsePositiveInt(env.MAX_FILE_BYTES, DEFAULT_LIMITS.maxFileBytes),
    maxAudioBytes: parsePositiveInt(env.MAX_AUDIO_BYTES, DEFAULT_LIMITS.maxAudioBytes),
    maxFiles: parsePositiveInt(env.MAX_FILES, DEFAULT_LIMITS.maxFiles, { min: 1, max: 100 }),
    maxTextChars: parsePositiveInt(env.MAX_TEXT_CHARS, DEFAULT_LIMITS.maxTextChars, { min: 1, max: 100000 }),
  };
}

export function isSubmissionId(value) {
  return typeof value === 'string' && SUBMISSION_ID_RE.test(value);
}

export function sanitizeFilename(input, fallback = 'file') {
  let name = typeof input === 'string' ? input : '';
  name = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  name = name.replace(/^[.\s]+/, '');
  name = name.replace(/[.]{2,}/g, '.');
  name = name.replace(/[^\p{L}\p{N}._ ()+@#,;=\[\]{}-]/gu, '_');
  if (name.length > 120) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
    name = name.slice(0, 120 - ext.length) + ext;
  }
  return name.length > 0 ? name : fallback;
}

export function uniqueFilename(input, usedNames) {
  const clean = sanitizeFilename(input);
  const used = usedNames instanceof Set ? usedNames : new Set();
  if (!used.has(clean.toLowerCase())) {
    used.add(clean.toLowerCase());
    return clean;
  }
  const dot = clean.lastIndexOf('.');
  const base = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : '';
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base} (${i})${ext}`;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }
  const fallback = `${base}-${Date.now()}${ext}`;
  used.add(fallback.toLowerCase());
  return fallback;
}

export function normalizeMime(value, fallback = 'application/octet-stream') {
  if (typeof value !== 'string') return fallback;
  const base = value.split(';')[0].trim().toLowerCase();
  return base.length > 0 ? base : fallback;
}

export function extensionForAudioMime(mime) {
  const base = normalizeMime(mime, '');
  switch (base) {
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/m4a':
      return 'm4a';
    case 'audio/webm':
      return 'webm';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/aac':
      return 'aac';
    default:
      return 'bin';
  }
}

export function audioAssetName(audio) {
  const fallbackBase = 'recording';
  const rawName = typeof audio.name === 'string' && audio.name.length > 0 ? audio.name : fallbackBase;
  const hasExtension = /\.[A-Za-z0-9]{1,8}$/.test(rawName);
  return hasExtension ? rawName : `${rawName}.${extensionForAudioMime(audio.type)}`;
}

export function fileAssetName(name, index) {
  return `${String(index + 1).padStart(2, '0')}-${name}`;
}

function toIsoOrNull(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toBlob(entry) {
  if (!entry) return null;
  if (typeof entry.arrayBuffer === 'function' && typeof entry.size === 'number') return entry;
  if (entry.blob && typeof entry.blob.arrayBuffer === 'function') return entry.blob;
  if (entry.file && typeof entry.file.arrayBuffer === 'function') return entry.file;
  return null;
}

export function validateSubmission(input, limits = DEFAULT_LIMITS) {
  const submissionId = typeof input?.submissionId === 'string' ? input.submissionId.trim() : '';
  if (!isSubmissionId(submissionId)) {
    throw badRequest('INVALID_SUBMISSION_ID', 'submissionId must be 8-64 characters of [A-Za-z0-9-]');
  }

  const text = typeof input?.text === 'string' ? input.text.trim() : '';
  if (text.length > limits.maxTextChars) {
    throw badRequest('TEXT_TOO_LONG', `text exceeds ${limits.maxTextChars} characters`);
  }

  const createdAt = toIsoOrNull(input?.createdAt);
  const durationMs = parsePositiveInt(input?.durationMs, 0, { min: 0, max: 24 * 60 * 60 * 1000 });

  const rawFiles = Array.isArray(input?.files) ? input.files : [];
  if (rawFiles.length > limits.maxFiles) {
    throw badRequest('TOO_MANY_FILES', `at most ${limits.maxFiles} files are allowed`);
  }

  const usedNames = new Set();
  const files = [];
  let totalBytes = 0;

  for (const entry of rawFiles) {
    const blob = toBlob(entry);
    if (!blob) throw badRequest('INVALID_FILE', 'file payload is missing or malformed');
    const size = Number(blob.size ?? 0);
    if (!Number.isFinite(size) || size <= 0) throw badRequest('EMPTY_FILE', 'empty files are not allowed');
    if (size > limits.maxFileBytes) throw badRequest('FILE_TOO_LARGE', `a file exceeds ${limits.maxFileBytes} bytes`);
    totalBytes += size;
    const name = uniqueFilename(blob.name || entry?.name || 'file', usedNames);
    files.push({
      blob,
      name,
      type: normalizeMime(blob.type || entry?.type),
      size,
    });
  }

  let audio = null;
  if (input?.audio) {
    const blob = toBlob(input.audio);
    if (!blob) throw badRequest('INVALID_AUDIO', 'audio payload is malformed');
    const size = Number(blob.size ?? 0);
    if (!Number.isFinite(size) || size <= 0) throw badRequest('EMPTY_AUDIO', 'audio recording is empty');
    if (size > limits.maxAudioBytes) throw badRequest('AUDIO_TOO_LARGE', `audio exceeds ${limits.maxAudioBytes} bytes`);
    totalBytes += size;
    const type = normalizeMime(blob.type || input.audio.type || 'audio/mp4', 'audio/mp4');
    if (!type.startsWith('audio/')) throw badRequest('INVALID_AUDIO', 'audio payload must be an audio MIME type');
    const name = uniqueFilename(blob.name || input.audio.name || 'recording', usedNames);
    audio = { blob, name, type, size, durationMs };
  }

  if (totalBytes > limits.maxTotalBytes) {
    throw payloadTooLarge('SUBMISSION_TOO_LARGE', `submission exceeds ${limits.maxTotalBytes} bytes`);
  }

  if (!text && !audio && files.length === 0) {
    throw badRequest('EMPTY_SUBMISSION', 'submission must contain text, audio or files');
  }

  for (let i = 0; i < files.length; i += 1) {
    files[i].asset = fileAssetName(files[i].name, i);
  }
  if (audio) audio.asset = audioAssetName(audio);

  return { id: submissionId, text, createdAt, audio, files, totalBytes, durationMs };
}
