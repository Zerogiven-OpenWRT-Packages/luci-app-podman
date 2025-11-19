#!/bin/bash
#
# Translation Checker for LuCI App Podman
# Checks for missing and unused translation strings
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
POT_FILE="$PROJECT_ROOT/po/templates/podman.pot"
HTDOCS_DIR="$PROJECT_ROOT/htdocs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Temp files
CODE_STRINGS=$(mktemp)
POT_STRINGS=$(mktemp)

# Cleanup on exit
trap "rm -f $CODE_STRINGS $POT_STRINGS" EXIT

echo "Translation Checker for LuCI App Podman"
echo "========================================"
echo ""

# Extract strings from JavaScript code
# Handles both single-line and multi-line _() calls
echo "Extracting strings from code..."

# Use perl for multi-line matching
find "$HTDOCS_DIR" -name "*.js" -exec cat {} \; | \
    perl -0777 -ne "while (/\_\(\s*'([^']+)'\s*\)/gs) { print \"\$1\n\"; }" | \
    sort -u > "$CODE_STRINGS"

CODE_COUNT=$(wc -l < "$CODE_STRINGS" | tr -d ' ')
echo "Found $CODE_COUNT unique strings in code"

# Extract strings from POT file
echo "Extracting strings from POT file..."
grep "^msgid" "$POT_FILE" 2>/dev/null | \
    sed 's/^msgid "//' | sed 's/"$//' | \
    grep -v "^$" | sort -u > "$POT_STRINGS"

POT_COUNT=$(wc -l < "$POT_STRINGS" | tr -d ' ')
echo "Found $POT_COUNT strings in POT file"
echo ""

# Find missing translations (in code but not in POT)
MISSING=$(comm -23 "$CODE_STRINGS" "$POT_STRINGS")
MISSING_COUNT=$(echo "$MISSING" | grep -c . || true)

# Find unused translations (in POT but not in code)
UNUSED=$(comm -13 "$CODE_STRINGS" "$POT_STRINGS")
UNUSED_COUNT=$(echo "$UNUSED" | grep -c . || true)

# Report results
if [ "$MISSING_COUNT" -gt 0 ]; then
    echo -e "${RED}Missing translations ($MISSING_COUNT strings in code but not in POT):${NC}"
    echo "$MISSING" | while IFS= read -r line; do
        [ -n "$line" ] && echo "  - $line"
    done
    echo ""
fi

if [ "$UNUSED_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}Unused translations ($UNUSED_COUNT strings in POT but not in code):${NC}"
    echo "$UNUSED" | while IFS= read -r line; do
        [ -n "$line" ] && echo "  - $line"
    done
    echo ""
fi

# Summary
echo "========================================"
if [ "$MISSING_COUNT" -eq 0 ] && [ "$UNUSED_COUNT" -eq 0 ]; then
    echo -e "${GREEN}All translations are in sync!${NC}"
    exit 0
else
    if [ "$MISSING_COUNT" -gt 0 ]; then
        echo -e "${RED}$MISSING_COUNT missing translation(s)${NC}"
    fi
    if [ "$UNUSED_COUNT" -gt 0 ]; then
        echo -e "${YELLOW}$UNUSED_COUNT unused translation(s)${NC}"
    fi
    echo ""
    echo "To update the POT file, run:"
    echo "  $SCRIPT_DIR/update-pot.sh"
    exit 1
fi
