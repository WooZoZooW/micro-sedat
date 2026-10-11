# Deployment

## Current state (deployed in this environment)

| Item | Value |
| --- | --- |
| Public source repository | https://github.com/WooZoZooW/micro-sedat (public) |
| Private inbox repository | https://github.com/WooZoZooW/micro-sedat-inbox (private) |
| Worker | `micro-sedat`, Cloudflare account of woozjoinemann@gmail.com |
| Live URL | https://micro-sedat.woozjoinemann.workers.dev |
| Static assets | `frontend/` served by the Worker (same origin as the API) |

The Worker is deployed but **not yet able to deliver submissions**, because `GITHUB_TOKEN` is a secret and
must be created and installed by the account owner.

## Remaining manual steps (required once)

1. Create a fine-grained personal access token:

   - GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new.
   - Repository access: **Only select repositories** → `WooZoZooW/micro-sedat-inbox`.
   - Permissions: **Repository permissions → Contents: Read and write**.
   - Suggested expiration: whatever matches your maintenance habits; renew when it expires.

2. Install the secrets into the Worker (runs in Termux or any machine with wrangler):

   ```bash
   cd backend
   wrangler secret put GITHUB_TOKEN      # paste the fine-grained PAT
   wrangler secret put ACCESS_CODE       # optional but recommended: long random ASCII string
   wrangler secret put ADMIN_TOKEN       # optional: enables GET /api/submissions/:id
   ```

3. Verify:

   ```bash
   curl -s https://micro-sedat.woozjoinemann.workers.dev/api/health
   # expect "configured":true
   ```

4. If `ACCESS_CODE` was set, open the site, submit anything, and enter the code in the dialog that appears.
   The code is stored locally in the browser and can also be shared as `https://.../#code=YOURCODE`.

## Redeploying after code changes

The esbuild used by wrangler cannot read the FUSE-mounted shared storage on this Android device
(`/storage/emulated/0/...`). Deploy from a copy on the internal filesystem:

```bash
cp -r /storage/emulated/0/Thunder/micro-sedat /data/data/com.termux/files/usr/tmp/opencode/micro-sedat-deploy
cd /data/data/com.termux/files/usr/tmp/opencode/micro-sedat-deploy
wrangler deploy --config backend/wrangler.toml
```

On a normal desktop OS, `npm run deploy` from the repository root works directly.

## Verify the destination inbox

```bash
GITHUB_TOKEN=<your PAT> node tools/verify-destination.mjs
```

The tool reports repository visibility and whether `Contents: Read and write` works. Never run it with the
token on the command line on a shared machine; use a local `.env` instead:

```bash
GITHUB_TOKEN=... npm run verify:destination   # reads .env via your shell or export it manually
```

## Free-tier limits and potential costs

| Service | Free tier | Notes |
| --- | --- | --- |
| Cloudflare Workers | 100,000 requests/day, static asset requests free, 10 ms CPU per request | Raw asset uploads avoid base64 CPU cost; default limits keep payloads ≤ 20 MB |
| Cloudflare Worker request size | 100 MB per request | We cap at 20 MB by default (`MAX_TOTAL_BYTES`) |
| GitHub private repo | Unlimited private repos, 1 GB LFS-free storage for release assets (soft) | Release assets are served from GitHub storage; free accounts have practical soft limits |
| GitHub API | 5,000 requests/hour for PATs | One submission costs ~4–6 API calls |

No paid service is required by this project.

## Optional: separate frontend hosting (GitHub Pages)

Not needed, because the Worker serves `frontend/` at the same origin. If you ever want to host the frontend
elsewhere:

1. Publish `frontend/` on the other host (for example GitHub Pages, branch `main`, folder `/frontend`).
2. Set `frontend/config.js` on that host to `{ apiBaseUrl: "https://micro-sedat.woozjoinemann.workers.dev" }`.
3. Add `ALLOWED_ORIGINS=https://<your-pages-host>` to `backend/wrangler.toml` `[vars]` and redeploy.

## Local development

```bash
cp .env.example .env       # fill placeholders
npm run dev                # http://127.0.0.1:8787
```

`GITHUB_API_BASE` and `GITHUB_UPLOAD_BASE` can point to a local mock (see `backend/test/helpers/mock-github.js`)
to exercise the full flow without touching real GitHub.
