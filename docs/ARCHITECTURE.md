# Architecture

## Goals

1. A person on an iPhone can hand off a change request (voice + photos + files + text) in under a minute.
2. The material must never become public, including when this source repository is public.
3. The backend must be free to run on free tiers, deployable with the credentials available in this environment.
4. The receiving side (Antigravity on Windows) needs a simple, stable way to fetch the material.

## Components

| Component | Choice | Why |
| --- | --- | --- |
| Frontend | Static HTML + CSS + ES modules, no framework, no build | Fast on iPhone Safari, auditable, deployable anywhere static files are served |
| Backend runtime | Web-standard handler (`Request` → `Response`) | One codebase runs on Cloudflare Workers (production) and Node.js (local dev/tests) |
| Production host | Cloudflare Workers + Workers Static Assets | Free tier, HTTPS by default (required for microphone), same-origin API means no CORS setup |
| Submission storage | GitHub Releases inside a **private** inbox repository | Raw binary asset upload (no base64), 2 GB per asset limit, private by repository visibility |
| Metadata | JSON file `submissions/<id>.json` committed to the inbox repository | Human-readable, easy for any workflow to read, doubles as the idempotency record |
| Local dev server | `backend/src/node-server.js` | Full stack testable in Termux without workerd/Docker |
| Tests | `node:test`, zero dependencies | Works on Android aarch64 without native modules |

## Why GitHub Releases instead of committing binaries

Committing binaries through the Contents API requires base64 encoding in the Worker. Cloudflare Workers
have a small CPU budget on the free plan, and base64 of multi-megabyte payloads is CPU-heavy. The Release
Asset upload endpoint (`POST https://uploads.github.com/.../releases/{id}/assets`) accepts a raw request
body, so the Worker streams file bytes without transformation.

The submission is assembled as:

```
release "sub-<submissionId>" (published)
├── <audio asset>            e.g. recording.m4a
├── 01-<original name>       attachments, numbered to guarantee uniqueness
├── 02-<original name>
submissions/<submissionId>.json   ← metadata + status + asset index
```

## State model

| State | Meaning |
| --- | --- |
| `delivered` | All assets and metadata are committed in the inbox repository; `processing.state = "pending"` |
| `processing` | An external workflow has started working on it (updated by that workflow) |
| `completed` | Source changes were made and verified (updated by that workflow) |
| `delivery_failed` | Reserved for external workflows that want to record a failure |

The website never marks a submission as processed. Delivery and processing are deliberately separate.

## Idempotency and retries

- The frontend generates the `submissionId` once per draft (UUID) and reuses it on retry.
- The backend checks `submissions/<id>.json` before delivering. If it exists, the existing status is
  returned with `duplicate: true` and nothing is written twice.
- If a delivery fails partway, the backend deletes the draft release and any metadata it wrote, so a retry
  starts clean. Cleanup is best effort; leftovers are detectable through `GET /api/submissions/:id`.

## Frontend notes

- `frontend/lib/*` contains pure logic (MIME probing, filename sanitizing, draft validation, state machine,
  serialization, error messages). It is imported both by the browser and by Node tests.
- `frontend/app.js` is the only file that touches the DOM, `MediaRecorder` and `XMLHttpRequest`.
- Recording uses `navigator.mediaDevices.getUserMedia` + `MediaRecorder` with a dynamic MIME probe
  (`audio/mp4` first for Safari, then `audio/webm`, `audio/ogg`).
- Press-and-hold uses Pointer Events with pointer capture; a touch/mouse fallback is used only when
  PointerEvent is unavailable. Recording is cancelled (not saved) when the page becomes hidden.
- Drafts are persisted to IndexedDB (audio and files as Blobs) after changes and cleared after a
  successful delivery. IndexedDB unavailability degrades gracefully.

## Rejected alternatives

| Alternative | Why not |
| --- | --- |
| GitHub Issues | Issue content and attachments in a public repo are public; no binary attachments via API |
| Committing all files through Contents API | base64 CPU/memory cost, 100 MB hard limit, noisier history |
| Cloudflare R2 | Free 10 GB storage is fine, but requires extra account setup and signed-URL plumbing; not needed |
| GitHub Pages only | Cannot execute backend code |
