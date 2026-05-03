#!/usr/bin/env bash

set -euo pipefail

BACKUP_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$BACKUP_LIB_DIR/../.." && pwd)"

repo_rel() {
  local path="$1"
  if [[ "$path" = /* ]]; then
    printf "%s\n" "$path"
  else
    printf "%s/%s\n" "$REPO_ROOT" "$path"
  fi
}

dotenv_value() {
  local key="$1"
  local fallback="${2:-}"
  local value=""

  if [[ -n "${!key:-}" ]]; then
    printf "%s\n" "${!key}"
    return 0
  fi

  if [[ -f "$REPO_ROOT/.env" ]]; then
    value="$(
      awk -F= -v key="$key" '
        $0 ~ "^[[:space:]]*#" { next }
        $1 == key {
          sub(/^[^=]*=/, "", $0)
          gsub(/\r$/, "", $0)
          print $0
          exit
        }
      ' "$REPO_ROOT/.env"
    )"
  fi

  if [[ -n "$value" ]]; then
    printf "%s\n" "$value"
  else
    printf "%s\n" "$fallback"
  fi
}

compose() {
  (cd "$REPO_ROOT" && docker compose "$@")
}

require_docker_compose() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: docker CLI가 필요합니다." >&2
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: docker compose v2가 필요합니다." >&2
    exit 1
  fi
}

postgres_db() {
  dotenv_value POSTGRES_DB opencairn
}

postgres_user() {
  dotenv_value POSTGRES_USER opencairn
}

ensure_postgres_running() {
  require_docker_compose
  if ! compose ps --status running --services postgres 2>/dev/null | grep -qx postgres; then
    echo "ERROR: docker compose postgres 서비스가 실행 중이어야 합니다." >&2
    echo "       먼저 실행: docker compose up -d postgres" >&2
    exit 1
  fi
}

validate_pg_identifier() {
  local label="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "ERROR: $label must be a simple PostgreSQL identifier: $value" >&2
    exit 2
  fi
}
