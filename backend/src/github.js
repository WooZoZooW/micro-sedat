import { AppError } from './errors.js';

const API_VERSION = '2022-11-28';
const SUPPORTED_MODES = Object.freeze(['release', 'contents']);

function encodeBase64Bytes(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function encodeBase64Utf8(text) {
  return encodeBase64Bytes(new TextEncoder().encode(text));
}

function decodeBase64Utf8(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function createGitHubDelivery(options = {}) {
  const token = options.token || '';
  const owner = options.owner || '';
  const repo = options.repo || '';
  const mode = SUPPORTED_MODES.includes(options.mode) ? options.mode : 'release';
  const apiBase = (options.apiBase || 'https://api.github.com').replace(/\/+$/, '');
  const uploadBase = (options.uploadBase || 'https://uploads.github.com').replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl || fetch;

  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const metadataPath = (id) => `submissions/${id}.json`;

  function baseHeaders(extra = {}) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'micro-sedat',
      ...extra,
    };
  }

  function mapError(response, payload) {
    const status = response.status;
    const apiMessage = payload && typeof payload.message === 'string'
      ? payload.message
      : 'GitHub API request failed';
    const remaining = response.headers.get('x-ratelimit-remaining');
    const retryAfter = response.headers.get('retry-after');
    if ((status === 403 || status === 429) && (remaining === '0' || retryAfter)) {
      return new AppError(503, 'GITHUB_RATE_LIMITED', 'GitHub API rate limit exceeded');
    }
    if (status === 401) return new AppError(502, 'GITHUB_AUTH_FAILED', 'GitHub authentication failed');
    if (status === 403) return new AppError(502, 'GITHUB_FORBIDDEN', 'GitHub token lacks required permissions');
    if (status === 404) return new AppError(502, 'GITHUB_NOT_FOUND', 'GitHub destination repository or resource not found');
    if (status === 422) return new AppError(502, 'GITHUB_CONFLICT', apiMessage);
    return new AppError(502, 'GITHUB_DELIVERY_FAILED', `GitHub API error: ${apiMessage}`);
  }

  async function githubFetch(url, { method = 'GET', headers = {}, body, allowStatuses = [] } = {}) {
    let response;
    try {
      response = await fetchImpl(url, { method, headers: baseHeaders(headers), body });
    } catch (cause) {
      throw new AppError(502, 'GITHUB_UNREACHABLE', 'GitHub API is unreachable', { cause: String(cause) });
    }
    if (response.ok || allowStatuses.includes(response.status)) return response;
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw mapError(response, payload);
  }

  async function githubFetchJson(url, options) {
    const response = await githubFetch(url, options);
    if (response.status === 204 || response.headers.get('content-length') === '0') return null;
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async function getSubmissionMeta(submissionId) {
    const response = await githubFetch(
      `${apiBase}${repoPath}/contents/${metadataPath(submissionId)}`,
      { allowStatuses: [404] },
    );
    if (response.status === 404) return { exists: false, meta: null };
    const payload = await response.json();
    if (!payload || typeof payload.content !== 'string') return { exists: true, meta: null };
    try {
      const meta = JSON.parse(decodeBase64Utf8(payload.content.replace(/\n/g, '')));
      return { exists: true, meta, sha: payload.sha };
    } catch {
      return { exists: true, meta: null, sha: payload.sha };
    }
  }

  async function putMetadata(submissionId, meta, sha = undefined) {
    const body = JSON.stringify({
      message: `submission ${submissionId}: ${meta.status || 'delivered'}`,
      content: encodeBase64Utf8(JSON.stringify(meta, null, 2)),
      ...(sha ? { sha } : {}),
    });
    return githubFetchJson(`${apiBase}${repoPath}/contents/${metadataPath(submissionId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  }

  async function deleteMetadata(submissionId) {
    try {
      const response = await githubFetch(
        `${apiBase}${repoPath}/contents/${metadataPath(submissionId)}`,
        { allowStatuses: [404] },
      );
      if (response.status === 404) return;
      const payload = await response.json();
      if (!payload || !payload.sha) return;
      await githubFetchJson(`${apiBase}${repoPath}/contents/${metadataPath(submissionId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `remove incomplete submission ${submissionId}`, sha: payload.sha }),
      });
    } catch {
      // Best effort cleanup: a leftover metadata file is reported by the status endpoint.
    }
  }

  async function cleanupRelease(releaseId) {
    try {
      await githubFetch(`${apiBase}${repoPath}/releases/${releaseId}`, {
        method: 'DELETE',
        allowStatuses: [404],
      });
    } catch {
      // Best effort cleanup.
    }
  }

  function listAssets(submission) {
    const items = [];
    if (submission.audio?.asset) {
      items.push({ asset: submission.audio.asset, blob: submission.audio.blob, type: submission.audio.type });
    }
    for (const file of submission.files) {
      items.push({ asset: file.asset, blob: file.blob, type: file.type });
    }
    return items;
  }

  async function uploadAsset(releaseId, assetName, blob, contentType) {
    const buffer = await blob.arrayBuffer();
    const url = `${uploadBase}${repoPath}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`;
    return githubFetchJson(url, {
      method: 'POST',
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Length': String(buffer.byteLength),
      },
      body: buffer,
    });
  }

  function buildReleaseBody(meta) {
    const lines = [
      'Automated submission from micro-sedat.',
      `Submission ID: ${meta.id}`,
      `Received: ${meta.receivedAt}`,
      `Attachments: ${(meta.files?.length || 0) + (meta.audio ? 1 : 0)}`,
      `Status: ${meta.status}`,
    ];
    if (meta.text) {
      lines.push('', 'Instructions (user-provided, untrusted):', '```', meta.text.slice(0, 1500), '```');
    }
    return lines.join('\n');
  }

  async function deliverViaRelease(submission, meta) {
    const tag = `sub-${submission.id}`;
    const release = await githubFetchJson(`${apiBase}${repoPath}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: `Submission ${submission.id}`,
        body: buildReleaseBody(meta),
        draft: true,
      }),
    });
    const releaseId = release?.id;
    if (!releaseId) {
      throw new AppError(502, 'GITHUB_DELIVERY_FAILED', 'GitHub did not return a release id');
    }

    const uploaded = [];
    let metadataWritten = false;
    try {
      for (const item of listAssets(submission)) {
        const asset = await uploadAsset(releaseId, item.asset, item.blob, item.type);
        uploaded.push(asset?.name || item.asset);
      }
      await putMetadata(submission.id, meta);
      metadataWritten = true;
      await githubFetchJson(`${apiBase}${repoPath}/releases/${releaseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft: false }),
      });
    } catch (error) {
      if (metadataWritten) await deleteMetadata(submission.id);
      await cleanupRelease(releaseId);
      throw error;
    }

    return { mode: 'release', releaseId, tag, assets: uploaded.length };
  }

  async function deliverViaContents(submission, meta) {
    const uploaded = [];
    for (const item of listAssets(submission)) {
      const path = `submissions/${submission.id}/files/${item.asset}`;
      const buffer = await item.blob.arrayBuffer();
      await githubFetchJson(`${apiBase}${repoPath}/contents/${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `submission ${submission.id}: add ${item.asset}`,
          content: encodeBase64Bytes(new Uint8Array(buffer)),
        }),
      });
      uploaded.push(item.asset);
    }
    await putMetadata(submission.id, meta);
    return { mode: 'contents', releaseId: null, tag: null, assets: uploaded.length };
  }

  return {
    mode,
    owner,
    repo,
    getSubmissionMeta,
    deliver(submission, meta) {
      return mode === 'contents'
        ? deliverViaContents(submission, meta)
        : deliverViaRelease(submission, meta);
    },
  };
}
