#!/usr/bin/env bash
# 공유 SQLite DB 를 온라인 백업한다. gwamegi-backup.timer 가 매일 부른다.
# 복구 절차는 infra/gcp/README.md "상태 확인" 아래 (-wal·-shm 을 먼저 지워야 한다).
set -euo pipefail

DB=${DATABASE_PATH:-/srv/gwamegi/data/gwamegi.db}
DEST=${BACKUP_DIR:-/srv/gwamegi/backups}
KEEP=14

[[ -f "$DB" ]] || { echo "DB 없음: $DB"; exit 0; }
out="$DEST/gwamegi-$(date +%Y%m%d-%H%M%S).db"
# .backup 은 쓰는 중인 DB 도 일관된 시점으로 복사한다 (cp 는 WAL 때문에 깨질 수 있다).
sqlite3 "$DB" ".backup '$out'"
gzip "$out"
ls -1t "$DEST"/gwamegi-*.db.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "백업: $out.gz"
