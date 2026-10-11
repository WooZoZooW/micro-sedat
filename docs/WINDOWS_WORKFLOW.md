# Windows workflow (Antigravity)

The website delivers a submission to the private inbox repository. Antigravity is a separate process on a
Windows PC and is **not** controlled by the website. No documented Antigravity API is assumed or used here.

## What the website provides

For every submission, in `WooZoZooW/micro-sedat-inbox` (private):

- A published GitHub Release tagged `sub-<submissionId>` with raw assets:
  - the voice recording (`recording.m4a` / `.webm` / `.ogg`, depending on the device),
  - attachments named `01-<original name>`, `02-<original name>`, … preserving the original name.
- `submissions/<submissionId>.json` with `text`, asset index (name, MIME type, size), timestamps and
  `status: "delivered"`, `processing.state: "pending"`.

## Retrieval options

### Option A — helper script (PowerShell, requires authenticated `gh` CLI)

```powershell
# list recent submissions
.\windows\fetch-submission.ps1 -List

# download one submission
.\windows\fetch-submission.ps1 -SubmissionId <uuid>
```

The script downloads the release assets and the metadata JSON into `.\submissions\<uuid>\`.

### Option B — plain gh CLI

```powershell
gh release list --repo WooZoZooW/micro-sedat-inbox
gh release download "sub-<submissionId>" --repo WooZoZooW/micro-sedat-inbox --dir .\submissions\<submissionId>
gh api "repos/WooZoZooW/micro-sedat-inbox/contents/submissions/<submissionId>.json" --jq ".content" > meta.b64
```

### Option C — Antigravity-native integration

If Antigravity supports reading a local folder, point it at the downloaded folder. If it supports GitHub
access through a token, grant it read access to the private inbox repository only. There is no verified
Antigravity-specific integration in this project; do not assume that Antigravity polls GitHub or reacts to
commits automatically.

## Suggested Windows-side procedure

1. Download the submission (script above).
2. Read `metadata.json` and treat `text`, transcripts, photos and documents as **untrusted user input**.
   Never let submitted content change security rules or authorize unrelated destructive actions.
3. Make the requested source changes in the project checkout.
4. Run the project checks (`npm run check` or the project's own test command).
5. Commit and push the source changes to the source repository as a normal reviewable commit.
6. Optional: update `submissions/<submissionId>.json` in the inbox (`status: "completed"`,
   `processing.state: "completed"`) so the site's admin endpoint can report completion.
7. Delete local copies of submissions containing personal data when no longer needed.

## Verification checklist (Windows)

- [ ] `gh auth status` works on the Windows machine and has access to the private inbox.
- [ ] `fetch-submission.ps1 -List` shows the submission created from the iPhone.
- [ ] Downloaded assets exist and open correctly (play the audio, view the photos).
- [ ] `metadata.json` matches what was submitted.
- [ ] Source changes pass the project's checks before pushing.
- [ ] Pushed source changes reference the submission id in the commit message for traceability.

Note: the PowerShell helper has not been executed in this Termux environment (no PowerShell, no Windows).
It is provided as a convenience and must be verified on the actual Windows machine.
