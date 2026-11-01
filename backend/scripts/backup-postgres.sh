#!/bin/sh
# Dumps the Axis PostgreSQL database and prunes backups older than RETENTION_DAYS.
# Runs inside the `backup` service (see docker-compose.yml) or any host with pg_dump/psql.
set -eu

: "${PGHOST:=postgres}"
: "${PGPORT:=5432}"
: "${PGUSER:=axis}"
: "${PGDATABASE:=axis}"
: "${PGPASSWORD:?PGPASSWORD must be set}"
: "${BACKUP_DIR:=/backups}"
: "${RETENTION_DAYS:=30}"

export PGPASSWORD

mkdir -p "$BACKUP_DIR"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
dest="$BACKUP_DIR/axis_${timestamp}.sql.gz"
sql_tmp="${dest}.sql.tmp"

# pg_dump writes straight to a file (not through a pipe) so its exit code is checked directly by
# `set -e` — piping into gzip masked a failed pg_dump behind gzip's own (successful) exit status,
# silently producing an empty/truncated backup.
pg_dump --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" \
  --format=plain --clean --if-exists -f "$sql_tmp"
gzip -f "$sql_tmp"
mv "${sql_tmp}.gz" "$dest"
echo "Backup written to $dest"

find "$BACKUP_DIR" -name 'axis_*.sql.gz' -mtime "+${RETENTION_DAYS}" -print -delete
