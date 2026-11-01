#!/bin/sh
# Restores an Axis PostgreSQL dump produced by backup-postgres.sh.
# Usage: restore-postgres.sh /backups/axis_20261101T030000Z.sql.gz
set -eu

: "${PGHOST:=postgres}"
: "${PGPORT:=5432}"
: "${PGUSER:=logistica}"
: "${PGDATABASE:=axis_logistica}"
: "${PGPASSWORD:?PGPASSWORD must be set}"

export PGPASSWORD

file="${1:?Usage: restore-postgres.sh <path-to-dump.sql.gz>}"
[ -f "$file" ] || { echo "File not found: $file" >&2; exit 1; }

echo "Restoring $file into ${PGDATABASE} at ${PGHOST}:${PGPORT} — this overwrites existing data."
# The dump (from backup-postgres.sh) is a --clean --if-exists dump, so it DROPs each table before
# recreating it — without that, restoring into a database that already has rows just re-INSERTs
# on top of them (or errors on existing rows) instead of reverting to the dump's state. We also
# stop on the first error (ON_ERROR_STOP) so a failed statement isn't silently skipped, and route
# the dump through the SQL file first so pg_restore errors aren't masked by gunzip's own success.
sql_tmp="${file}.restore.tmp"
gunzip -c "$file" > "$sql_tmp"
psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" \
  --set ON_ERROR_STOP=1 -f "$sql_tmp"
rm -f "$sql_tmp"
echo "Restore complete."
