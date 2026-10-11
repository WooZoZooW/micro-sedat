import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfig, createApp } from './app.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(moduleDir, '../../frontend');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const port = Number.parseInt(process.env.PORT || '8787', 10);
const host = process.env.HOST || '127.0.0.1';

const config = buildConfig(process.env);
const app = createApp(process.env);
const bodyLimit = config.limits.maxTotalBytes + 2 * 1024 * 1024;

function readRequestBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        const error = new Error('payload too large');
        error.code = 'PAYLOAD_TOO_LARGE';
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => {
      if (done) return;
      done = true;
      reject(error);
    });
  });
}

function toHeaders(rawHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (typeof value === 'string') {
      headers.set(key, value);
    }
  }
  return headers;
}

function toRequest(req, url, body) {
  const headers = toHeaders(req.headers);
  headers.set('x-forwarded-for', req.socket.remoteAddress || 'unknown');
  return new Request(url, {
    method: req.method,
    headers,
    body: body && body.length > 0 ? body : undefined,
  });
}

async function sendResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

async function serveStatic(res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = '/';
  }
  let relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  if (relative.length === 0 || relative.endsWith('/')) relative += 'index.html';
  const resolved = path.resolve(FRONTEND_DIR, relative);
  if (resolved !== FRONTEND_DIR && !resolved.startsWith(FRONTEND_DIR + path.sep)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found');
    return;
  }
  try {
    const info = await stat(resolved);
    if (info.isDirectory()) {
      res.statusCode = 302;
      res.setHeader('Location', `${decoded.replace(/\/?$/, '')}/index.html`);
      res.end();
      return;
    }
    const data = await readFile(resolved);
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const body = await readRequestBody(req, bodyLimit);
      const request = toRequest(req, url, body);
      const response = await app(request);
      await sendResponse(res, response);
      return;
    }
    await serveStatic(res, url.pathname);
  } catch (error) {
    const tooLarge = error?.code === 'PAYLOAD_TOO_LARGE';
    if (!res.headersSent) {
      res.statusCode = tooLarge ? 413 : 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Connection', 'close');
      res.end(JSON.stringify({
        ok: false,
        error: {
          code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL',
          message: tooLarge ? 'Request body is too large' : 'Request failed',
        },
      }));
    }
    req.destroy();
  }
});

server.listen(port, host, () => {
  const destination = config.owner && config.repo ? `${config.owner}/${config.repo}` : '(not configured)';
  console.log('[micro-sedat] local server started');
  console.log(`[micro-sedat] url: http://${host}:${port}`);
  console.log(`[micro-sedat] github delivery: ${app.isConfigured ? 'configured' : 'NOT configured'}`);
  console.log(`[micro-sedat] destination: ${destination} (mode: ${config.mode})`);
  console.log(`[micro-sedat] access code required: ${config.accessCode ? 'yes' : 'no'}`);
  console.log(`[micro-sedat] admin status endpoint: ${config.adminToken ? 'enabled' : 'disabled'}`);
  console.log(`[micro-sedat] limits: total=${config.limits.maxTotalBytes} file=${config.limits.maxFileBytes} audio=${config.limits.maxAudioBytes} files=${config.limits.maxFiles}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
