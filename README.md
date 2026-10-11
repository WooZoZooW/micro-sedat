# Micro Sedat

Mobile-first single-page website for handing off change requests to a website project without touching code.
The user records a voice message by pressing and holding a button, attaches photos and files, optionally adds
written instructions, and submits everything. A serverless backend delivers the submission to a **private**
GitHub inbox repository. A separate external process (Antigravity on Windows) reads the submission and edits
the project source code; this website only collects and delivers the material.

- User interface language: **Russian** only.
- No chat UI, no accounts, no AI references in the interface.
- Frontend: static HTML/CSS/vanilla ES modules (no build step, no external dependencies).
- Backend: one JavaScript module that runs both on Cloudflare Workers and on plain Node.js (local dev/tests).
- Delivery: GitHub Releases (raw binary assets) plus a JSON metadata file in a private inbox repository.

| Layer | Technology | Location |
| --- | --- | --- |
| Frontend | HTML + CSS + ES modules | `frontend/` |
| Backend | Web-standard `Request`/`Response` handler | `backend/src/app.js` |
| Worker entry | Cloudflare Workers (static assets + API) | `backend/src/worker.js`, `backend/wrangler.toml` |
| Local server | Node.js `http` adapter with static file serving | `backend/src/node-server.js` |
| Tests | `node:test` (zero dependencies) | `backend/test/`, `tests/frontend/` |
| Delivery target | Private GitHub repo `WooZoZooW/micro-sedat-inbox` | configurable via env |

## Data flow

```
iPhone Safari
  └─ frontend (same origin as the Worker)
       └─ POST /api/submissions  (multipart/form-data)
            └─ backend validation → idempotency check → GitHub delivery
                 ├─ draft release "sub-<id>" in the private inbox repo
                 ├─ raw binary assets (audio + photos + files)
                 ├─ metadata JSON: submissions/<id>.json
                 └─ release published
Antigravity on Windows
  └─ downloads the release from the private inbox repo
       └─ edits the source project → runs its checks → pushes source changes
```

Delivery does **not** mean processing. The metadata file keeps `processing.state = "pending"` until an
external workflow updates it.

## Quick start (Termux / Linux / macOS)

Requirements: Node.js >= 20.6 (for `--env-file-if-exists`), no npm install required.

```bash
cp .env.example .env          # fill in GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO
npm run dev                   # http://127.0.0.1:8787  (frontend + API)
npm test                      # all unit + integration tests
npm run lint                  # syntax, secret scan, static checks
npm run check                 # lint + tests
```

Without `GITHUB_TOKEN` the local server still runs; `POST /api/submissions` returns
`SERVER_NOT_CONFIGURED` and the page shows a Russian notice.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` | yes (prod) | — | Fine-grained PAT, `Contents: Read and write` on the inbox repo only |
| `GITHUB_OWNER` | yes | — | Inbox repository owner (`WooZoZooW`) |
| `GITHUB_REPO` | yes | — | Inbox repository (`micro-sedat-inbox`), keep it private |
| `GITHUB_SUBMISSION_MODE` | no | `release` | `release` (raw asset upload, recommended) or `contents` (base64 commits, small files only) |
| `ACCESS_CODE` | no | — | Shared code required in `X-Access-Code`; lightweight abuse gate |
| `ADMIN_TOKEN` | no | — | Enables `GET /api/submissions/:id` with `Authorization: Bearer <token>` |
| `ALLOWED_ORIGINS` | no | — | Extra browser origins allowed to call the API (for separate frontend hosting) |
| `MAX_TOTAL_BYTES` | no | `20971520` | Max total submission size |
| `MAX_FILE_BYTES` | no | `15728640` | Max size per attached file |
| `MAX_AUDIO_BYTES` | no | `15728640` | Max size of the voice recording |
| `MAX_FILES` | no | `12` | Max number of attachments |
| `MAX_TEXT_CHARS` | no | `4000` | Max length of written instructions |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | no | `600000` / `12` | Best-effort in-memory rate limit |
| `PORT` / `HOST` | no (dev) | `8787` / `127.0.0.1` | Local server bind address |

API endpoints: `GET /api/health`, `POST /api/submissions`, `GET /api/submissions/:id` (admin).

## Documentation

- `docs/ARCHITECTURE.md` — architecture decisions and why they were chosen.
- `docs/DEPLOYMENT.md` — Cloudflare Worker deployment, secrets, and remaining manual steps.
- `docs/TESTING.md` — exact test commands and what was actually verified.
- `docs/SECURITY.md` — privacy model, authentication, known limitations.
- `docs/IPHONE_CHECKLIST.md` — manual verification procedure on a real iPhone.
- `docs/WINDOWS_WORKFLOW.md` — how Antigravity retrieves submissions (with `windows/fetch-submission.ps1`).

## License

MIT (see `LICENSE`).
