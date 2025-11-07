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

# --- helper: portable sed -i (GNU vs BSD/macOS) ---
# Usage: sed_inplace 's/old/new/' file
sed_inplace() {
  expr=$1
  file=$2
  # detect GNU sed (has --version)
  if sed --version >/dev/null 2>&1; then
    sed -i -E "$expr" "$file"
  else
    # BSD/macOS sed needs an argument for -i (empty string)
    sed -i '' -E "$expr" "$file"
  fi
}

# --- Check for clean working tree ---
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is not clean. Commit or stash your changes first." >&2
  git status --short
  exit 1
fi

# --- Read current version ---
# Extract first matching PKG_VERSION line and take third field (the version)
# Example line: PKG_VERSION       := 1.2.3
CURRENT_VERSION=$(awk '/^[[:space:]]*PKG_VERSION[[:space:]]*:=[[:space:]]*/ { print $3; exit }' "$MAKEFILE_PATH" || true)

if [ -z "$CURRENT_VERSION" ]; then
  echo "Error: PKG_VERSION not found in $MAKEFILE_PATH" >&2
  exit 1
fi

# --- Determine branch ---
if [ -z "$BRANCH" ]; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
fi

# --- Split version ---
# Ensure we have three numeric parts (simple check)
IFS='.' read -r MAJOR MINOR PATCH <<EOF
$CURRENT_VERSION
EOF

# sanity numeric check (allow leading zeros)
case "$MAJOR" in (*[!0-9]*|"") echo "Invalid MAJOR: $MAJOR" >&2; exit 1;; esac
case "$MINOR" in (*[!0-9]*|"") echo "Invalid MINOR: $MINOR" >&2; exit 1;; esac
case "$PATCH" in (*[!0-9]*|"") echo "Invalid PATCH: $PATCH" >&2; exit 1;; esac

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

# --- Update PKG_VERSION (only first match) ---
# keep original spacing before := by replacing the whole line with a standard spacing
# use portable sed_inplace helper
sed_inplace "/^([[:space:]]*PKG_VERSION[[:space:]]*:=[[:space:]]*)[0-9]+\.[0-9]+\.[0-9]+/s//\1${NEW_VERSION}/" "$MAKEFILE_PATH"
echo "Updated PKG_VERSION in $MAKEFILE_PATH"

# --- Reset PKG_RELEASE if needed ---
if [ "${RESET_RELEASE:-0}" -eq 1 ]; then
  echo "--${RESET_RELEASE}"
  if awk '/^[[:space:]]*PKG_RELEASE[[:space:]]*:=[[:space:]]*/ { exit 0 } END { exit 1 }' "$MAKEFILE_PATH"; then
    sed_inplace "/^([[:space:]]*PKG_RELEASE[[:space:]]*:[=][[:space:]])*[0-9]+/\1 1/" "$MAKEFILE_PATH"
    echo "PKG_RELEASE reset to 1"
  fi
fi

exit

# --- Git commit, tag, push ---
git add "$MAKEFILE_PATH"

git config user.name "github-actions[bot]" >/dev/null 2>&1 || true
git config user.email "github-actions[bot]@users.noreply.github.com" >/dev/null 2>&1 || true

# commit only if something changed
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git commit -m "chore: bump PKG_VERSION to ${NEW_VERSION} [skip ci]" || true
  git push origin "HEAD:${BRANCH}"
  echo "Committed and pushed Makefile change to ${BRANCH}"
else
  echo "No changes to commit"
fi

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
# git push origin "${TAG}"

echo "✅ Version updated, committed, and tagged ${TAG}"
