#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
(cd frontend && npm install)
echo 'Opening backend on 127.0.0.1:8000 and frontend on 127.0.0.1:5173'
(cd backend && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000) &
API_PID=$!
cleanup() { kill "$API_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
(cd frontend && npm run dev)
