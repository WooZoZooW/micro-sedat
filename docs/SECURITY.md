# Security and privacy

## What is protected

- Submissions (audio, photos, files, text) are delivered only to the **private** inbox repository
  `WooZoZooW/micro-sedat-inbox`. The public source repository never contains user content.
- The GitHub token exists only as a server-side secret (`wrangler secret put` / local `.env`). It is never
  sent to the browser, never committed, and never echoed in API responses or logs.
- Uploaded filenames are sanitized (path separators, control characters, `..`, length) and never used as
  filesystem paths by any component.
- User text is rendered into the page with `textContent` only; no `innerHTML` with user data.
- The backend uses CORS restrictions: same-origin requests, plus an explicit `ALLOWED_ORIGINS` allow-list.
- Request size limits are enforced server-side (`Content-Length` check plus actual parsed sizes) and
  client-side for fast feedback.
- An optional shared `ACCESS_CODE` gate and a best-effort in-memory rate limit reduce abuse.
- Uploaded files are never executed, parsed or previewed by the backend; they are stored as opaque bytes.

## Authentication model

| Operation | Protection |
| --- | --- |
| `POST /api/submissions` | Optional `ACCESS_CODE` (header `X-Access-Code`); rate limit; size limits |
| `GET /api/submissions/:id` | Requires `Authorization: Bearer <ADMIN_TOKEN>`; disabled when `ADMIN_TOKEN` is not set |
| GitHub operations | Fine-grained PAT limited to `Contents: Read and write` on the inbox repo |

The access code is a **lightweight gate**, not real multi-user authentication. Header values must be ASCII;
the UI rejects non-ASCII codes before sending them. Choose a long random code and share the site URL with
`#code=...` (the code is stored in the browser's localStorage, not in the page source).

## Known limitations

- `ACCESS_CODE` is a shared secret; anyone who learns it can submit until it is rotated. Rotate it with
  `wrangler secret put ACCESS_CODE` when needed.
- Rate limiting is per Worker isolate and in-memory: it is best-effort and can be bypassed across isolates.
  The hard protection is the GitHub token permission scope and size limits.
- Anyone with read access to the private inbox can read submissions. Keep repository access small.
- A submission URL (`https://.../api/submissions/<id>`) does not expose data without `ADMIN_TOKEN`.
- GitHub, Cloudflare, and the network between them are trusted. No end-to-end encryption is implemented.
- Deletion/retention is manual: delete the release and `submissions/<id>.json` from the inbox repository to
  remove a submission.
- The microphone requires HTTPS; the Worker deployment provides it. Opening `index.html` from `file://`
  will not be able to record.

## What the system is not

- Not anonymous-proof: the backend does not collect personal data, but GitHub and Cloudflare see normal
  request metadata (IP, user agent) as any web service does.
- Not encrypted at rest beyond the hosting providers' defaults.
- Not a substitute for real access control if the access code is weak or shared publicly.
