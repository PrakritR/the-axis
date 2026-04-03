#!/usr/bin/env bash
set -e

# Simple deploy script for GitHub Pages (Vite builds to `dist`)
# Installs gh-pages if missing, builds, then publishes `dist` to gh-pages branch.

if ! npx -y gh-pages --version >/dev/null 2>&1; then
  echo "Installing gh-pages..."
  npm install --save-dev gh-pages
fi

npm run build
cp dist/index.html dist/404.html
npx gh-pages -d dist
