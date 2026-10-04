#!/usr/bin/env bash
# VM 최초 셋업. 여러 번 실행해도 안전하다 (이미 된 단계는 건너뛴다).
#
#   sudo BRANCH=main bash bootstrap.sh <팀원 계정...>
#
# 처음 한 번은 저장소가 VM 에 없으므로 이 파일만 scp 로 올려서 실행한다 (infra/gcp/README.md).
# GitHub deploy key 가 등록되지 않았으면 공개키를 출력하고 멈춘다. 등록 후 다시 실행한다.
set -euo pipefail

ROOT=/srv/gwamegi
APP_USER=gwamegi
APP_HOME=/var/lib/gwamegi
REPO=git@github.com:BiQnT/gurong_agent26.git
BRANCH=${BRANCH:-main}
NODE_MAJOR=22
# GitHub 공식 ed25519 호스트키 지문 (docs.github.com "GitHub's SSH key fingerprints")
GITHUB_ED25519_FP='SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU'

step() { printf '\n== %s\n' "$*"; }
as_app() { sudo -u "$APP_USER" -H bash -c 'umask 002; exec "$@"' _ "$@"; }

[[ $EUID -eq 0 ]] || { echo 'sudo 로 실행해야 한다'; exit 1; }
MEMBERS=("$@")
[[ -n "${SUDO_USER:-}" && "$SUDO_USER" != root ]] && MEMBERS+=("$SUDO_USER")

step '패키지'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates build-essential python3 sqlite3 >/dev/null

step "Node.js $NODE_MAJOR"
if ! node --version 2>/dev/null | grep -q "^v$NODE_MAJOR\."; then
  curl -fsSL "https://deb.nodesource.com/setup_$NODE_MAJOR.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
# 22.18 부터 .ts 파일을 node 로 바로 실행할 수 있다 (MCP 서버·마이그레이션 스크립트가 쓴다).
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a===22 && b<18) { console.error("node >= 22.18 필요:", process.version); process.exit(1) }'
node --version

step '서비스 계정과 그룹'
getent group "$APP_USER" >/dev/null || groupadd "$APP_USER"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --gid "$APP_USER" --home-dir "$APP_HOME" --create-home --shell /usr/sbin/nologin "$APP_USER"
for member in "${MEMBERS[@]}"; do
  id "$member" >/dev/null 2>&1 && usermod -aG "$APP_USER" "$member" && echo "그룹 추가: $member"
done
# 팀원이 만든 파일도 그룹이 쓸 수 있게 한다 (dev 작업 폴더를 같이 쓴다).
cat > /etc/profile.d/gwamegi.sh <<'EOF'
if id -nG 2>/dev/null | grep -qw gwamegi; then umask 002; fi
EOF

step '폴더'
install -d -o "$APP_USER" -g "$APP_USER" -m 2775 "$ROOT" "$ROOT/prod" "$ROOT/prod/releases" "$ROOT/data" "$ROOT/data/agent-workdir" "$ROOT/backups"
install -d -o "$APP_USER" -g "$APP_USER" -m 2770 "$ROOT/env" "$ROOT/data/claude-home"
git config --system --get-all safe.directory | grep -qx "$ROOT/dev" || git config --system --add safe.directory "$ROOT/dev"

step 'GitHub 호스트키'
touch /etc/ssh/ssh_known_hosts
if ! ssh-keygen -F github.com -f /etc/ssh/ssh_known_hosts >/dev/null; then
  scanned=$(ssh-keyscan -t ed25519 github.com 2>/dev/null)
  fp=$(ssh-keygen -lf - <<<"$scanned" | awk '{print $2}')
  [[ "$fp" == "$GITHUB_ED25519_FP" ]] || { echo "github.com 호스트키 지문 불일치: $fp"; exit 1; }
  echo "$scanned" >> /etc/ssh/ssh_known_hosts
fi

step 'GitHub deploy key'
# 원본은 $ROOT/env 에 두고(그룹 읽기), 서비스 계정과 실행한 사람의 ~/.ssh 에 0600 사본을 둔다.
# 다른 팀원은 infra/gcp/README.md 의 한 줄로 각자 복사한다.
KEY="$ROOT/env/github_deploy"
if [[ ! -f "$KEY" ]]; then
  ssh-keygen -q -t ed25519 -N '' -C "gwamegi@$(hostname)" -f "$KEY"
  chown "$APP_USER:$APP_USER" "$KEY" "$KEY.pub"
  chmod 0640 "$KEY"
fi
install_key() { # <user> <home>
  install -d -o "$1" -g "$(id -gn "$1")" -m 700 "$2/.ssh"
  install -o "$1" -g "$(id -gn "$1")" -m 600 "$KEY" "$2/.ssh/gwamegi_github"
}
install_key "$APP_USER" "$APP_HOME"
[[ -n "${SUDO_USER:-}" && "$SUDO_USER" != root ]] && install_key "$SUDO_USER" "$(getent passwd "$SUDO_USER" | cut -d: -f6)"
SSH_CMD='ssh -i ~/.ssh/gwamegi_github -o IdentitiesOnly=yes'

step '저장소'
if [[ ! -d "$ROOT/dev/.git" ]]; then
  if ! as_app env GIT_SSH_COMMAND="$SSH_CMD" git ls-remote "$REPO" >/dev/null 2>&1; then
    echo 'GitHub 이 이 키를 모른다. 아래 공개키를 저장소 deploy key(쓰기 허용)로 등록하고 다시 실행:'
    echo "  gh repo deploy-key add - --repo BiQnT/gurong_agent26 --allow-write --title 'gcp $(hostname)' <<< '$(cat "$KEY.pub")'"
    exit 2
  fi
  as_app env GIT_SSH_COMMAND="$SSH_CMD" git clone --branch "$BRANCH" "$REPO" "$ROOT/dev"
  as_app git -C "$ROOT/dev" config core.sshCommand "$SSH_CMD"
  # 여러 계정이 같은 .git 에 쓰므로 객체 파일을 그룹 쓰기로 만든다.
  as_app git -C "$ROOT/dev" config core.sharedRepository group
fi
chmod -R g+rwX "$ROOT/dev"

step '비밀값 파일'
if [[ ! -f "$ROOT/env/secrets.env" ]]; then
  install -o "$APP_USER" -g "$APP_USER" -m 0640 "$ROOT/dev/infra/gcp/secrets.env.example" "$ROOT/env/secrets.env"
  echo "$ROOT/env/secrets.env 를 만들었다. 값을 채워야 채팅이 동작한다."
fi

step 'systemd'
install -m 644 "$ROOT"/dev/infra/gcp/systemd/*.service "$ROOT"/dev/infra/gcp/systemd/*.timer /etc/systemd/system/
install -m 755 "$ROOT/dev/infra/gcp/backup.sh" /usr/local/bin/gwamegi-backup
systemctl daemon-reload
systemctl enable --now gwamegi-backup.timer
systemctl enable gwamegi-dev gwamegi-prod

step 'dev 서버'
as_app bash -c "cd '$ROOT/dev/prototype' && npm ci --no-audit --no-fund"
systemctl restart gwamegi-dev

step '다음 할 일'
cat <<EOF
- prod 첫 배포:   sudo $ROOT/dev/infra/gcp/deploy.sh          (기본 origin/main)
- 비밀값:         sudo -u $APP_USER -e $ROOT/env/secrets.env  후  sudo systemctl restart gwamegi-dev gwamegi-prod
- 팀원 그룹 반영:  각자 SSH 재접속
EOF
