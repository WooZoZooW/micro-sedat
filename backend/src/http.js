import { AppError } from './errors.js';

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
});

export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export function toErrorResponse(error) {
  if (error instanceof AppError) {
    return jsonResponse(
      { ok: false, error: { code: error.code, message: error.message } },
      error.status,
    );
  }
  return jsonResponse(
    { ok: false, error: { code: 'INTERNAL', message: 'Unexpected server error' } },
    500,
  );
}

export function corsDecision(request, allowedOrigins = []) {
  const origin = request.headers.get('Origin');
  if (!origin) return { allowed: true, origin: null };

  let originHost = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    return { allowed: false, origin };
  }

  let requestHost = null;
  try {
    requestHost = new URL(request.url).host;
  } catch {
    requestHost = null;
  }

  if (originHost && requestHost && originHost === requestHost) {
    return { allowed: true, origin };
  }
  if (allowedOrigins.includes(origin)) {
    return { allowed: true, origin };
  }
  return { allowed: false, origin };
}

export function withCors(response, decision) {
  if (!decision || !decision.allowed || !decision.origin) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', decision.origin);
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Access-Code, Authorization');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function parseOrigins(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
