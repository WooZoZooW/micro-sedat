# Manual verification on a real iPhone

These steps require a physical iPhone and Safari. They have **not** been executed in this environment
(Android Termux has no iPhone). Treat every item as unverified until performed.

Prerequisites: the Worker is deployed and `GITHUB_TOKEN` is installed (`/api/health` → `"configured":true`).

## Steps

1. Open `https://micro-sedat.woozjoinemann.workers.dev` in Safari (HTTPS is required for the microphone).
2. Allow microphone access when Safari asks. On denial: Settings → Safari → Microphone → Allow, then reload.
3. Press and hold the microphone button while speaking. Expected: the button turns red, the timer runs, the
   hint changes to "Идёт запись…". Release: the recording appears with playback controls.
4. Verify the recording duration is sane and playback sounds correct. Delete it, record again. Verify the
   previous recording is gone.
5. While recording, swipe the finger off the button and release. Expected: recording stops normally (pointer
   capture). While recording, switch apps or lock the phone. Expected: recording is cancelled with the
   Russian cancellation message, not a stuck UI.
6. Tap "Прикрепить фото или файл" → Photo Library → select two photos. Verify thumbnails, filenames, sizes.
7. Attach a PDF through Files. Attach a HEIC photo. Previews may not render for all formats; a format badge
   is expected instead — this is normal.
8. Attach a file twice with the same name. Expected: the second entry is renamed (`photo (2).jpg`) and both
   remain. Remove one attachment and verify the other stays.
9. Enter text in "Дополнительные указания". Verify the counter updates.
10. Submit a package with only text, only a file, and only audio in three separate attempts (use different
    content). All three must succeed.
11. Submit with airplane mode enabled. Expected: a Russian network error, the draft is preserved, the button
    becomes "Повторить отправку". Disable airplane mode, retry. Expected: success with a submission number.
12. After success, reload the page. Expected: no restore banner (draft cleared).
13. Prepare a draft, force-quit Safari, reopen the site. Expected: the restore banner appears and restoring
    brings back audio, attachments and text.
14. If `ACCESS_CODE` is set, verify the access code dialog appears, rejects a wrong code and accepts the
    right one.
15. Verify the final result in the private inbox repository: the release `sub-<id>` exists with all assets,
    and `submissions/<id>.json` contains the correct Russian text and file metadata.

## Known iOS caveats

- Audio codec depends on the device/version; the client probes `audio/mp4` first and the file is stored with
  the extension that matches what was actually recorded.
- Safari suspends pages in the background; this implementation cancels (not saves) recordings when the page
  is hidden, to avoid corrupt audio. Verify the cancellation message on step 5.
- Very long recordings are most sensitive to memory; keep recordings under the configured `MAX_AUDIO_BYTES`.
