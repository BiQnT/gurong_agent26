#!/usr/bin/env bash
# prod 배포. dev 저장소로 fetch 한 커밋을 새 release 폴더로 풀어 빌드하고, current 링크를 바꿔 재시작한다.
# 재시작이나 헬스체크가 실패하면 직전의 정상 release 로 되돌린다.
#
#   sudo gwamegi-deploy [ref]        (기본 origin/main)
#   sudo gwamegi-deploy --rollback   (직전 정상 release 로)
#
# gwamegi-deploy 는 bootstrap.sh 가 이 파일을 root 소유로 복사해 둔 것이다. 서비스 계정이 고칠 수 있는
# dev 폴더의 스크립트를 root 로 돌리지 않기 위해서다. 이 파일을 고쳤으면 bootstrap.sh 를 다시 실행한다.
set -euo pipefail
shopt -s nullglob

ROOT=/srv/gwamegi
APP_USER=gwamegi
PORT=3000
KEEP=2   # 디스크가 10GB 라 정상 release 를 current 포함 2개만 남긴다

as_app() { sudo -u "$APP_USER" -H bash -c 'umask 007; exec "$@"' _ "$@"; }
[[ $EUID -eq 0 ]] || exec sudo "$0" "$@"

# 두 사람이 동시에 배포하지 않게 잠근다.
exec 9>/run/lock/gwamegi-deploy.lock
flock -n 9 || { echo '다른 배포가 진행 중이다'; exit 1; }

# 빌드와 헬스체크를 통과한 release 에만 .ok 가 있다. 폴더 이름이 시각으로 시작하므로 역순 정렬 = 최신순.
ok_releases() {
  local dir
  for dir in "$ROOT"/prod/releases/*/; do
    [[ -f "$dir.ok" ]] && echo "${dir%/}"
  done | sort -r
}

health() { # <기대 커밋>
  local body
  for _ in $(seq 1 30); do
    body=$(curl -sf "http://127.0.0.1:$PORT/api/health" || true)
    [[ "$body" == *"\"commit\":\"$1\""* ]] && { echo "health: $body"; return 0; }
    sleep 2
  done
  return 1
}

switch_to() { # <release 경로>
  ln -sfn "$1" "$ROOT/prod/current.tmp"
  mv -T "$ROOT/prod/current.tmp" "$ROOT/prod/current"
  chown -h "$APP_USER:$APP_USER" "$ROOT/prod/current"
  systemctl restart gwamegi-prod
}

# -e: 링크가 없거나 깨졌으면 빈 값 (첫 배포)
current=$(readlink -e "$ROOT/prod/current" || true)

if [[ "${1:-}" == --rollback ]]; then
  previous=$(ok_releases | grep -vxF "$current" | head -1 || true)
  [[ -n "$previous" ]] || { echo '되돌릴 정상 release 가 없다'; exit 1; }
  echo "rollback → $previous"
  switch_to "$previous"
  exit 0
fi

ref=${1:-origin/main}
as_app git -C "$ROOT/dev" fetch --prune origin
sha=$(as_app git -C "$ROOT/dev" rev-parse --verify "$ref^{commit}")
release="$ROOT/prod/releases/$(date +%Y%m%d-%H%M%S)-${sha:0:7}"
echo "deploy $ref ($sha) → $release"

# 빌드가 실패하면 반쯤 만든 release 를 지운다.
trap 'echo "실패: $release 삭제"; rm -rf "$release"' ERR
as_app mkdir -p "$release"
# 실행에 필요한 것만 푼다: 앱(prototype)과 E-UM 카탈로그(data)
as_app bash -c "git -C '$ROOT/dev' archive '$sha' prototype data | tar -x -C '$release'"
as_app bash -c "echo 'GIT_COMMIT=$sha' > '$release/release.env'"
as_app bash -c "cd '$release/prototype' && npm ci --no-audit --no-fund && npm run build && npm prune --omit=dev --no-audit --no-fund"
trap - ERR

# restart 자체가 실패해도(예: 마이그레이션 오류) 되돌린다.
if ! switch_to "$release" || ! health "$sha"; then
  echo '기동 실패. 로그:'
  journalctl -u gwamegi-prod -n 40 --no-pager || true
  if [[ -n "$current" ]]; then
    echo "직전 release 로 되돌린다: $current"
    switch_to "$current" || true
  fi
  rm -rf "$release"
  exit 1
fi
as_app touch "$release/.ok"

# 정리: .ok 가 없는 폴더(예전 실패의 잔재)와, 정상 release 중 최신 KEEP 개 밖의 것
live=$(readlink -e "$ROOT/prod/current")
for dir in "$ROOT"/prod/releases/*/; do
  dir=${dir%/}
  [[ -f "$dir/.ok" || "$dir" == "$live" ]] || { echo "정리(미완성): $dir"; rm -rf "$dir"; }
done
ok_releases | tail -n +$((KEEP + 1)) | while read -r old; do
  [[ "$old" == "$live" ]] || { echo "정리: $old"; rm -rf "$old"; }
done
