#!/bin/sh
set -eu

mkdir -p /backups
while true; do
  stamp="$(date +%Y-%m-%d_%H-%M-%S)"
  target="/backups/china-cargo_${stamp}.dump"
  pg_dump --format=custom --no-owner --file="$target"
  find /backups -type f -name 'china-cargo_*.dump' -mtime "+${BACKUP_RETENTION_DAYS:-14}" -delete
  echo "Backup created: $target"
  sleep 86400
done
