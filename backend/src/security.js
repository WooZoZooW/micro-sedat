import { AppError } from './errors.js';

export function safeEqual(a, b) {
  const left = typeof a === 'string' ? a : '';
  const right = typeof b === 'string' ? b : '';
  const length = Math.max(left.length, right.length);
  let mismatch = left.length === right.length ? 0 : 1;
  for (let i = 0; i < length; i += 1) {
    mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

export function getClientIp(request) {
  const direct = request.headers.get('CF-Connecting-IP');
  if (direct) return direct.trim();
  const forwarded = request.headers.get('X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

export function isMultipartRequest(request) {
  const contentType = request.headers.get('Content-Type') || '';
  return contentType.toLowerCase().startsWith('multipart/form-data');
}

export function enforceContentLength(request, limits) {
  const header = request.headers.get('Content-Length');
  if (!header) return;
  const declared = Number.parseInt(header, 10);
  if (!Number.isFinite(declared) || declared < 0) return;
  const allowed = limits.maxTotalBytes + limits.maxFiles * 4096 + 1024 * 1024;
  if (declared > allowed) {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', `request body exceeds ${limits.maxTotalBytes} bytes`);
  }
}
