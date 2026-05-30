#!/bin/bash
set -e

echo "--- Building the vantage-md library (frontend depends on it) ---"
cd packages/vantage-md
npm ci
npx tsup
cd ../..

echo "--- Building frontend ---"
cd frontend
npm ci
npm run build
cd ..

echo "--- Bundling frontend into the binary ---"
rm -rf web/dist
cp -r frontend/dist web/dist

echo "--- Building vantage ---"
go build -o vantage ./cmd/vantage

echo "--- Building static documentation site ---"
./vantage build userguide/ -o dist/docs -n "Vantage User Guide"

echo "--- Build complete ---"
