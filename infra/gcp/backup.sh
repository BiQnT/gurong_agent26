#!/usr/bin/env bash
# 공유 SQLite DB 를 온라인 백업한다. haepung-backup.timer 가 매일 부르고, haepung-deploy 가 배포 직전에 부른다.
#
#   haepung-backup [daily|predeploy]     (기본 daily)
#
# 종류별로 14개씩 남긴다 (배포가 잦아도 매일 백업이 밀려나지 않는다).
# 복구 절차는 infra/gcp/README.md "백업과 복구" (-wal·-shm 을 먼저 지워야 한다).
set -euo pipefail

DB=${DATABASE_PATH:-/srv/haepung/db/haepung.db}
DEST=${BACKUP_DIR:-/srv/haepung/backups}
KIND=${1:-daily}
KEEP=14

[[ "$KIND" == daily || "$KIND" == predeploy ]] || { echo "종류는 daily 또는 predeploy: $KIND"; exit 1; }
[[ -f "$DB" ]] || { echo "DB 없음: $DB"; exit 0; }
out="$DEST/haepung-$KIND-$(date +%Y%m%d-%H%M%S).db"
# .backup 은 쓰는 중인 DB 도 일관된 시점으로 복사한다 (cp 는 WAL 때문에 깨질 수 있다).
sqlite3 "$DB" ".backup '$out'"
# 복사본이 열리는지 확인한다. 깨진 백업은 없는 것보다 나쁘다.
check=$(sqlite3 "$out" 'PRAGMA integrity_check;')
[[ "$check" == ok ]] || { echo "백업 검사 실패: $check"; rm -f "$out"; exit 1; }
gzip "$out"
ls -1t "$DEST"/haepung-"$KIND"-*.db.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "백업: $out.gz"
