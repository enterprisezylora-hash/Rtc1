#!/usr/bin/env bash
# Prepare a local Supabase stack for development and the redis dual-instance test.
# Requirements: supabase CLI, docker.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

command -v supabase >/dev/null 2>&1 || { echo "ERROR: supabase CLI not found (npm i -g supabase)"; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: docker is not running"; exit 1; }

if [ ! -f supabase/config.toml ]; then
  supabase init --force
fi

supabase start

DB_CID="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)"
if [ -z "$DB_CID" ]; then
  echo "ERROR: supabase_db container not found"
  exit 1
fi

for f in supabase/sql/*.sql; do
  echo ">> applying $f"
  docker exec -i "$DB_CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
done

# Generate .env.server from the example if missing, pointed at local services.
if [ ! -f .env.server ]; then
  cp .env.server.example .env.server
  echo ">> created .env.server from .env.server.example (edit values as needed)"
fi

echo
echo ">> Supabase status (use SUPABASE_URL and Secret key in .env.server):"
supabase status
echo
echo ">> Done. Remember to set in .env.server:"
echo ">>   SUPABASE_URL=http://127.0.0.1:54321"
echo ">>   SUPABASE_SECRET_KEY=<secret key from status above>"
echo ">>   REDIS_URL=redis://127.0.0.1:6379"
