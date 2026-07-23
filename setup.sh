#!/usr/bin/env bash
# One-shot setup: disposable MySQL, deps, generate, then run the repro once.
# Leaves the container running with the corrupt state so you can inspect it
# (see the last line of output).
set -euo pipefail
cd "$(dirname "$0")"

export DATABASE_URL="mysql://root:root@127.0.0.1:3399/repro"

echo "==> starting disposable MySQL on :3399"
if ! docker ps --format '{{.Names}}' | grep -qx prisma-repro; then
  docker rm -f prisma-repro >/dev/null 2>&1 || true
  docker run --name prisma-repro --rm -d -p 3399:3306 \
    -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=repro \
    mysql:8.0 --default-authentication-plugin=mysql_native_password >/dev/null
fi
printf "    waiting for MySQL"
until docker exec prisma-repro mysqladmin ping -uroot -proot --silent >/dev/null 2>&1; do
  printf "."; sleep 1
done
echo " ready"

echo "==> installing deps"
npm install --no-audit --no-fund --silent

echo "==> generating Prisma Client"
npx prisma generate >/dev/null

echo "==> running the repro"
echo
npx tsx repro.ts
echo
echo "==> MySQL is still running with the corrupt state. Inspect it with:"
echo "      DATABASE_URL=\"$DATABASE_URL\" npm run studio    # http://localhost:5555"
echo "    Tear everything down with:"
echo "      docker rm -f prisma-repro"
