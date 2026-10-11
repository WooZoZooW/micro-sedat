import http from 'node:http';

function send(res, status, payload, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (status === 204) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function startMockGitHub() {
  const state = {
    releases: new Map(),
    releaseIdByTag: new Map(),
    assets: new Map(),
    contents: new Map(),
    nextReleaseId: 1000,
    nextAssetId: 5000,
    failNextReleaseCreate: false,
    failNextAssetUpload: false,
    rateLimitNext: false,
    authFailure: false,
    requests: [],
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const body = await readJsonBody(req);
    state.requests.push({
      method: req.method,
      path: url.pathname,
      query: url.search,
      body,
      headers: req.headers,
    });

    if (state.authFailure) {
      return send(res, 401, { message: 'Bad credentials' });
    }
    if (state.rateLimitNext) {
      state.rateLimitNext = false;
      return send(res, 403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' });
    }
    if (state.failNextReleaseCreate && req.method === 'POST' && /\/releases$/.test(url.pathname)) {
      state.failNextReleaseCreate = false;
      return send(res, 500, { message: 'Internal mock failure' });
    }
    if (state.failNextAssetUpload && req.method === 'POST' && url.pathname.endsWith('/assets')) {
      state.failNextAssetUpload = false;
      return send(res, 500, { message: 'Asset upload failed' });
    }

    let match = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/releases$/);
    if (match && req.method === 'POST') {
      const payload = JSON.parse(body.toString('utf8'));
      if (state.releaseIdByTag.has(payload.tag_name)) {
        return send(res, 422, { message: 'Validation Failed: tag already exists' });
      }
      const id = state.nextReleaseId;
      state.nextReleaseId += 1;
      const release = {
        id,
        tag_name: payload.tag_name,
        name: payload.name,
        body: payload.body,
        draft: Boolean(payload.draft),
        assets: [],
      };
      state.releases.set(id, release);
      state.releaseIdByTag.set(payload.tag_name, id);
      state.assets.set(id, []);
      return send(res, 201, release);
    }

    match = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/releases\/(\d+)$/);
    if (match && req.method === 'PATCH') {
      const id = Number(match[3]);
      const release = state.releases.get(id);
      if (!release) return send(res, 404, { message: 'Not Found' });
      Object.assign(release, JSON.parse(body.toString('utf8')));
      return send(res, 200, release);
    }
    if (match && req.method === 'DELETE') {
      const id = Number(match[3]);
      const release = state.releases.get(id);
      if (!release) return send(res, 404, { message: 'Not Found' });
      state.releaseIdByTag.delete(release.tag_name);
      state.releases.delete(id);
      state.assets.delete(id);
      return send(res, 204, null);
    }

    match = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/releases\/(\d+)\/assets$/);
    if (match && req.method === 'POST') {
      const id = Number(match[3]);
      if (!state.releases.has(id)) return send(res, 404, { message: 'Not Found' });
      const name = url.searchParams.get('name');
      const list = state.assets.get(id) || [];
      if (list.some((asset) => asset.name === name)) {
        return send(res, 422, { message: 'Validation Failed: already_exists' });
      }
      const asset = {
        id: state.nextAssetId,
        name,
        bytes: body,
        contentType: req.headers['content-type'] || '',
      };
      state.nextAssetId += 1;
      list.push(asset);
      state.assets.set(id, list);
      return send(res, 201, {
        id: asset.id,
        name: asset.name,
        size: asset.bytes.length,
        content_type: asset.contentType,
      });
    }

    match = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
    if (match) {
      const path = decodeURIComponent(match[3]);
      if (req.method === 'GET') {
        const entry = state.contents.get(path);
        if (!entry) return send(res, 404, { message: 'Not Found' });
        return send(res, 200, { content: entry.contentBase64, sha: entry.sha, path, encoding: 'base64' });
      }
      if (req.method === 'PUT') {
        const payload = JSON.parse(body.toString('utf8'));
        const existing = state.contents.get(path);
        if (existing && payload.sha !== existing.sha) {
          return send(res, 409, { message: 'sha does not match' });
        }
        const sha = `sha-${Math.random().toString(36).slice(2, 10)}`;
        state.contents.set(path, { contentBase64: payload.content, sha, message: payload.message });
        return send(res, 201, { content: { path, sha }, commit: { sha } });
      }
      if (req.method === 'DELETE') {
        if (!state.contents.has(path)) return send(res, 404, { message: 'Not Found' });
        state.contents.delete(path);
        return send(res, 200, { commit: { sha: 'deleted' } });
      }
    }

    return send(res, 404, { message: 'Not Found' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
    getMetadata(path) {
      const entry = state.contents.get(path);
      if (!entry) return null;
      return JSON.parse(Buffer.from(entry.contentBase64, 'base64').toString('utf8'));
    },
    getAssetBytes(releaseId, name) {
      const list = state.assets.get(releaseId) || [];
      const asset = list.find((item) => item.name === name);
      return asset ? asset.bytes : null;
    },
    getAssets(releaseId) {
      return state.assets.get(releaseId) || [];
    },
  };
}
