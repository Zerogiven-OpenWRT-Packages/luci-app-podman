#!/bin/sh
set -e

# === CONFIG ===
MAKEFILE_PATH="./../Makefile"   # Pfad zum Makefile anpassen falls nötig
# ===============

PART="$1"

if [ -z "$PART" ]; then
  echo "Usage: $0 [major|minor|patch]"
  exit 1
fi

if [ ! -f "$MAKEFILE_PATH" ]; then
  echo "Error: Makefile not found at $MAKEFILE_PATH"
  exit 1
fi

CURRENT_VERSION=$(grep -E '^PKG_VERSION\s*:=' "$MAKEFILE_PATH" | awk '{print $3}')

if [ -z "$CURRENT_VERSION" ]; then
  echo "Error: PKG_VERSION not found in $MAKEFILE_PATH"
  exit 1
fi

IFS='.' read -r MAJOR MINOR PATCH <<EOF
$CURRENT_VERSION
EOF

case "$PART" in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
  *)
    echo "Invalid argument: $PART (must be major, minor, or patch)"
    exit 1
    ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

# Update Makefile
sed -i -E "s/^(PKG_VERSION\s*:=\s*).*/\1${NEW_VERSION}/" "$MAKEFILE_PATH"

echo "✅ Version bumped: ${CURRENT_VERSION} → ${NEW_VERSION}"

# Git commit + tag
git add "$MAKEFILE_PATH"
git commit -m "Bump version to ${NEW_VERSION}"
git tag "v${NEW_VERSION}"

echo "✅ Committed and tagged v${NEW_VERSION}"
