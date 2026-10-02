#!/usr/bin/env bash
# Sets up ApplyPilot: backend venv + deps, then frontend deps + build.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Backend =="
PYTHON=python3.11
command -v "$PYTHON" >/dev/null 2>&1 || PYTHON=python3.12
command -v "$PYTHON" >/dev/null 2>&1 || PYTHON=python3.13

rm -rf .venv
"$PYTHON" -m venv .venv
source .venv/bin/activate

pip install -e .
pip install --no-deps python-jobspy
pip install pydantic tls-client requests markdownify regex

echo "== Frontend =="
cd webapp
pnpm install
pnpm run build
cd ..

echo "Done. Run: source .venv/bin/activate && applypilot serve"
