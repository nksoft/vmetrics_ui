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

# Update version in local config.yaml
sed -i "s/^version:.*/version: \"${VERSION}\"/" config.yaml

# Update Dockerfile version
sed -i "s/io.hass.version=\"[^\"]*\"/io.hass.version=\"${VERSION}\"/" Dockerfile

# Temporarily add image field to config.yaml for GitHub
if ! grep -q "^image:" config.yaml; then
  sed -i '/^arch:/i image: ghcr.io/nksoft/vmetrics_ui' config.yaml
fi

# Git commit and push
git add -A
git commit -m "Release v${VERSION}"
git tag -a "v${VERSION}" -m "Release v${VERSION}" --force
git push origin master --force
git push origin "v${VERSION}" --force

# Remove image field from local config.yaml (for local SMB deploy)
sed -i '/^image:/d' config.yaml

echo "=== Done! Release v${VERSION} created ==="
echo "Check: https://github.com/nksoft/vmetrics_ui/releases"
