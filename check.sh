#!/usr/bin/env bash
# Usage: ./check.sh resume.pdf [role] [model]
set -euo pipefail
cd "$(dirname "$0")"
[ -d .venv ] || { uv venv -q -p 3.11 .venv && uv pip install -q -p .venv -r requirements.txt; }
[ -n "${3:-}" ] && export DEFAULT_MODEL="$3"
pdf="$(cd "$OLDPWD" && realpath "$1")"
# score.py caches by filename; a stale cache would hide resume edits
rm -f cache/{resume,github}cache_"$(basename "$pdf" .pdf)".json
exec .venv/bin/python score.py "$pdf" --role "${2:-software_engineering_intern}"
