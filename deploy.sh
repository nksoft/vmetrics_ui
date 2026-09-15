#!/bin/bash
set -e

VERSION="${1:?Usage: ./deploy.sh <version>}"

echo "=== Deploying v${VERSION} ==="

# Build frontend
echo "Building frontend..."
cd frontend
npm ci
npm run build
cd ..

# Save current config.yaml and swap in GitHub version
cp config.yaml config.yaml.local
cp vmetrics_ui_github/config.yaml config.yaml.github

# Update version in GitHub config.yaml
sed -i "s/^version:.*/version: \"${VERSION}\"/" config.yaml.github
cp config.yaml.github config.yaml

# Update Dockerfile LABEL version
sed -i "s/version=\"[^\"]*\"/version=\"${VERSION}\"/" Dockerfile

# Git commit and push
git add -A
git commit -m "Release v${VERSION}" || echo "No changes to commit"
git tag -a "v${VERSION}" -m "Release v${VERSION}" --force
git push origin main --force
git push origin "v${VERSION}" --force

# Restore local config.yaml
cp config.yaml.local config.yaml
rm -f config.yaml.local config.yaml.github

echo "=== Done! Release v${VERSION} created ==="
echo "Check: https://github.com/nksoft/vmetrics_ui/releases"
