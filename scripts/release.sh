#!/usr/bin/env bash
# Build, commit and push a CDN release, then point release.json and toolbelt/index.html at it.
#
# Usage: scripts/release.sh <asset-ref-sha> "<message>"
#   <asset-ref-sha>  a commit that contains the current assets/ folder (jsDelivr serves assets from it)
#
# Environment:
#   STUDIO_DB        workspace database the build saves to. Default velda_studio.duckdb (the live
#                    schemes, since 1.0); STUDIO_DB=velda_studio_dev.duckdb makes a test-copy build.
#   RELEASE_TRAILER  optional lines appended to each commit message (attribution); none by default.
#   SKIP_CHECK=1     skip npm run check (never for a real release; for re-pointing an existing build).
#   PW_CHROMIUM_PATH Chromium for the browser tests where Playwright's download is blocked.
set -euo pipefail
ASSET_REF="${1:?usage: scripts/release.sh <asset-ref-sha> \"<message>\"}"
MSG="${2:-Release}"
export STUDIO_DB="${STUDIO_DB:-velda_studio.duckdb}"
TRAILER=""
if [ -n "${RELEASE_TRAILER:-}" ]; then TRAILER=$'\n\n'"$RELEASE_TRAILER"; fi
commit() { git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -q -m "$1$TRAILER"; }

if [ "${SKIP_CHECK:-}" != "1" ]; then
  echo "Running npm run check before releasing (database: $STUDIO_DB)"
  if ! npm run check; then
    echo "npm run check failed; not releasing." >&2
    exit 1
  fi
fi

# Only paths that exist: one missing path makes git add stage nothing at all.
PATHS=()
for p in src scripts tests schema docs .github toolbelt README.md package.json package-lock.json index.html \
  vite.config.ts vitest.config.ts playwright.config.ts tsconfig.json tsconfig.node.json .gitignore; do
  [ -e "$p" ] && PATHS+=("$p")
done
git add -A "${PATHS[@]}"
if git diff --cached --quiet; then echo "Nothing new to commit before the build."; else commit "$MSG"; fi

rm -rf dist
STUDIO_ASSET_REF="$ASSET_REF" npm run build:cdn >/dev/null
git add -A dist
if git diff --cached --quiet; then
  echo "The build is the same as the last one; pointing at it again."
else
  commit "Build for the CDN (database $STUDIO_DB)"
fi

# A shallow clone must be current with main before pushing, or the push re-sends the whole tree.
git fetch -q origin main
if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "main moved on GitHub; rebase onto origin/main and run again." >&2
  exit 1
fi
git push -q origin HEAD:main
SHA=$(git rev-parse HEAD)
sed -i -E "s#velda-studio@[0-9a-f]{40}/dist#velda-studio@$SHA/dist#g; s#var FALLBACK = '[0-9a-f]{40}'#var FALLBACK = '$SHA'#" toolbelt/index.html
printf '{"sha": "%s", "released": "%s", "database": "%s"}\n' "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STUDIO_DB" > release.json
git add toolbelt/index.html release.json
commit "Point the Toolbelt loader at $SHA"
git push -q origin HEAD:main
echo "$SHA"
