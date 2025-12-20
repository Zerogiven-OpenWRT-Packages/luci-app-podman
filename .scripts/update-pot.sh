#!/bin/bash
#
# POT File Updater for LuCI App Podman
# Regenerates the POT file from JavaScript source code
# Supports both singular _('...') and plural N_(n, '...', '...') forms
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
POT_FILE="$PROJECT_ROOT/po/templates/podman.pot"
HTDOCS_DIR="$PROJECT_ROOT/htdocs"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Temp files
PLURAL_PAIRS=$(mktemp)
PLURAL_SKIP=$(mktemp)
CODE_STRINGS=$(mktemp)
FILTERED_STRINGS=$(mktemp)

# Cleanup on exit
trap "rm -f $PLURAL_PAIRS $PLURAL_SKIP $CODE_STRINGS $FILTERED_STRINGS" EXIT

echo "POT File Updater for LuCI App Podman"
echo "====================================="
echo ""

# Step 1: Extract plural forms N_(count, 'singular', 'plural')
echo "Extracting plural forms..."

find "$HTDOCS_DIR" -name "*.js" -exec cat {} \; | \
    perl -0777 -ne "while (/N_\s*\([^,]+,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/gs) { print \"\$1|\$2\n\"; }" | \
    sort -u > "$PLURAL_PAIRS"

PLURAL_COUNT=$(wc -l < "$PLURAL_PAIRS" | tr -d ' ')
# Handle empty file (wc returns 1 for empty file with no newline)
if [ ! -s "$PLURAL_PAIRS" ]; then
    PLURAL_COUNT=0
fi
echo "Found $PLURAL_COUNT plural form(s)"

# Step 2: Build skip list (both singular and plural strings from N_() calls)
# These should not appear as standalone msgid entries
cat "$PLURAL_PAIRS" | while IFS='|' read -r singular plural; do
    echo "$singular"
    echo "$plural"
done | sort -u > "$PLURAL_SKIP"

# Step 3: Extract all singular strings _('...')
echo "Extracting singular strings..."

find "$HTDOCS_DIR" -name "*.js" -exec cat {} \; | \
    perl -0777 -ne "while (/(?<!N)_\(\s*'([^']+)'\s*\)/gs) { print \"\$1\n\"; }" | \
    sort -u > "$CODE_STRINGS"

TOTAL_SINGULAR=$(wc -l < "$CODE_STRINGS" | tr -d ' ')

# Step 4: Filter out strings that are covered by plural forms
if [ -s "$PLURAL_SKIP" ]; then
    grep -vxFf "$PLURAL_SKIP" "$CODE_STRINGS" > "$FILTERED_STRINGS" || true
else
    cp "$CODE_STRINGS" "$FILTERED_STRINGS"
fi

FILTERED_COUNT=$(wc -l < "$FILTERED_STRINGS" | tr -d ' ')
SKIPPED=$((TOTAL_SINGULAR - FILTERED_COUNT))

if [ $SKIPPED -gt 0 ]; then
    echo -e "${YELLOW}Skipped $SKIPPED string(s) covered by plural forms${NC}"
fi
echo "Found $FILTERED_COUNT unique singular string(s)"

# Step 5: Generate POT file
echo ""
echo "Generating POT file..."

# Write header
cat > "$POT_FILE" << 'EOF'
msgid ""
msgstr "Content-Type: text/plain; charset=UTF-8"

EOF

# Write plural entries
if [ -s "$PLURAL_PAIRS" ]; then
    while IFS='|' read -r singular plural; do
        echo "msgid \"$singular\""
        echo "msgid_plural \"$plural\""
        echo "msgstr[0] \"\""
        echo "msgstr[1] \"\""
        echo ""
    done < "$PLURAL_PAIRS" >> "$POT_FILE"
fi

# Write singular entries
while IFS= read -r line; do
    # Skip empty lines
    [ -z "$line" ] && continue
    echo "msgid \"$line\""
    echo "msgstr \"\""
    echo ""
done < "$FILTERED_STRINGS" >> "$POT_FILE"

TOTAL_ENTRIES=$((PLURAL_COUNT + FILTERED_COUNT))

echo ""
echo -e "${GREEN}POT file updated successfully!${NC}"
echo "Location: $POT_FILE"
echo "Entries: $TOTAL_ENTRIES ($PLURAL_COUNT plural, $FILTERED_COUNT singular)"
echo ""
echo "Note: Remember to update translation files (po/*/podman.po) with new strings."
