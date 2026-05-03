#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/lib/backup-common.sh
source "$SCRIPT_DIR/lib/backup-common.sh"

usage() {
  cat <<'EOF'
Usage:
  scripts/backup-verify.sh [options] <backup.sql|backup.sql.gz>

Restores a backup into a temporary database in the docker compose postgres
service, checks core tables and row-count queries, then drops the temp DB.

Options:
  --user NAME      PostgreSQL user. Default: POSTGRES_USER or opencairn
  --keep-db        Keep the temporary verification database for inspection.
  --dry-run        Print commands without changing the database.
  -h, --help       Show this help.
EOF
}

user="$(postgres_user)"
keep_db=0
dry_run=0
backup_file=""
verify_db="opencairn_verify_$(date +%Y%m%d_%H%M%S)_$$"
CORE_TABLES=(user session workspaces projects notes yjs_documents agent_runs)

core_table_values_sql() {
  local table
  local first=1

  for table in "${CORE_TABLES[@]}"; do
    if [[ "$first" == "1" ]]; then
      printf "    ('%s')" "$table"
      first=0
    else
      printf ",\n    ('%s')" "$table"
    fi
  done
}

core_table_row_count_sql() {
  local table
  local first=1

  for table in "${CORE_TABLES[@]}"; do
    if [[ "$first" == "1" ]]; then
      printf "SELECT '%s' AS table_name, count(*) FROM \"%s\"\n" "$table" "$table"
      first=0
    else
      printf "UNION ALL SELECT '%s', count(*) FROM \"%s\"\n" "$table" "$table"
    fi
  done
  printf "ORDER BY table_name;\n"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)
      user="${2:?missing value for --user}"
      shift 2
      ;;
    --keep-db)
      keep_db=1
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "ERROR: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$backup_file" ]]; then
        echo "ERROR: only one backup file is supported." >&2
        exit 2
      fi
      backup_file="$(repo_rel "$1")"
      shift
      ;;
  esac
done

if [[ -z "$backup_file" ]]; then
  echo "ERROR: backup file is required." >&2
  usage >&2
  exit 2
fi

if [[ ! -f "$backup_file" && "$dry_run" != "1" ]]; then
  echo "ERROR: backup file not found: $backup_file" >&2
  exit 1
fi

validate_pg_identifier user "$user"
validate_pg_identifier database "$verify_db"

cleanup() {
  if [[ "$keep_db" == "0" && "$dry_run" != "1" ]]; then
    compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$user" -d postgres \
      -c "DROP DATABASE IF EXISTS \"$verify_db\" WITH (FORCE);" >/dev/null || true
  fi
}
trap cleanup EXIT

if [[ "$dry_run" != "1" ]]; then
  ensure_postgres_running
fi

echo "[verify] temp database=$verify_db user=$user file=$backup_file"

if [[ "$dry_run" == "1" ]]; then
  echo "docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U \"$user\" -d postgres -c \"CREATE DATABASE \\\"$verify_db\\\" OWNER \\\"$user\\\";\""
  if [[ "$backup_file" == *.gz ]]; then
    echo "gzip -dc \"$backup_file\" | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U \"$user\" -d \"$verify_db\""
  else
    echo "cat \"$backup_file\" | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U \"$user\" -d \"$verify_db\""
  fi
  echo "docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U \"$user\" -d \"$verify_db\" -c \"verification queries\""
  [[ "$keep_db" == "1" ]] || echo "docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U \"$user\" -d postgres -c \"DROP DATABASE IF EXISTS \\\"$verify_db\\\" WITH (FORCE);\""
  echo "[verify] dry-run complete"
  exit 0
fi

if [[ "$backup_file" == *.gz ]]; then
  gzip -t "$backup_file"
fi

compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$user" -d postgres \
  -c "DROP DATABASE IF EXISTS \"$verify_db\" WITH (FORCE);"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$user" -d postgres \
  -c "CREATE DATABASE \"$verify_db\" OWNER \"$user\";"

if [[ "$backup_file" == *.gz ]]; then
  gzip -dc "$backup_file" | compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$user" -d "$verify_db"
else
  cat "$backup_file" | compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$user" -d "$verify_db"
fi

compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$user" -d "$verify_db" <<SQL
\echo [verify] counting public tables
SELECT count(*) AS public_table_count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE';

\echo [verify] checking core OpenCairn tables
SELECT required.table_name
FROM (
  VALUES
$(core_table_values_sql)
) AS required(table_name)
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public'
 AND t.table_name = required.table_name
WHERE t.table_name IS NULL;
SQL

missing_tables="$(
  compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$user" -d "$verify_db" -At <<SQL
SELECT count(*)
FROM (
  VALUES
$(core_table_values_sql)
) AS required(table_name)
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public'
 AND t.table_name = required.table_name
WHERE t.table_name IS NULL;
SQL
)"

if [[ "$missing_tables" != "0" ]]; then
  echo "ERROR: backup restored, but $missing_tables core table(s) are missing." >&2
  exit 1
fi

echo "[verify] row counts for core tables"
core_table_row_count_sql | compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$user" -d "$verify_db"

if [[ "$keep_db" == "1" ]]; then
  trap - EXIT
  echo "[verify] done; kept temp database: $verify_db"
else
  echo "[verify] done; temp database will be dropped"
fi
