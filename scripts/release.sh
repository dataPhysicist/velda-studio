#!/usr/bin/env bash
# Build, commit and push a CDN release, then point toolbelt/index.html at it.
# Usage: scripts/release.sh <asset-ref-sha> "<message>"
set -euo pipefail
ASSET_REF="$1"; MSG="${2:-Release}"
TRAILER=$'\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01CTnZuJVdnvWLnatbXgs5nM'
git add -A src scripts README.md package.json package-lock.json index.html || true
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -q -m "$MSG$TRAILER" || true
rm -rf dist
STUDIO_ASSET_REF="$ASSET_REF" npm run build:cdn >/dev/null
git add -A dist
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -q -m "Build for the CDN$TRAILER"
git push -q origin HEAD:main
SHA=$(git rev-parse HEAD)
sed -i -E "s#velda-studio@[0-9a-f]{40}/dist#velda-studio@$SHA/dist#g; s#var FALLBACK = '[0-9a-f]{40}'#var FALLBACK = '$SHA'#" toolbelt/index.html
printf '{"sha": "%s", "released": "%s"}\n' "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > release.json
git add toolbelt/index.html release.json
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -q -m "Point the Toolbelt loader at $SHA$TRAILER"
git push -q origin HEAD:main
echo "$SHA"
