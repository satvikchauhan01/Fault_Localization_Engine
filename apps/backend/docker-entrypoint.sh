#!/bin/sh
# docker-entrypoint.sh — Backend container startup sequence
#
# 1. Wait for PostgreSQL to accept connections (up to 30s)
# 2. Run Prisma migrations (idempotent — skips if already applied)
# 3. Run seed script (idempotent — skips if DB already populated)
# 4. Start the application server
set -e

RETRIES=30
echo "[entrypoint] Waiting for PostgreSQL..."
until node -e "
  const {Client} = await import('pg').then(m=>m);
  const c = new Client({connectionString: process.env.DATABASE_URL});
  await c.connect(); await c.end();
" 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -eq 0 ]; then
    echo "[entrypoint] ❌ PostgreSQL did not become ready in time."
    exit 1
  fi
  echo "[entrypoint] Waiting... ($RETRIES retries left)"
  sleep 1
done
echo "[entrypoint] ✅ PostgreSQL is ready."

echo "[entrypoint] Running Prisma migrations..."
cd /app/apps/backend
npx prisma migrate deploy
echo "[entrypoint] ✅ Migrations applied."

echo "[entrypoint] Running seed script..."
node src/scripts/seed.js
echo "[entrypoint] ✅ Seed complete."

echo "[entrypoint] Building runtime topology..."
node src/scripts/build-topology.js
echo "[entrypoint] ✅ Topology ready."

if [ "$1" = "worker" ]; then
  echo "[entrypoint] Starting ingestion worker..."
  exec node src/worker/run.js
elif [ -n "$1" ]; then
  echo "[entrypoint] Executing custom command..."
  exec "$@"
else
  echo "[entrypoint] Starting backend server..."
  exec node src/index.js
fi
