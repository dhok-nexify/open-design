#!/usr/bin/env bash
# Build the NexTore Designer Linux tarball (NXD-D36).
#
# Produces a self-contained payload: the daemon production bundle, the built web
# app, the bundled content directories, the vendored offline assets and the
# installer files. Node 24 and bubblewrap are provided by the host; the pinned
# opencode CLI is installed by install.sh from the pinned version in this repo.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../.."

VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
ARCH="${ARCH:-$(uname -m)}"
OUT="${OUT:-dist/nextore-designer-${VERSION}-linux-${ARCH}.tar.gz}"
STAGE=".tmp/nextore-tarball"

echo "building daemon and web"
pnpm --filter @open-design/daemon build
pnpm --filter @open-design/web build

echo "staging ${STAGE}"
rm -rf "$STAGE"
mkdir -p "$STAGE/apps"

pnpm --filter @open-design/daemon deploy --legacy --prod "$STAGE/apps/daemon"
cp -R apps/daemon/vendor "$STAGE/apps/daemon/vendor"
mkdir -p "$STAGE/apps/web"
cp -R apps/web/out "$STAGE/apps/web/out"

for entry in skills design-systems craft prompt-templates data assets/frames assets/community-pets plugins/_official; do
  mkdir -p "$STAGE/$(dirname "$entry")"
  cp -R "$entry" "$STAGE/$entry"
done

mkdir -p "$STAGE/install"
cp deploy/nextore/linux/install.sh "$STAGE/install/install.sh"
cp deploy/nextore/linux/nextore-designer.service.in "$STAGE/install/nextore-designer.service.in"
cp deploy/nextore/linux/designer.env.example "$STAGE/install/designer.env.example"
cp deploy/nextore/linux/OPENCODE_VERSION "$STAGE/install/OPENCODE_VERSION"
chmod 0755 "$STAGE/install/install.sh"

echo "packing $OUT"
mkdir -p "$(dirname "$OUT")"
tar --owner=0 --group=0 --numeric-owner -C "$STAGE" -czf "$OUT" .
sha256sum "$OUT" > "$OUT.sha256"
echo "wrote $OUT"
