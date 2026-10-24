#!/usr/bin/env bash
# Prueba de punta a punta sobre una base SQLite temporal: crea la base, la siembra, compila, levanta el servidor y corre el navegador.
# Uso: CHROME=/ruta/a/chrome bash scripts/e2e.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=$(mktemp -d)
export DATABASE_URL="file:$DIR/e2e.db"
export SESSION_SECRET="e2e-secret-e2e-secret"
PORT=${PORT:-3100}
npx prisma db push --skip-generate >/dev/null
npm run seed >/dev/null
npx next build >/dev/null
# Se ejecuta next directamente (sin npx) para que $SERVER sea el proceso real y el trap lo pueda bajar.
NODE_ENV=production node node_modules/next/dist/bin/next start -p "$PORT" >"$DIR/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$PORT/login" && break; sleep 1; done
BASE_URL="http://localhost:$PORT" CHROME="${CHROME:-}" SHOTS="${SHOTS:-/tmp/club95-shots}" node tests/e2e/run.mjs
