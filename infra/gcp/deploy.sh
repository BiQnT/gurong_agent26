#!/usr/bin/env bash
# prod 배포. dev 저장소로 fetch 한 커밋을 새 release 폴더로 풀어 빌드하고, current 링크를 바꿔 재시작한다.
# 재시작이나 헬스체크가 실패하면 직전의 정상 release 로 되돌린다.
#
#   sudo haepung-deploy --list              배포할 수 있는 버전 보기
#   sudo haepung-deploy [ref]               그 버전 배포 (브랜치·커밋·태그, 기본 origin/main)
#   sudo haepung-deploy --rollback          직전 정상 release 로
#   sudo haepung-deploy [ref] --upgrade-schema   DB 저장 형식을 올리는 배포 (아래 설명)
#   sudo haepung-deploy [ref] --force-low-mem    메모리 여유 검사를 건너뜀
#
# haepung-deploy 는 bootstrap.sh 가 이 파일을 root 소유로 복사해 둔 것이다. 서비스 계정이 고칠 수 있는
# dev 폴더의 스크립트를 root 로 돌리지 않기 위해서다. 이 파일을 고쳤으면 bootstrap.sh 를 다시 실행한다.
#
# --upgrade-schema: 새 코드가 DB 저장 형식(schema)을 올릴 때만 쓴다. 기본은 꺼져 있어서 prod 는 자기가 아는 것보다
# 새 형식의 DB 를 건드리지 않는다. 켜면 새 prod 를 시작하는 순간에만 ALLOW_SCHEMA_UPGRADE=1 을 systemd 에 걸었다가
# 곧 지운다 (그 사이에 다시 시작하는 dev 에도 걸리므로 배포 중에는 dev 를 건드리지 않는다).
# 형식이 올라간 뒤에는 옛 release 가 DB 를 못 읽을 수 있다. 롤백이 안 되면 README "백업과 복구" 로 배포 직전 백업을 되살린다.
set -euo pipefail
shopt -s nullglob

ROOT=/srv/haepung
APP_USER=haepung
PORT=3000
DB="$ROOT/db/haepung.db"
# 디스크(296GB)가 넉넉해서 롤백할 정상 release 를 current 포함 5개 남긴다.
KEEP=5
# 빌드(tsc, vite)는 메모리를 쓴다. 스왑이 없어 여유가 이보다 적으면 다른 서비스가 OOM 으로 죽는다.
MIN_AVAILABLE_KB=600000

as_app() { sudo -u "$APP_USER" -H bash -c 'umask 007; exec "$@"' _ "$@"; }
[[ $EUID -eq 0 ]] || exec sudo "$0" "$@"

mode=deploy
ref=origin/main
upgrade=false
force_low_mem=false
for arg in "$@"; do
  case "$arg" in
    --list) mode=list ;;
    --rollback) mode=rollback ;;
    --upgrade-schema) upgrade=true ;;
    --force-low-mem) force_low_mem=true ;;
    -*) echo "알 수 없는 옵션: $arg"; exit 1 ;;
    *) ref=$arg ;;
  esac
done

# 두 사람이 동시에 배포하지 않게 잠근다.
exec 9>/run/lock/haepung-deploy.lock
flock -n 9 || { echo '다른 배포가 진행 중이다'; exit 1; }

# 빌드와 헬스체크를 통과한 release 에만 .ok 가 있다. 폴더 이름이 시각으로 시작하므로 역순 정렬 = 최신순.
ok_releases() {
  local dir
  # if 로 쓴다. `[[ ]] && echo` 는 마지막 폴더에 .ok 가 없으면 실패를 돌려주고, pipefail 때문에
  # 성공한 배포가 정리 단계에서 exit 1 로 끝난다 (팀원이 만든 옛 release 처럼 .ok 가 없는 폴더가 있을 때).
  for dir in "$ROOT"/releases/*/; do
    if [[ -f "$dir.ok" ]]; then echo "${dir%/}"; fi
  done | sort -r
}

health() { # <기대 커밋>
  local body
  for _ in $(seq 1 30); do
    body=$(curl -sf --max-time 3 "http://127.0.0.1:$PORT/api/health" || true)
    if grep -Eq "\"commit\" *: *\"$1\"" <<<"$body"; then echo "health: $body"; return 0; fi
    sleep 2
  done
  return 1
}

link_current() { # <release 경로>
  ln -sfn "$1" "$ROOT/current.tmp"
  mv -T "$ROOT/current.tmp" "$ROOT/current"
  chown -h "$APP_USER:$APP_USER" "$ROOT/current"
}

switch_to() { # <release 경로>
  link_current "$1"
  systemctl restart haepung-prod
}

# -e: 링크가 없거나 깨졌으면 빈 값 (첫 배포)
current=$(readlink -e "$ROOT/current" || true)

if [[ $mode == list ]]; then
  as_app git -C "$ROOT/dev" fetch --prune --tags -q origin
  echo '== origin/main 최근 10개'
  as_app git -C "$ROOT/dev" log origin/main -10 --format='%h  %ad  %s' --date=format:'%m-%d %H:%M'
  echo '== 태그 (최근 10개)'
  as_app git -C "$ROOT/dev" tag --sort=-creatordate | head -10
  echo '== 서버에 있는 정상 배포본 (* 지금 서비스 중)'
  for dir in $(ok_releases); do
    [[ "$dir" == "$current" ]] && echo "* ${dir##*/}" || echo "  ${dir##*/}"
  done
  exit 0
fi

if [[ $mode == rollback ]]; then
  previous=$(ok_releases | grep -vxF "$current" | head -1 || true)
  [[ -n "$previous" ]] || { echo '되돌릴 정상 release 가 없다'; exit 1; }
  # '현재가 아닌 가장 최근 정상 release' 로 간다. 두 번 하면 다시 돌아온다.
  echo "rollback → $previous"
  echo '(DB 저장 형식을 올린 배포였다면 옛 release 가 못 읽을 수 있다. 그때는 README "백업과 복구")'
  switch_to "$previous"
  health "$(sed -n 's/^GIT_COMMIT=//p' "$previous/release.env")" || { echo '헬스체크 실패. journalctl -u haepung-prod 를 본다'; exit 1; }
  exit 0
fi

# 빌드는 메모리를 많이 쓴다. 모자라면 시작하기 전에 멈춘다.
available_kb=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
if (( available_kb < MIN_AVAILABLE_KB )) && [[ $force_low_mem != true ]]; then
  echo "메모리 여유가 ${available_kb}kB 뿐이다 (필요 ${MIN_AVAILABLE_KB}kB). 빌드 중 OOM 으로 서비스가 죽을 수 있다."
  echo '  sudo systemctl stop haepung-dev 로 dev 를 잠시 끄고 다시 하거나, 감수하고 --force-low-mem 을 붙인다.'
  exit 1
fi

as_app git -C "$ROOT/dev" fetch --prune --tags origin
sha=$(as_app git -C "$ROOT/dev" rev-parse --verify "$ref^{commit}")
release="$ROOT/releases/$(date +%Y%m%d-%H%M%S)-${sha:0:7}"
echo "deploy $ref ($sha) → $release"

# 빌드가 끝나기 전에 스크립트가 어떤 이유로든 끝나면 반쯤 만든 release 를 지운다.
# (ERR trap 은 함수 안의 실패에서 돌지 않아 EXIT + 완료 표시로 한다)
# 스키마 허용 변수는 어떤 경우에도 systemd 에 남기지 않는다.
built=false
cleanup() {
  systemctl unset-environment ALLOW_SCHEMA_UPGRADE 2>/dev/null || true
  [[ $built == true ]] || { echo "실패: $release 삭제"; rm -rf "$release"; }
}
trap cleanup EXIT
as_app mkdir -p "$release"
# 우리가 만든 폴더만 정리 대상으로 삼으려고 표시를 둔다 (팀원이 예전에 만든 release 는 건드리지 않는다).
as_app touch "$release/.building"
# 저장소 전체를 푼다. 서버가 실행 중에 src/lib 와 research/api-tests/raw 를 읽는다.
as_app bash -c "git -C '$ROOT/dev' archive '$sha' | tar -x -C '$release'"
as_app bash -c "echo 'GIT_COMMIT=$sha' > '$release/release.env'"
# 힙 상한을 두면 모자랄 때 커널이 아무 프로세스나 죽이는 대신 빌드만 실패한다.
# npm prune --omit=dev 는 하지 않는다. 서버는 better-sqlite3 만 쓰지만, 이 release 안에서 admin·collect 스크립트를
# 돌릴 때 개발 의존성이 필요할 수 있고, 디스크가 넉넉해서 아껴 얻는 것이 없다.
as_app env NODE_OPTIONS=--max-old-space-size=768 bash -c "cd '$release' && npm ci --no-audit --no-fund && npm run build"
# 바꾸기 직전 DB 백업. 실패하면 배포를 멈춘다 (되돌릴 길이 없는 배포는 하지 않는다).
if [[ -f "$DB" ]]; then
  as_app env DATABASE_PATH="$DB" BACKUP_DIR="$ROOT/backups" /usr/local/bin/haepung-backup predeploy
fi
built=true

# 켠 경우에만, 새 prod 를 시작하는 동안만 걸고 바로 지운다.
[[ $upgrade != true ]] || systemctl set-environment ALLOW_SCHEMA_UPGRADE=1
# restart 자체가 실패해도(예: 마이그레이션 오류) 되돌린다.
started=false
if switch_to "$release" && health "$sha"; then started=true; fi
systemctl unset-environment ALLOW_SCHEMA_UPGRADE || true

if [[ $started != true ]]; then
  echo '기동 실패. 로그:'
  journalctl -u haepung-prod -n 40 --no-pager || true
  if [[ -n "$current" && -f "$current/.ok" ]]; then
    echo "직전 release 로 되돌린다: $current"
    previous=$(sed -n 's/^GIT_COMMIT=//p' "$current/release.env" 2>/dev/null || true)
    if ! switch_to "$current"; then
      echo '경고: 직전 release 로 되돌린 prod 가 시작하지 못했다. journalctl -u haepung-prod 를 확인한다' >&2
    elif [[ -z "$previous" ]]; then
      echo "경고: $current/release.env 에 커밋이 없어 되돌린 prod 를 헬스체크하지 못했다" >&2
    elif health "$previous"; then
      echo "되돌린 prod 가 정상이다 ($previous)"
    else
      echo '경고: 되돌린 prod 도 헬스체크를 통과하지 못했다. journalctl -u haepung-prod 를 확인한다' >&2
    fi
  else
    # 첫 배포 전 release(팀원의 vite preview 등)는 이 서버로 뜨지 않는다. 링크만 원래대로 두고 prod 를 멈춘다.
    echo '되돌릴 정상 release 가 없어 prod 를 멈춘다'
    if [[ -n "$current" ]]; then link_current "$current"; else rm -f "$ROOT/current"; fi
    systemctl stop haepung-prod || true
  fi
  rm -rf "$release"
  exit 1
fi
as_app rm -f "$release/.building"
as_app touch "$release/.ok"

# 정리: 우리가 만들다 만 폴더(.building)와, 정상 release 중 최신 KEEP 개 밖의 것
live=$(readlink -e "$ROOT/current")
for dir in "$ROOT"/releases/*/; do
  dir=${dir%/}
  if [[ -f "$dir/.building" && "$dir" != "$live" ]]; then echo "정리(미완성): $dir"; rm -rf "$dir"; fi
done
ok_releases | tail -n +$((KEEP + 1)) | while read -r old; do
  [[ "$old" == "$live" ]] || { echo "정리: $old"; rm -rf "$old"; }
done
echo "배포 완료: ${sha:0:7}"
