import {
  AppError,
  badRequest,
  notFound,
  serviceUnavailable,
  tooManyRequests,
  unauthorized,
} from './errors.js';
import { limitsFromEnv, validateSubmission } from './validate.js';
import { createGitHubDelivery } from './github.js';
import { createRateLimiter } from './ratelimit.js';
import { corsDecision, jsonResponse, parseOrigins, toErrorResponse, withCors } from './http.js';
import { enforceContentLength, getClientIp, isMultipartRequest, safeEqual } from './security.js';

const VALID_MODES = new Set(['release', 'contents']);

export function buildConfig(env = {}) {
  const rawMode = String(env.GITHUB_SUBMISSION_MODE || 'release').trim().toLowerCase();
  return {
    owner: String(env.GITHUB_OWNER || '').trim(),
    repo: String(env.GITHUB_REPO || '').trim(),
    token: String(env.GITHUB_TOKEN || '').trim(),
    mode: VALID_MODES.has(rawMode) ? rawMode : 'release',
    apiBase: String(env.GITHUB_API_BASE || 'https://api.github.com').trim(),
    uploadBase: String(env.GITHUB_UPLOAD_BASE || 'https://uploads.github.com').trim(),
    accessCode: String(env.ACCESS_CODE || '').trim(),
    adminToken: String(env.ADMIN_TOKEN || '').trim(),
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    limits: limitsFromEnv(env),
    rateLimit: {
      windowMs: Number.parseInt(env.RATE_LIMIT_WINDOW_MS || '600000', 10) || 600000,
      max: Number.parseInt(env.RATE_LIMIT_MAX || '12', 10) || 12,
    },
  };
}

export function buildMetadata(submission, receivedAt, config) {
  return {
    schema: 'micro-sedat/submission@1',
    id: submission.id,
    status: 'delivered',
    processing: {
      state: 'pending',
      note: 'Delivery to the inbox does not mean the submission was processed.',
    },
    receivedAt,
    clientCreatedAt: submission.createdAt,
    text: submission.text,
    audio: submission.audio
      ? {
        asset: submission.audio.asset,
        name: submission.audio.name,
        mime: submission.audio.type,
        bytes: submission.audio.size,
        durationMs: submission.audio.durationMs || null,
      }
      : null,
    files: submission.files.map((file) => ({
      asset: file.asset,
      name: file.name,
      mime: file.type,
      bytes: file.size,
    })),
    delivery: {
      mode: config.mode,
      repo: `${config.owner}/${config.repo}`,
      releaseTag: `sub-${submission.id}`,
    },
  };
}

function extractPayload(form) {
  const submissionId = form.get('submissionId');
  const text = form.get('text');
  const createdAt = form.get('createdAt');
  const durationMs = form.get('durationMs');
  const audioEntry = form.get('audio');
  const audio = audioEntry
    && typeof audioEntry === 'object'
    && typeof audioEntry.arrayBuffer === 'function'
    ? { blob: audioEntry, name: audioEntry.name, type: audioEntry.type, size: audioEntry.size }
    : null;
  const files = form
    .getAll('files')
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.arrayBuffer === 'function');
  return {
    submissionId: typeof submissionId === 'string' ? submissionId : '',
    text: typeof text === 'string' ? text : '',
    createdAt: typeof createdAt === 'string' ? createdAt : null,
    durationMs,
    audio,
    files,
  };
}

export function createApp(env = {}, options = {}) {
  const config = options.config ?? buildConfig(env);
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const limiter = options.rateLimiter ?? createRateLimiter(config.rateLimit);
  const configured = Boolean(config.owner && config.repo && config.token);
  const delivery = configured
    ? createGitHubDelivery({
      token: config.token,
      owner: config.owner,
      repo: config.repo,
      mode: config.mode,
      apiBase: config.apiBase,
      uploadBase: config.uploadBase,
      fetchImpl,
    })
    : null;

  function healthResponse() {
    return jsonResponse({
      ok: true,
      service: 'micro-sedat',
      configured,
      mode: config.mode,
      accessCodeRequired: Boolean(config.accessCode),
      limits: config.limits,
    });
  }

  async function handleSubmission(request) {
    if (!delivery) {
      throw serviceUnavailable('SERVER_NOT_CONFIGURED', 'Submission backend is not configured yet');
    }
    enforceContentLength(request, config.limits);
    if (!isMultipartRequest(request)) {
      throw badRequest('INVALID_CONTENT_TYPE', 'Expected multipart/form-data');
    }
    if (config.accessCode) {
      const code = request.headers.get('X-Access-Code') || '';
      if (!safeEqual(code, config.accessCode)) {
        throw unauthorized('ACCESS_CODE_INVALID', 'Access code is missing or invalid');
      }
    }
    const gate = limiter.check(getClientIp(request));
    if (!gate.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil(gate.retryAfterMs / 1000));
      throw tooManyRequests('RATE_LIMITED', `Too many submissions. Retry after ${retryAfterSeconds} seconds.`);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      throw badRequest('MALFORMED_PAYLOAD', 'Could not parse multipart payload');
    }

    const submission = validateSubmission(extractPayload(form), config.limits);

    const existing = await delivery.getSubmissionMeta(submission.id);
    if (existing.exists) {
      return jsonResponse({
        ok: true,
        duplicate: true,
        submissionId: submission.id,
        status: existing.meta?.status ?? 'delivered',
        receivedAt: existing.meta?.receivedAt ?? null,
      });
    }

    const receivedAt = now().toISOString();
    const meta = buildMetadata(submission, receivedAt, config);
    const info = await delivery.deliver(submission, meta);

    return jsonResponse({
      ok: true,
      duplicate: false,
      submissionId: submission.id,
      status: 'delivered',
      receivedAt,
      delivery: { mode: info.mode, tag: info.tag, assets: info.assets },
    }, 201);
  }

  async function handleStatus(request, submissionId) {
    if (!config.adminToken) {
      throw notFound('NOT_FOUND', 'Status endpoint is disabled');
    }
    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!safeEqual(token, config.adminToken)) {
      throw unauthorized('UNAUTHORIZED', 'Valid admin token required');
    }
    if (!delivery) {
      throw serviceUnavailable('SERVER_NOT_CONFIGURED', 'Submission backend is not configured yet');
    }
    const existing = await delivery.getSubmissionMeta(submissionId);
    if (!existing.exists) {
      throw notFound('SUBMISSION_NOT_FOUND', 'Unknown submission id');
    }
    return jsonResponse({ ok: true, submissionId, meta: existing.meta });
  }

  async function route(request) {
    const { pathname } = new URL(request.url);
    if (request.method === 'OPTIONS' && pathname.startsWith('/api/')) {
      return new Response(null, { status: 204 });
    }
    if (pathname === '/api/health' && request.method === 'GET') {
      return healthResponse();
    }
    if (pathname === '/api/submissions' && request.method === 'POST') {
      return handleSubmission(request);
    }
    const statusMatch = pathname.match(/^\/api\/submissions\/([A-Za-z0-9-]{1,80})$/);
    if (statusMatch && request.method === 'GET') {
      return handleStatus(request, statusMatch[1]);
    }
    throw notFound('NOT_FOUND', 'Unknown route');
  }

  async function handle(request) {
    const decision = corsDecision(request, config.allowedOrigins);
    if (!decision.allowed) {
      return withCors(toErrorResponse(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed')), decision);
    }
    try {
      return withCors(await route(request), decision);
    } catch (error) {
      if (!(error instanceof AppError)) {
        console.error('[micro-sedat] unexpected error:', error?.name || 'Error');
      }
      return withCors(toErrorResponse(error), decision);
    }
  }

  handle.config = config;
  handle.isConfigured = configured;
  return handle;
}
