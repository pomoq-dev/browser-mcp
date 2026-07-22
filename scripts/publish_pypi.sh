#!/usr/bin/env bash
# Build + upload browser-mcp-nextgen to PyPI.
# Requires: PYPI_TOKEN (API token from https://pypi.org/manage/account/token/)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TOKEN="${PYPI_TOKEN:-${TWINE_PASSWORD:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "Set PYPI_TOKEN first:"
  echo "  export PYPI_TOKEN=pypi-…"
  exit 1
fi

# Prefer uv if available
if command -v uv >/dev/null 2>&1; then
  uv build
  UV_PUBLISH_TOKEN="$TOKEN" uv publish
else
  python3 -m pip install -U build twine
  rm -rf dist build *.egg-info
  python3 -m build
  TWINE_USERNAME=__token__ TWINE_PASSWORD="$TOKEN" python3 -m twine upload --skip-existing dist/*
fi

echo "Published. Test: pip install -U browser-mcp-nextgen && browser-mcp-nextgen --help"
