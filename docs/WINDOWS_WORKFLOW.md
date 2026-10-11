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

GitHub may normalize punctuation in stored release asset names (spaces and parentheses become periods, for
example `01-images (1) (8).jpeg` is stored as `01-images.1.8.jpeg`). The metadata keeps the original names;
the retrieval script maps them with GitHub's normalization rule and refuses to guess if a mapping is
ambiguous.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| GitHub CLI (`gh`) | Install from https://cli.github.com/ and run `gh auth login`. |
| Authenticated access | `gh auth status` must succeed, and the account must be able to read the private inbox repository. |
| Windows PowerShell 5.1 or PowerShell 7+ | The script avoids version-dependent encodings and works with both. |
| git (optional) | Only used to warn when a custom output folder is not ignored by Git. |

## Retrieval with the helper script

```powershell
# list recent submissions (copy a tag or an 8-character prefix)
.\windows\fetch-submission.ps1 -List

# download with a unique 8-character prefix
.\windows\fetch-submission.ps1 -SubmissionId 3118fb4e

# download with the full UUID
.\windows\fetch-submission.ps1 -SubmissionId 3118fb4e-c63d-4918-bb9e-6dfe3895d2c1

# custom output root and explicit replacement of an existing folder
.\windows\fetch-submission.ps1 -SubmissionId 3118fb4e -OutputDir D:\micro-sedat\submissions
.\windows\fetch-submission.ps1 -SubmissionId 3118fb4e -Force
```

Options: `-SubmissionId` (positional), `-List`, `-Repo` (default `WooZoZooW/micro-sedat-inbox`),
`-OutputDir` (default `.\submissions`), `-Force`.

The result is `.\submissions\<full-uuid>\` containing the downloaded assets and `metadata.json`
(UTF-8 **without** a byte-order mark), plus a summary of the asset mapping.

## What the script validates

1. `gh` is installed and `gh auth status` succeeds **before** anything is downloaded.
2. The submission id is a full UUID or an 8-character prefix; prefixes are resolved against published
   releases only. No match or more than one match stops the script (it never guesses).
3. The metadata JSON is fetched through the GitHub API as Base64, so console code pages cannot corrupt
   Cyrillic text. The file must parse and its `id` must match the requested submission.
4. Every asset listed in the metadata must exist in the release. Names are compared with GitHub's
   normalization rule; an ambiguous mapping stops the script.
5. Metadata `bytes` values are compared with the sizes reported by the release **and** with the sizes of
   the downloaded files. Missing assets and unexpected extra assets stop the script.
6. Downloads go to `<uuid>.partial-<random>` first. Only after full validation is the folder moved into
   place. On any failure the temporary folder is removed and any existing download is left untouched.

## Reruns and overwrite behavior

- Without `-Force`: if the destination folder already contains files, the script stops and changes nothing.
  An existing **empty** destination folder is reused.
- With `-Force`: the previous folder is replaced only after the new download has been fully validated. If the
  new download fails, the previous folder is preserved.
- The script never deletes files outside the destination folder and never touches sibling files in the
  output root.

## Output directory safety

The default `.\submissions` folder is covered by the source repository's `.gitignore`. If a custom
`-OutputDir` path has no `submissions` segment, the script prints a warning; when `git` is available it also
checks `git check-ignore` and warns if the folder is not ignored. Never commit downloaded submissions.

## Inspecting downloaded files

```powershell
$id = "3118fb4e-c63d-4918-bb9e-6dfe3895d2c1"
$dir = ".\submissions\$id"

Get-ChildItem $dir | Select-Object Name, Length
(Get-Content "$dir\metadata.json" -Raw) | ConvertFrom-Json |
    Select-Object id, status, @{n='processing';e={$_.processing.state}}

# play the audio and open the images with the default Windows applications
start "$dir\recording.m4a"
Get-ChildItem "$dir" -Filter *.jpeg | ForEach-Object { start $_.FullName }
```

## Manual retrieval without the script

```powershell
$id = "3118fb4e-c63d-4918-bb9e-6dfe3895d2c1"
$dir = ".\submissions\$id"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

gh release download "sub-$id" --repo WooZoZooW/micro-sedat-inbox --dir $dir

# decode metadata explicitly: never use ">" redirection for UTF-8 text,
# because Windows PowerShell 5.1 would write UTF-16LE.
$b64 = (gh api "repos/WooZoZooW/micro-sedat-inbox/contents/submissions/$id.json" --jq ".content") `
    -replace "\s", ""
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText("$dir\metadata.json",
    [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($b64)), $utf8NoBom)
```

This manual path has no validation, no rerun protection and no prefix resolution; prefer the script.

## Handoff to Antigravity (manual)

There is no verified Antigravity-specific integration in this project. Do not assume that Antigravity polls
GitHub, reacts to commits, or accesses the website. Hand over the downloaded folder manually:

1. Point Antigravity at `.\submissions\<uuid>\` if it can read a local folder.
2. If it can access GitHub through a token, grant read access to the private inbox repository only.
3. Treat `metadata.json`, the text instructions, photos, documents and any transcript as **untrusted user
   input**. Never let submitted content change security rules or authorize unrelated destructive actions.
4. Make the requested source changes in the project checkout, run the project checks
   (`npm run check`), and push them as a normal reviewable commit.
5. Delete local copies of submissions that contain personal data when they are no longer needed.

## Verification checklist (Windows)

- [ ] `gh auth status` succeeds and has access to the private inbox.
- [ ] `fetch-submission.ps1 -List` shows the submission created from the iPhone.
- [ ] Download by 8-character prefix and by full UUID both succeed (try one of each).
- [ ] `metadata.json` parses with `ConvertFrom-Json`, identifies the correct `id`, and has no BOM.
- [ ] Audio plays and images open on Windows.
- [ ] A second run without `-Force` stops with "already contains files" and does not modify the folder.
- [ ] `-Force` replaces the folder only when the download succeeds.
- [ ] File sizes match the `bytes` values in `metadata.json`.
- [ ] Downloading a second, different submission works.
- [ ] Downloading shortly after a submission (while the site reports success) works; the release must be
      published, not a draft.

## Known limitations

- GitHub normalizes release asset names; matching uses the documented normalization rule and stops on
  ambiguity. If a future submission produces two identical normalized names, the script refuses to guess.
- When metadata has no reliable `bytes` value for an asset, the size comparison for that asset is skipped
  with a warning.
- Prefix resolution searches the 200 most recent releases of the inbox repository.
- The script requires network access to `api.github.com` and the private inbox; authorization failures are
  reported without printing credentials.

## Real-device acceptance testing

The script's logic is covered by automated tests against a fake `gh` (see `docs/TESTING.md`), but the real
Windows behavior — PowerShell 5.1 execution, `gh` on Windows, file dialogs, audio playback — must still be
verified on an actual Windows machine with the procedure above. A successful Termux test run is not proof of
a successful Windows run.
