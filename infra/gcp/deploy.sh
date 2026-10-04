#!/usr/bin/env bash
# prod 배포. dev 저장소로 fetch 한 커밋을 새 release 폴더로 풀어 빌드하고, current 링크를 바꿔 재시작한다.
# 헬스체크가 실패하면 직전 release 로 되돌린다.
#
#   sudo /srv/gwamegi/dev/infra/gcp/deploy.sh [ref]     (기본 origin/main)
#   sudo /srv/gwamegi/dev/infra/gcp/deploy.sh --rollback
set -euo pipefail

ROOT=/srv/gwamegi
APP_USER=gwamegi
PORT=3000
KEEP=2   # 디스크가 10GB 라 current + 직전 하나만 남긴다

as_app() { sudo -u "$APP_USER" -H bash -c 'umask 002; exec "$@"' _ "$@"; }
[[ $EUID -eq 0 ]] || exec sudo "$0" "$@"

health() { # <기대 커밋>
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

current=$(readlink -f "$ROOT/prod/current" 2>/dev/null || true)

if [[ "${1:-}" == --rollback ]]; then
  previous=$(ls -1dt "$ROOT"/prod/releases/*/ | sed 's:/$::' | grep -vx "$current" | head -1)
  [[ -n "$previous" ]] || { echo '되돌릴 release 가 없다'; exit 1; }
  echo "rollback → $previous"
  switch_to "$previous"
  exit 0
fi

ref=${1:-origin/main}
as_app git -C "$ROOT/dev" fetch --prune origin
sha=$(as_app git -C "$ROOT/dev" rev-parse --verify "$ref^{commit}")
release="$ROOT/prod/releases/$(date +%Y%m%d-%H%M%S)-${sha:0:7}"
echo "deploy $ref ($sha) → $release"

as_app mkdir -p "$release"
# 실행에 필요한 것만 푼다: 앱(prototype)과 E-UM 카탈로그(data)
as_app bash -c "git -C '$ROOT/dev' archive '$sha' prototype data | tar -x -C '$release'"
as_app bash -c "echo 'GIT_COMMIT=$sha' > '$release/release.env'"
as_app bash -c "cd '$release/prototype' && npm ci --no-audit --no-fund && npm run build && npm prune --omit=dev --no-audit --no-fund"

switch_to "$release"
if ! health "$sha"; then
  echo '헬스체크 실패. 로그:'
  journalctl -u gwamegi-prod -n 40 --no-pager || true
  if [[ -n "$current" ]]; then
    echo "직전 release 로 되돌린다: $current"
    switch_to "$current"
  fi
  exit 1
fi

# 오래된 release 정리
ls -1dt "$ROOT"/prod/releases/*/ | sed 's:/$::' | tail -n +$((KEEP + 1)) | while read -r old; do
  [[ "$old" == "$(readlink -f "$ROOT/prod/current")" ]] || { echo "정리: $old"; rm -rf "$old"; }
done
