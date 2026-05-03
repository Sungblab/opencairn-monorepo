#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/lib/backup-common.sh
source "$SCRIPT_DIR/lib/backup-common.sh"

usage() {
  cat <<'EOF'
Usage:
  scripts/restore.sh [options] <backup.sql|backup.sql.gz>

Restores a pg_dump backup into the docker compose postgres service.
This drops and recreates the target database. Pass --yes to execute.

Options:
  --database NAME  Target database. Default: POSTGRES_DB or opencairn
  --user NAME      PostgreSQL user. Default: POSTGRES_USER or opencairn
  --yes            Required for destructive restore.
  --no-stop        Do not stop api/worker/hocuspocus before restore.
  --dry-run        Print commands without changing the database.
  -h, --help       Show this help.
EOF
}

db="$(postgres_db)"
user="$(postgres_user)"
confirm=0
dry_run=0
stop_services=1
backup_file=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --database)
      db="${2:?missing value for --database}"
      shift 2
      ;;
    --user)
      user="${2:?missing value for --user}"
      shift 2
      ;;
    --yes)
      confirm=1
      shift
      ;;
    --no-stop)
      stop_services=0
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

if [[ "$confirm" != "1" && "$dry_run" != "1" ]]; then
  echo "ERROR: restore drops and recreates database '$db'. Re-run with --yes to execute." >&2
  exit 2
fi

validate_pg_identifier database "$db"
validate_pg_identifier user "$user"
if [[ "$dry_run" != "1" ]]; then
  ensure_postgres_running
fi

echo "[restore] target database=$db user=$user file=$backup_file"

if [[ "$stop_services" == "1" ]]; then
  echo "[restore] stopping app services before restore"
  if [[ "$dry_run" == "1" ]]; then
    echo "docker compose stop api worker hocuspocus"
  else
    compose stop api worker hocuspocus >/dev/null || true
  fi
fi

if [[ "$dry_run" == "1" ]]; then
  echo "docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U \"$user\" -d postgres -c \"DROP DATABASE IF EXISTS \\\"$db\\\" WITH (FORCE);\""
  echo "docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U \"$user\" -d postgres -c \"CREATE DATABASE \\\"$db\\\" OWNER \\\"$user\\\";\""
  if [[ "$backup_file" == *.gz ]]; then
    echo "gzip -dc \"$backup_file\" | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U \"$user\" -d \"$db\""
  else
    echo "cat \"$backup_file\" | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U \"$user\" -d \"$db\""
  fi
  echo "[restore] dry-run complete"
  exit 0
fi

if [[ "$backup_file" == *.gz ]]; then
  gzip -t "$backup_file"
fi

compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$user" -d postgres \
  -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$user" -d postgres \
  -c "CREATE DATABASE \"$db\" OWNER \"$user\";"

if [[ "$backup_file" == *.gz ]]; then
  gzip -dc "$backup_file" | compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$user" -d "$db"
else
  cat "$backup_file" | compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$user" -d "$db"
fi

echo "[restore] done: $db"
