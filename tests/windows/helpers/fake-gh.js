import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SHIM = `#!/usr/bin/env bash
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/fixtures"
cmd="\${1:-}"; shift || true
case "$cmd" in
  auth)
    if [ "\${1:-}" = "status" ]; then
      if [ -f "$dir/auth-fail" ]; then echo "not logged in" >&2; exit 1; fi
      echo "github.com"; echo "  ok (fake)"; exit 0
    fi
    ;;
  release)
    sub="\${1:-}"; shift || true
    case "$sub" in
      list)
        if [ -f "$dir/releases-fail" ]; then echo "HTTP 403: no access" >&2; exit 1; fi
        json=0; for a in "$@"; do [ "$a" = "--json" ] && json=1; done
        if [ "$json" = "1" ]; then cat "$dir/releases.json"; else printf 'TITLE\\tTYPE\\tTAG\\tPUBLISHED\\n'; fi
        exit 0 ;;
      view)
        tag="\${1:-}"; shift || true
        if [ -f "$dir/view-fail" ]; then echo "release not found" >&2; exit 1; fi
        name="\${tag#sub-}"
        if [ ! -f "$dir/view/$name.json" ]; then echo "release not found" >&2; exit 1; fi
        cat "$dir/view/$name.json"; exit 0 ;;
      download)
        tag="\${1:-}"; shift || true
        dst=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --dir) dst="$2"; shift 2 ;;
            --repo) shift 2 ;;
            *) shift ;;
          esac
        done
        if [ -f "$dir/download-fail-once" ] && [ ! -f "$dir/download-failed-once" ]; then
          touch "$dir/download-failed-once"; echo "network error" >&2; exit 1
        fi
        name="\${tag#sub-}"
        mkdir -p "$dst"
        if [ -d "$dir/assets/$name" ]; then cp "$dir/assets/$name"/* "$dst"/ 2>/dev/null || true; fi
        exit 0 ;;
    esac
    ;;
  api)
    p="\${1:-}"; shift || true
    if [ -f "$dir/api-fail" ]; then echo "Not Found" >&2; exit 1; fi
    id="$(basename "$p" .json)"
    if [ -f "$dir/api-bad-json" ]; then printf '%s' 'this is not json {{{' | base64 | tr -d '\\n'; echo; exit 0; fi
    if [ ! -f "$dir/meta/$id.json" ]; then echo "Not Found" >&2; exit 1; fi
    base64 < "$dir/meta/$id.json" | tr -d '\\n'; echo; exit 0 ;;
esac
echo "fake-gh: unhandled invocation: $cmd $*" >&2
exit 2
`;

export function createFakeGh(rootDir) {
  const binDir = path.join(rootDir, 'bin');
  const fixtureDir = path.join(rootDir, 'fixtures');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(path.join(fixtureDir, 'meta'), { recursive: true });
  mkdirSync(path.join(fixtureDir, 'view'), { recursive: true });
  mkdirSync(path.join(fixtureDir, 'assets'), { recursive: true });

  const shimPath = path.join(binDir, 'gh');
  writeFileSync(shimPath, SHIM);
  chmodSync(shimPath, 0o755);
  writeFileSync(path.join(fixtureDir, 'releases.json'), '[]');

  return {
    binDir,
    fixtureDir,
    shimPath,
    flag(name) {
      writeFileSync(path.join(fixtureDir, name), '');
    },
    setReleases(list) {
      writeFileSync(path.join(fixtureDir, 'releases.json'), JSON.stringify(list));
    },
    setMetadata(id, meta) {
      writeFileSync(path.join(fixtureDir, 'meta', `${id}.json`), JSON.stringify(meta, null, 2));
    },
    setView(id, view) {
      writeFileSync(path.join(fixtureDir, 'view', `${id}.json`), JSON.stringify(view));
    },
    addAsset(id, name, bytes) {
      const dir = path.join(fixtureDir, 'assets', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, name), bytes);
    },
  };
}

export function buildMetadata({
  id,
  text = 'Проверка кодировки: привет, мир',
  audioBytes = null,
  fileExpected = null,
  fileBytes = null,
  status = 'delivered',
  processingState = 'pending',
} = {}) {
  return {
    schema: 'micro-sedat/submission@1',
    id,
    status,
    processing: { state: processingState, note: 'test fixture' },
    receivedAt: '2026-10-11T19:09:00.545Z',
    clientCreatedAt: '2026-10-11T19:08:18.616Z',
    text,
    audio: audioBytes
      ? { asset: 'recording.m4a', name: 'recording.m4a', mime: 'audio/mp4', bytes: audioBytes.length, durationMs: 11004 }
      : null,
    files: fileExpected
      ? [{ asset: fileExpected, name: 'images (1) (8).jpeg', mime: 'image/jpeg', bytes: fileBytes.length }]
      : [],
    delivery: { mode: 'release', repo: 'WooZoZooW/micro-sedat-inbox', releaseTag: `sub-${id}` },
  };
}

export function assetEntry(name, bytes) {
  return { name, size: bytes.length, state: 'uploaded' };
}

export function buildView(id, assets, { isDraft = false } = {}) {
  return {
    tagName: `sub-${id}`,
    name: `Submission ${id}`,
    isDraft,
    isPrerelease: false,
    assets,
  };
}
