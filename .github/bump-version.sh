#!/bin/sh
set -eu

# --- CONFIG ---
MAKEFILE_PATH="./Makefile"   # Pfad zum Makefile anpassen falls nötig
# ----------------

usage() {
  echo "Usage: $0 [major|minor|patch] [branch]"
  echo "  branch is optional (defaults to current branch)"
  exit 1
}

PART="${1:-}"
BRANCH="${2:-}"

if [ -z "$PART" ]; then
  usage
fi

if [ ! -f "$MAKEFILE_PATH" ]; then
  echo "Error: Makefile not found at $MAKEFILE_PATH" >&2
  exit 1
fi

# --- Check for clean working tree ---
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is not clean. Commit or stash your changes first." >&2
  git status --short
  exit 1
fi

# --- Read current version ---
CURRENT_VERSION=$(grep -E '^\s*PKG_VERSION\s*:=' "$MAKEFILE_PATH" | sed -n '1p' | awk '{print $3:-}')

if [ -z "$CURRENT_VERSION" ]; then
  echo "Error: PKG_VERSION not found in $MAKEFILE_PATH" >&2
  exit 1
fi

# --- Determine branch ---
if [ -z "$BRANCH" ]; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
fi

# --- Split version ---
IFS='.' read -r MAJOR MINOR PATCH <<EOF
$CURRENT_VERSION
EOF

case "$PART" in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    RESET_RELEASE=1
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    RESET_RELEASE=1
    ;;
  patch)
    PATCH=$((PATCH + 1))
    RESET_RELEASE=0
    ;;
  *)
    echo "Invalid part: $PART (must be major, minor, or patch)" >&2
    usage
    ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
echo "Bumping PKG_VERSION: ${CURRENT_VERSION} -> ${NEW_VERSION} (branch: ${BRANCH})"

# --- Update PKG_VERSION ---
sed -i -E "0,/^\s*PKG_VERSION\s*:=\s*[0-9]+\.[0-9]+\.[0-9]+/s//PKG_VERSION       := ${NEW_VERSION}/" "$MAKEFILE_PATH"
echo "Updated PKG_VERSION in $MAKEFILE_PATH"

# --- Reset PKG_RELEASE if needed ---
if [ "${RESET_RELEASE:-0}" -eq 1 ]; then
  if grep -Eq '^\s*PKG_RELEASE\s*:=' "$MAKEFILE_PATH"; then
    sed -i -E "s/^\s*PKG_RELEASE\s*:=[ \t]*[0-9]+/PKG_RELEASE       := 1/" "$MAKEFILE_PATH"
    echo "PKG_RELEASE reset to 1"
  fi
fi

# --- Git commit, tag, push ---
git add "$MAKEFILE_PATH"

git config user.name "github-actions[bot]" >/dev/null 2>&1 || true
git config user.email "github-actions[bot]@users.noreply.github.com" >/dev/null 2>&1 || true

git commit -m "chore: bump PKG_VERSION to ${NEW_VERSION} [skip ci]" || true
git push origin "HEAD:${BRANCH}"

TAG="v${NEW_VERSION}"

# Prevent duplicate tags
if git rev-parse --verify --quiet "refs/tags/${TAG}" >/dev/null; then
  echo "Error: Tag ${TAG} already exists locally." >&2
  exit 1
fi
if git ls-remote --tags origin | awk '{print $2}' | grep -x "refs/tags/${TAG}" >/dev/null 2>&1; then
  echo "Error: Tag ${TAG} already exists on origin." >&2
  exit 1
fi

git tag -a "${TAG}" -m "Release ${TAG}"
git push origin "${TAG}"

echo "✅ Version updated, committed, and tagged ${TAG}"
