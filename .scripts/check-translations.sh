#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

PO_FILE="$1"
JS_DIR="$2"

if [[ -z "$PO_FILE" || -z "$JS_DIR" ]]; then
    echo -e "${BOLD}Usage:${NC} $0 <datei.po> <js_ordner>"
    exit 1
fi

TEMP_DEFINED=$(mktemp)
TEMP_USED=$(mktemp)

echo -e "${BLUE}Read PO-File: $PO_FILE${NC}"
grep '^\s*msgid "' "$PO_FILE" | sed 's/^\s*msgid "//;s/"$//' | grep -v '^$' | sort -u > "$TEMP_DEFINED"

COUNT_DEFINED=$(wc -l < "$TEMP_DEFINED" | xargs)
echo "  -> $COUNT_DEFINED IDs found."

echo -e "${BLUE}Search JS-Files recursive in: $JS_DIR${NC}"

grep -r -h -o -E "_\(['\"][^'\"]+['\"]\)" "$JS_DIR" --include="*.js" > "$TEMP_USED"

sed -i '' -E "s/^_\(['\"]//;s/['\"]\)$//" "$TEMP_USED"

sort -u "$TEMP_USED" -o "$TEMP_USED"

COUNT_USED=$(wc -l < "$TEMP_USED" | xargs)
echo "  -> $COUNT_USED used Strings found."

echo "---------------------------------------------------"

echo -e "${BOLD}Not used Message IDs (in PO, not in Code):${NC}"
comm -23 "$TEMP_DEFINED" "$TEMP_USED" > "unused_ids.txt"
if [[ -s "unused_ids.txt" ]]; then
    cat "unused_ids.txt"
else
    echo -e "${GREEN}None. all clean!${NC}"
fi

echo "---------------------------------------------------"

echo -e "${BOLD}Not defined Message IDs (in Code, missing in PO):${NC}"
comm -13 "$TEMP_DEFINED" "$TEMP_USED" > "missing_ids.txt"
if [[ -s "missing_ids.txt" ]]; then
    cat "missing_ids.txt"
else
    echo -e "${GREEN}None. All here!${NC}"
fi

# Aufräumen
rm "$TEMP_DEFINED" "$TEMP_USED" "unused_ids.txt" "missing_ids.txt" 2>/dev/null
