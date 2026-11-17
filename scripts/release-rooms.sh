#!/usr/bin/env bash
# Build Rooms (dist/rooms.js, dist/rooms.css), commit and push it on the current branch, then point
# rooms-release.json at that commit. The Rooms page in Toolbelt (apps/velda-rooms/index.html, a copy of
# toolbelt/rooms.html) reads rooms-release.json from main, then from the rooms branch.
#
# Usage: scripts/release-rooms.sh "<message>"
#   STUDIO_DB        database the build saves to (default velda_studio.duckdb; the test copy is velda_studio_dev.duckdb)
#   RELEASE_TRAILER  optional lines appended to each commit message
#   SKIP_CHECK=1     skip the Rooms tests (type-check, unit tests, the Rooms browser test)
set -euo pipefail
MSG="${1:-Rooms release}"
export STUDIO_DB="${STUDIO_DB:-velda_studio.duckdb}"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
TRAILER=""
if [ -n "${RELEASE_TRAILER:-}" ]; then TRAILER=$'\n\n'"$RELEASE_TRAILER"; fi
commit() { git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -q -m "$1$TRAILER"; }
if [ "${SKIP_CHECK:-}" != "1" ]; then
  npm run typecheck
  npx vitest run tests/rooms
  npx playwright test tests/e2e/rooms.spec.ts
fi
npx vite build --config vite.rooms.config.ts --logLevel error
git add -A src/rooms src/toolbelt.ts tests/rooms tests/e2e/rooms.spec.ts scripts/release-rooms.sh toolbelt/rooms.html rooms.html vite.rooms.config.ts package.json docs dist/rooms.js dist/rooms.css
if git diff --cached --quiet; then echo "Nothing new to commit."; else commit "$MSG"; fi
git -c push.negotiate=true push -q origin "HEAD:$BRANCH"
SHA=$(git rev-parse HEAD)
sed -i -E "s#var FALLBACK = '[0-9a-f]{40}'#var FALLBACK = '$SHA'#" toolbelt/rooms.html
printf '{"sha": "%s", "released": "%s", "database": "%s"}\n' "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STUDIO_DB" > rooms-release.json
git add toolbelt/rooms.html rooms-release.json
commit "Point the Rooms loader at $SHA"
git -c push.negotiate=true push -q origin "HEAD:$BRANCH"
echo "$SHA"
