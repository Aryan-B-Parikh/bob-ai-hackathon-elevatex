#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PGDATA="${ROOT_DIR}/pgdata"
BACKEND_DIR="${SCRIPT_DIR}/src/backend"
FRONTEND_DIR="${SCRIPT_DIR}/src/frontend"

export PATH="${ROOT_DIR}/bin:${HOME}/.local/bin:${PATH}"

echo "========================================="
echo "   Starting PortFlow SBX Services        "
echo "========================================="

# 1. Start PostgreSQL
if ! pg_isready -h "${PGDATA}" -p 5432 -U postgres >/dev/null 2>&1 && ! pg_isready -h localhost -p 5432 -U postgres >/dev/null 2>&1; then
    echo "[1/3] Starting PostgreSQL database server..."
    pg_ctl -D "${PGDATA}" -l "${PGDATA}/logfile" start
    sleep 2
fi
echo "[✓] PostgreSQL is active"

# 2. Start FastAPI Backend (in background)
if ! curl -s http://localhost:8000/health >/dev/null 2>&1; then
    echo "[2/3] Starting FastAPI backend on port 8000..."
    cd "${BACKEND_DIR}"
    setsid uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 </dev/null >"${ROOT_DIR}/backend.log" 2>&1 &
    sleep 3
fi
echo "[✓] Backend API is running: http://localhost:8000 (Swagger: http://localhost:8000/docs)"

# 3. Start Frontend (in background)
if ! curl -s http://localhost:5173 >/dev/null 2>&1; then
    echo "[3/3] Starting Vite frontend dashboard on port 5173..."
    cd "${FRONTEND_DIR}"
    setsid npm run dev -- --host 0.0.0.0 </dev/null >"${ROOT_DIR}/frontend.log" 2>&1 &
    sleep 3
fi
echo "[✓] Frontend Dashboard is running: http://localhost:5173"

echo "========================================="
echo "All services started successfully!"
echo "Open in browser: http://localhost:5173"
echo "========================================="
