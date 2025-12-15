#!/bin/bash
#
# POT File Updater for LuCI App Podman
# Regenerates the POT file from JavaScript source code
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
POT_FILE="$PROJECT_ROOT/po/templates/podman.pot"
HTDOCS_DIR="$PROJECT_ROOT/htdocs"

# Colors for output
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Temp files
CODE_STRINGS=$(mktemp)

# Cleanup on exit
trap "rm -f $CODE_STRINGS" EXIT

echo "POT File Updater for LuCI App Podman"
echo "====================================="
echo ""

# Extract strings from JavaScript code
# Handles both single-line and multi-line _() calls
echo "Extracting strings from code..."

find "$HTDOCS_DIR" -name "*.js" -exec cat {} \; | \
    perl -0777 -ne "while (/\_\(\s*('([^']+)'|\"([^\"]+)\")\s*\)/gs) { print \"\$1\n\"; }" | \
    sort -u > "$CODE_STRINGS"

STRING_COUNT=$(wc -l < "$CODE_STRINGS" | tr -d ' ')
echo "Found $STRING_COUNT unique strings"

# Generate POT file
echo "Generating POT file..."

# Write header
cat > "$POT_FILE" << 'EOF'
msgid ""
msgstr "Content-Type: text/plain; charset=UTF-8"

EOF

# Write entries
while IFS= read -r line; do
    echo "msgid \"$line\""
    echo "msgstr \"\""
    echo ""
done < "$CODE_STRINGS" >> "$POT_FILE"

echo ""
echo -e "${GREEN}POT file updated successfully!${NC}"
echo "Location: $POT_FILE"
echo "Entries: $STRING_COUNT"
echo ""
echo "Note: Remember to update translation files (po/*/podman.po) with new strings."
