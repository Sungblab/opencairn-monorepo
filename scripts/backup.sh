#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/lib/backup-common.sh
source "$SCRIPT_DIR/lib/backup-common.sh"

usage() {
  cat <<'EOF'
Usage:
  scripts/backup.sh [options]

Creates a gzip-compressed pg_dump from the docker compose postgres service.

Options:
  --output-dir DIR    Backup directory. Default: BACKUP_DIR or ./backups
  --file FILE         Exact output file. Default: db_YYYYMMDD_HHMMSS.sql.gz
  --database NAME     Database name. Default: POSTGRES_DB or opencairn
  --user NAME         PostgreSQL user. Default: POSTGRES_USER or opencairn
  --retention-days N  Delete local db_*.sql.gz files older than N days.
                      Default: BACKUP_RETENTION_DAYS or 7
  --no-retention      Skip local retention cleanup.
  --to-r2             Upload to Cloudflare R2 with aws CLI.
  --to-s3             Upload to AWS/S3-compatible storage with aws CLI.
  --to-b2             Upload to Backblaze B2 S3-compatible storage with aws CLI.
  --dry-run           Print commands without creating a backup.
  -h, --help          Show this help.

Upload env:
  R2: R2_BACKUP_BUCKET, R2_BACKUP_ENDPOINT, R2_BACKUP_ACCESS_KEY,
      R2_BACKUP_SECRET_KEY
  S3: S3_BACKUP_BUCKET or BACKUP_S3_BUCKET, optional S3_BACKUP_ENDPOINT
  B2: B2_BACKUP_BUCKET, B2_BACKUP_ENDPOINT, B2_BACKUP_ACCESS_KEY,
      B2_BACKUP_SECRET_KEY
EOF
}

timestamp="$(date +%Y%m%d_%H%M%S)"
db="$(postgres_db)"
user="$(postgres_user)"
output_dir="$(dotenv_value BACKUP_DIR ./backups)"
retention_days="$(dotenv_value BACKUP_RETENTION_DAYS 7)"
output_file=""
dry_run=0
run_retention=1
upload_targets=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      output_dir="${2:?missing value for --output-dir}"
      shift 2
      ;;
    --file)
      output_file="${2:?missing value for --file}"
      shift 2
      ;;
    --database)
      db="${2:?missing value for --database}"
      shift 2
      ;;
    --user)
      user="${2:?missing value for --user}"
      shift 2
      ;;
    --retention-days)
      retention_days="${2:?missing value for --retention-days}"
      shift 2
      ;;
    --no-retention)
      run_retention=0
      shift
      ;;
    --to-r2|--to-s3|--to-b2)
      upload_targets+=("${1#--to-}")
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
    *)
      echo "ERROR: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! [[ "$retention_days" =~ ^[0-9]+$ ]]; then
  echo "ERROR: --retention-days must be a non-negative integer." >&2
  exit 2
fi

if [[ -z "$output_file" ]]; then
  output_file="$(repo_rel "$output_dir")/db_${timestamp}.sql.gz"
else
  output_file="$(repo_rel "$output_file")"
fi

upload_backup() {
  local target="$1"
  local file="$2"
  local bucket endpoint access_key secret_key prefix dest

  case "$target" in
    r2)
      bucket="$(dotenv_value R2_BACKUP_BUCKET "")"
      endpoint="$(dotenv_value R2_BACKUP_ENDPOINT "")"
      access_key="$(dotenv_value R2_BACKUP_ACCESS_KEY "")"
      secret_key="$(dotenv_value R2_BACKUP_SECRET_KEY "")"
      ;;
    s3)
      bucket="$(dotenv_value S3_BACKUP_BUCKET "$(dotenv_value BACKUP_S3_BUCKET "")")"
      endpoint="$(dotenv_value S3_BACKUP_ENDPOINT "")"
      access_key="${AWS_ACCESS_KEY_ID:-}"
      secret_key="${AWS_SECRET_ACCESS_KEY:-}"
      ;;
    b2)
      bucket="$(dotenv_value B2_BACKUP_BUCKET "")"
      endpoint="$(dotenv_value B2_BACKUP_ENDPOINT "")"
      access_key="$(dotenv_value B2_BACKUP_ACCESS_KEY "${B2_APPLICATION_KEY_ID:-}")"
      secret_key="$(dotenv_value B2_BACKUP_SECRET_KEY "${B2_APPLICATION_KEY:-}")"
      ;;
    *)
      echo "ERROR: unsupported upload target: $target" >&2
      exit 2
      ;;
  esac

  if [[ -z "$bucket" ]]; then
    echo "ERROR: $target upload requires a backup bucket env." >&2
    exit 2
  fi
  if [[ "$target" != "s3" && ( -z "$endpoint" || -z "$access_key" || -z "$secret_key" ) ]]; then
    echo "ERROR: $target upload requires endpoint and access key env." >&2
    exit 2
  fi
  if ! command -v aws >/dev/null 2>&1; then
    echo "ERROR: aws CLI가 필요합니다: --to-$target" >&2
    exit 1
  fi

  prefix="$(date +%Y/%m)"
  dest="s3://${bucket}/${prefix}/$(basename "$file")"

  echo "[backup] uploading to $target: $dest"
  if [[ "$dry_run" == "1" ]]; then
    if [[ -n "$endpoint" ]]; then
      echo "AWS_ACCESS_KEY_ID=*** AWS_SECRET_ACCESS_KEY=*** aws s3 cp \"$file\" \"$dest\" --endpoint-url \"$endpoint\""
    else
      echo "aws s3 cp \"$file\" \"$dest\""
    fi
    return 0
  fi

  if [[ -n "$endpoint" ]]; then
    AWS_ACCESS_KEY_ID="$access_key" AWS_SECRET_ACCESS_KEY="$secret_key" \
      aws s3 cp "$file" "$dest" --endpoint-url "$endpoint"
  else
    aws s3 cp "$file" "$dest"
  fi
}

if [[ "$dry_run" != "1" ]]; then
  ensure_postgres_running
fi

echo "[backup] database=$db user=$user output=$output_file"
if [[ "$dry_run" == "1" ]]; then
  echo "mkdir -p \"$(dirname "$output_file")\""
  echo "docker compose exec -T postgres pg_dump --clean --if-exists --no-owner --no-privileges -U \"$user\" \"$db\" | gzip -9 > \"$output_file\""
else
  mkdir -p "$(dirname "$output_file")"
  (
    cd "$REPO_ROOT"
    docker compose exec -T postgres \
      pg_dump --clean --if-exists --no-owner --no-privileges -U "$user" "$db" \
      | gzip -9 > "$output_file"
  )
  gzip -t "$output_file"
fi

if [[ "$run_retention" == "1" ]]; then
  echo "[backup] applying local retention: ${retention_days} days"
  if [[ "$dry_run" == "1" ]]; then
    echo "find \"$(dirname "$output_file")\" -maxdepth 1 -name 'db_*.sql.gz' -type f -mtime +$retention_days -delete"
  else
    find "$(dirname "$output_file")" -maxdepth 1 -name 'db_*.sql.gz' -type f -mtime +"$retention_days" -delete
  fi
fi

for target in "${upload_targets[@]}"; do
  upload_backup "$target" "$output_file"
done

echo "[backup] done: $output_file"
