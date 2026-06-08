#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

cp "$ROOT_DIR/index.html" "$DIST_DIR/"
cp "$ROOT_DIR/manifest.json" "$DIST_DIR/"
cp "$ROOT_DIR/service-worker.js" "$DIST_DIR/"
cp "$ROOT_DIR/_headers" "$DIST_DIR/"
cp -R "$ROOT_DIR/assets" "$DIST_DIR/"
cp -R "$ROOT_DIR/data" "$DIST_DIR/"
cp -R "$ROOT_DIR/js" "$DIST_DIR/"

echo "Built Cloudflare Pages bundle in $DIST_DIR"
