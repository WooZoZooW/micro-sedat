# Testing guide

Everything runs with the Node.js built-in test runner and has **zero npm dependencies**, which matters in
Android Termux where native modules are often unavailable.

## Commands

```bash
npm run lint               # syntax checks, secret scan, HTML/config checks
npm test                   # all tests (Node default discovery)
npm run test:frontend      # frontend pure-logic tests
npm run test:backend       # backend unit + integration tests
npm run test:integration   # only the HTTP end-to-end tests
npm run check              # lint + all tests
```

Last executed in this environment (Node v26.4.0, Android aarch64, Termux):

| Command | Result |
| --- | --- |
| `node --test "tests/frontend/*.test.js"` | 37 passed, 0 failed |
| `node --test "backend/test/*.test.js"` | 34 passed, 0 failed |
| `node --test "tests/windows/*.test.js"` (with PowerShell, see below) | 30 passed, 0 failed |
| `node tools/lint.mjs` | OK — 50 files, 34 scripts checked |

## What each layer covers

| Layer | Files | Coverage |
| --- | --- | --- |
| Static validation | `tools/lint.mjs` | `node --check` on every script, secret patterns, `.gitignore` hygiene, HTML requirements (lang, viewport, required elements, no external resources), no backend secret names in frontend files, `wrangler.toml` sanity |
| Frontend unit | `tests/frontend/*.test.js` | formatting, filename sanitizing and duplicate names, MIME probing order, draft validation, FormData serialization, state machine transitions, Russian error mapping, XHR upload flow with a fake XHR, draft persistence serialization |
| Backend unit | `backend/test/validate.test.js`, `github.test.js`, `app.test.js` | validation rules, filename sanitizing, idempotency, GitHub release/contents delivery against a mock GitHub HTTP server, error mapping (401/403/422/rate limit), partial-failure cleanup, access code, rate limit, CORS, admin status endpoint, size limits |
| Integration | `backend/test/integration.test.js` | real `node-server` process, real HTTP, static file serving, end-to-end multipart submission to a mock GitHub, duplicate retry, path traversal rejection |
| Windows script (static) | `tests/windows/fetch-submission.static.test.js` | the PowerShell script never uses encoding-dependent cmdlets, writes metadata through .NET UTF-8 without BOM, checks `gh` and `gh auth status` first, validates UUID/prefix formats, resolves prefixes without guessing, maps normalized asset names, validates sizes/missing/unexpected assets, downloads to a partial folder with cleanup, guards existing folders and `-Force`, warns about unsafe output directories; the workflow documentation matches the script contract |
| Windows script (behavior) | `tests/windows/fetch-submission.behavior.test.js` | executes `windows/fetch-submission.ps1` with real PowerShell against a fake `gh` shim: full UUID, unique 8-character prefix, draft filtering, no match, ambiguity, malformed id, missing `gh`, missing auth, invalid metadata JSON, metadata id mismatch, missing asset, size mismatch, unexpected asset, existing folder with/without `-Force`, failed `-Force` re-download preserving the old folder, unrelated files untouched, text-only submissions, BOM-free Cyrillic metadata |

## Running the Windows retrieval tests

The behavior tests need a real PowerShell. They run automatically when `pwsh` is on `PATH` (for example on a
Windows machine or a Linux host with PowerShell installed). Otherwise they are reported as skipped:

```bash
node --test tests/windows/fetch-submission.behavior.test.js          # uses pwsh from PATH
MICRO_SEDAT_PWSH=/path/to/pwsh-wrapper node --test tests/windows/   # custom pwsh launcher
```

In this Termux environment the tests were executed with PowerShell 7.4.6 (Linux arm64) installed inside the
existing Debian `proot-distro` container and a wrapper that passes `DOTNET_GCHeapHardLimit=40000000`
(required by .NET under proot). That is a development-environment detail, not a project dependency.
Windows PowerShell 5.1 execution was **not** possible anywhere in this environment; the script avoids
version-dependent encodings by design, but 5.1 must still be confirmed on a real Windows machine.

## Real vs mocked

- The GitHub API is **mocked** in automated tests (`backend/test/helpers/mock-github.js` — a local HTTP
  server implementing the endpoints used; `tests/windows/helpers/fake-gh.js` — a fake `gh` executable).
  No test writes to GitHub and no test touches the real production submission.
- The HTTP layers are real in integration tests; GitHub is replaced by the mock via
  `GITHUB_API_BASE` / `GITHUB_UPLOAD_BASE`.
- The behavior tests execute the genuine PowerShell script; only `gh` is faked. They do not prove that
  `gh` itself behaves identically on Windows, nor that Windows PowerShell 5.1 behaves like PowerShell 7.
- Browser automation (Playwright/Chromium) is **not available** in this Termux environment and was not
  attempted beyond checking that desktop browser binaries are absent. DOM code in `frontend/app.js` is
  therefore covered only by manual device testing plus unit tests of its pure modules.
- Microphone capture cannot be tested automatically; see `docs/IPHONE_CHECKLIST.md`.

## Continuous integration

`docs/ci-check.example.yml` contains a ready GitHub Actions workflow that runs `npm run lint` and
`npm test` on push. It is stored outside `.github/workflows/` because the GitHub token used in this
environment lacks the `workflow` OAuth scope. To enable CI, copy it to `.github/workflows/check.yml`
using the GitHub web UI or a token that has the `workflow` scope.
