#!/usr/bin/env bash
set -euo pipefail

# Read hook event JSON from stdin
INPUT="$(cat)"

# Extract the edited file path (using node since jq may not be installed)
FILE_PATH="$(echo "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_input.file_path||'')}catch{console.log('')}})")"
[ -z "$FILE_PATH" ] && exit 0

# Must be inside a git repo
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Skip secrets and sensitive files
case "$FILE_PATH" in
  *.env|*local.settings.json|*.pem|*.key) exit 0 ;;
esac

# Skip gitignored files
git check-ignore -q "$FILE_PATH" 2>/dev/null && exit 0

# Stage only the changed file
git add "$FILE_PATH"

# If nothing staged, do nothing
git diff --cached --quiet && exit 0

# Commit
BASE="$(basename "$FILE_PATH")"
git commit -m "chore: update ${BASE}"

# Push (non-blocking, ignore failures)
git push origin HEAD 2>/dev/null || true
