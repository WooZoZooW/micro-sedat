export const RECORDER_MIME_CANDIDATES = Object.freeze([
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/aac',
  'audio/mpeg',
]);

export function pickRecorderMime(isTypeSupported) {
  if (typeof isTypeSupported !== 'function') return null;
  for (const candidate of RECORDER_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(candidate)) return candidate;
    } catch {
      // Ignore probing errors and try the next candidate.
    }
  }
  return null;
}

export function extensionForAudioMime(mime) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
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
