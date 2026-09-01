#!/bin/bash
#
# Builds the static user-guide site into dist/docs.
#
# Run by Cloudflare Workers Builds, whose build command names this path and
# whose deploy command is `npx wrangler deploy --config docs-wrangler.toml`.
# Both live in the Cloudflare dashboard, not in this repo, so a rename here is
# invisible to CI and breaks the deploy silently: the command read
# `bash build-docs.sh` from 2026-05-30, when that file was deleted, until
# 2026-09-01 — three months of a red check on every PR that nothing in the
# tree could have caught.
#
set -e

echo "--- Installing the workspace ---"
npm ci

echo "--- Building the vantage-md library (frontend depends on it) ---"
npm exec --workspace vantage-md -- tsup

echo "--- Building frontend ---"
npm run build --workspace frontend

# Mirrors the `web-sync` recipe in the Justfile, which is the one place allowed
# to rewrite the tracked web/dist export. Keep the two in step: this script ran
# for three months with a plain `cp -r frontend/dist web/dist`, which drops the
# tracked `.gitkeep` and left every local run with a dirty tree.
echo "--- Bundling frontend into the binary ---"
rm -rf web/dist
mkdir -p web/dist
cp -R frontend/dist/. web/dist/
touch web/dist/.gitkeep

echo "--- Building vantage ---"
go build -o vantage ./cmd/vantage

echo "--- Building static documentation site ---"
./vantage build userguide/ -o dist/docs -n "Vantage User Guide"

echo "--- Build complete ---"
