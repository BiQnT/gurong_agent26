#!/usr/bin/env bash
# VM 셋업. 여러 번 실행해도 안전하다 (이미 된 단계는 건너뛴다). 외부 IP 가 바뀌었을 때도 다시 실행한다.
#
#   sudo BRANCH=main bash bootstrap.sh [추가 계정...]
#
# 처음 한 번은 저장소가 VM 에 없으므로 이 파일만 scp 로 올려서 실행한다 (infra/gcp/README.md).
# GitHub deploy key 가 등록되지 않았으면 공개키를 출력하고 멈춘다. 등록 후 다시 실행한다.
# 이 스크립트는 DB 를 만들거나 데이터를 가져오지 않는다 (README "처음 한 번" 의 import-json).
set -euo pipefail

ROOT=/srv/haepung
APP_USER=haepung
REPO=git@github.com:BiQnT/gurong_agent26.git
BRANCH=${BRANCH:-main}
NODE_MAJOR=22
# 제품이 띄우는 claude 버전. 올릴 때는 dev 에서 채팅을 먼저 확인한다.
CLAUDE_CODE_VERSION=2.1.289
# 팀원 계정. 있는 계정만 haepung 그룹에 넣는다.
TEAM=(biqnt kyo74 seong ytae)
# GitHub 공식 ed25519 호스트키 지문 (docs.github.com "GitHub's SSH key fingerprints")
GITHUB_ED25519_FP='SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU'

step() { printf '\n== %s\n' "$*"; }
as_app() { sudo -u "$APP_USER" -H bash -c 'umask 007; exec "$@"' _ "$@"; }
# 파일 내용이 다를 때만 쓰고 0 을 돌려준다 (같으면 1).
write_if_changed() { # <경로> <내용>
  if [[ -f "$1" && "$(cat "$1")" == "$2" ]]; then return 1; fi
  printf '%s\n' "$2" > "$1"
  chmod 644 "$1"
}

[[ $EUID -eq 0 ]] || { echo 'sudo 로 실행해야 한다'; exit 1; }
MEMBERS=("${TEAM[@]}" "$@")
[[ -n "${SUDO_USER:-}" && "$SUDO_USER" != root ]] && MEMBERS+=("$SUDO_USER")

step '패키지'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates build-essential python3 sqlite3 gpg \
  debian-keyring debian-archive-keyring apt-transport-https >/dev/null

step "Node.js $NODE_MAJOR"
if ! node --version 2>/dev/null | grep -q "^v$NODE_MAJOR\."; then
  curl -fsSL "https://deb.nodesource.com/setup_$NODE_MAJOR.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
# 22.18 부터 .ts 파일을 node 로 바로 실행할 수 있다 (서버와 관리 스크립트가 쓴다).
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a===22 && b<18) { console.error("node >= 22.18 필요:", process.version); process.exit(1) }'
# systemd 유닛은 /usr/bin/env node 로 찾는다. 홈 아래(nvm 등)에 있으면 서비스가 못 쓴다.
case "$(readlink -f "$(command -v node)")" in
  /usr/*) ;;
  *) echo "node 가 /usr 밖에 있다: $(command -v node). systemd 서비스가 찾지 못한다"; exit 1 ;;
esac
node --version

step "Claude Code CLI $CLAUDE_CODE_VERSION"
# 앱 의존성이 아니라 전역에 하나만 둔다. 서버도, 팀원이 VM 에서 여는 Claude Code 도 이걸 쓴다.
if [[ "$(claude --version 2>/dev/null | awk '{print $1}')" != "$CLAUDE_CODE_VERSION" ]]; then
  npm install -g --no-audit --no-fund "@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION" >/dev/null
fi
claude --version

step '서비스 계정과 그룹'
getent group "$APP_USER" >/dev/null || groupadd --system "$APP_USER"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --gid "$APP_USER" --home-dir /var/lib/haepung --create-home --shell /usr/sbin/nologin "$APP_USER"
# 서비스는 ProtectHome 으로 /home 을 못 본다. 홈이 /srv·/var 밖이면 옮긴다.
APP_HOME=$(getent passwd "$APP_USER" | cut -d: -f6)
case "$APP_HOME" in
  /srv/* | /var/*) ;;
  *) usermod -d /var/lib/haepung "$APP_USER"; APP_HOME=/var/lib/haepung ;;
esac
[[ -d "$APP_HOME" ]] || install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_HOME"
for member in "${MEMBERS[@]}"; do
  id "$member" >/dev/null 2>&1 && usermod -aG "$APP_USER" "$member" && echo "그룹 추가: $member"
done
# 팀원이 만든 파일도 그룹이 쓸 수 있게 한다 (dev 작업 폴더를 같이 쓴다).
cat > /etc/profile.d/haepung.sh <<'EOF'
if id -nG 2>/dev/null | grep -qw haepung; then umask 002; fi
EOF

step '폴더'
# 코드·배포본은 그룹이 쓰고, DB·claude 설정·백업은 그룹만 읽는다. data/ 와 .npm 은 팀원이 만든 그대로 둔다.
install -d -o "$APP_USER" -g "$APP_USER" -m 2775 "$ROOT" "$ROOT/releases" "$ROOT/work"
install -d -o "$APP_USER" -g "$APP_USER" -m 2770 "$ROOT/db" "$ROOT/backups" "$ROOT/claude" "$ROOT/claude/home" "$ROOT/claude/workdir"
# env 는 root 소유 그룹 읽기 전용이다. 그룹이 쓸 수 있으면 sudoedit 가 "writable directory" 로 거부한다.
install -d -o root -g "$APP_USER" -m 0750 "$ROOT/env"
install -d -o root -g root -m 0755 /etc/haepung
find "$ROOT/db" -maxdepth 1 -name 'haepung.db*' -exec chmod 660 {} +
find "$ROOT/backups" -type f -exec chmod 640 {} +
# 팀원마다 개인 worktree 자리 (README "개인 worktree 규칙")
for member in "${MEMBERS[@]}"; do
  id "$member" >/dev/null 2>&1 && install -d -o "$member" -g "$APP_USER" -m 2775 "$ROOT/work/$member"
done
git config --system --get-all safe.directory | grep -qx "$ROOT/dev" || git config --system --add safe.directory "$ROOT/dev"

step '옛 haepung.service (vite preview)'
if systemctl cat haepung.service >/dev/null 2>&1; then
  systemctl disable --now haepung.service >/dev/null 2>&1 || true
  echo 'haepung.service 를 끄고 비활성화했다. 유닛 파일과 data/·env/ 는 그대로 둔다 (정리는 사람이 한다).'
fi

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
  ssh-keygen -q -t ed25519 -N '' -C "haepung@$(hostname)" -f "$KEY"
  chown "root:$APP_USER" "$KEY" "$KEY.pub"
  chmod 0640 "$KEY"
fi
install_key() { # <user> <home>
  install -d -o "$1" -g "$(id -gn "$1")" -m 700 "$2/.ssh"
  install -o "$1" -g "$(id -gn "$1")" -m 600 "$KEY" "$2/.ssh/haepung_github"
}
install_key "$APP_USER" "$APP_HOME"
[[ -n "${SUDO_USER:-}" && "$SUDO_USER" != root ]] && install_key "$SUDO_USER" "$(getent passwd "$SUDO_USER" | cut -d: -f6)"
SSH_CMD='ssh -i ~/.ssh/haepung_github -o IdentitiesOnly=yes'

step '저장소 (dev)'
if [[ ! -d "$ROOT/dev/.git" ]]; then
  if ! as_app env GIT_SSH_COMMAND="$SSH_CMD" git ls-remote "$REPO" >/dev/null 2>&1; then
    echo 'GitHub 이 이 키를 모른다. 아래 공개키를 저장소 deploy key(쓰기 허용)로 등록하고 다시 실행:'
    echo "  gh repo deploy-key add <(echo '$(cat "$KEY.pub")') --repo BiQnT/gurong_agent26 --allow-write --title 'gcp $(hostname)'"
    exit 2
  fi
  as_app env GIT_SSH_COMMAND="$SSH_CMD" git clone --branch "$BRANCH" "$REPO" "$ROOT/dev"
  as_app git -C "$ROOT/dev" config core.sshCommand "$SSH_CMD"
  # 여러 계정이 같은 .git 에 쓰므로 객체 파일을 그룹 쓰기로 만든다. 개인 worktree 도 이 설정을 같이 쓴다.
  as_app git -C "$ROOT/dev" config core.sharedRepository group
fi
chmod -R g+rwX "$ROOT/dev"

# root 로 복사할 파일(유닛·배포·백업 스크립트)이 커밋된 내용과 같은지 확인한다. 고친 채로 돌리면 그 내용이 root 로 깔린다.
if [[ -n "$(as_app git -C "$ROOT/dev" status --porcelain -- infra/gcp)" && "${FORCE:-}" != 1 ]]; then
  echo "dev 의 infra/gcp 에 커밋되지 않은 변경이 있다. 커밋·리뷰 후 다시 실행하거나, 의도한 것이면 FORCE=1 로 실행한다."
  exit 1
fi
echo "dev 커밋: $(as_app git -C "$ROOT/dev" log --oneline -1)"

step '환경 파일'
# haepung.env 는 팀원이 만든 것이다 (EUM_SERVICE_KEY, OpenAI 키). 있으면 건드리지 않고, 없을 때만 빈 틀을 만든다.
if [[ ! -f "$ROOT/env/haepung.env" ]]; then
  printf '# E-UM 서비스키와 OpenAI 호환 키. 값을 채워야 관측·채팅이 동작한다.\nEUM_SERVICE_KEY=\n' > "$ROOT/env/haepung.env"
  chown "root:$APP_USER" "$ROOT/env/haepung.env"
  chmod 0640 "$ROOT/env/haepung.env"
  echo "$ROOT/env/haepung.env 가 없어서 빈 틀을 만들었다. EUM_SERVICE_KEY 를 채운다."
fi
ENV_FILE="$ROOT/env/backend.env"
if [[ ! -f "$ENV_FILE" ]]; then
  install -o root -g "$APP_USER" -m 0640 "$ROOT/dev/infra/gcp/backend.env.example" "$ENV_FILE"
  echo "$ENV_FILE 를 만들었다. 키를 채워야 채팅·기상청 호출이 동작한다."
fi
# dev 는 공개 주소에 열리므로 접속 암호(Basic)를 기본으로 켠다. 값은 파일에서 확인한다 (화면에 찍지 않는다).
if ! grep -q '^DEV_BASIC_AUTH=.' "$ENV_FILE"; then
  password=$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')
  sed -i '/^DEV_BASIC_AUTH=/d' "$ENV_FILE"
  [[ -z "$(tail -c1 "$ENV_FILE")" ]] || echo >> "$ENV_FILE"
  echo "DEV_BASIC_AUTH=haepung:$password" >> "$ENV_FILE"
  echo 'dev 접속 암호(DEV_BASIC_AUTH)를 만들었다.'
fi
chown "root:$APP_USER" "$ENV_FILE"
chmod 0640 "$ENV_FILE"

step '외부 주소'
# GCP 메타데이터의 외부 IP 로 sslip.io 이름을 만든다. IP 가 바뀌면 이 스크립트만 다시 실행하면 된다.
PUBLIC_IP=${PUBLIC_IP:-$(curl -fsS --max-time 5 -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip || true)}
[[ "$PUBLIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo '외부 IP 를 못 읽었다. PUBLIC_IP=<IP> 를 붙여 다시 실행한다'; exit 1; }
DOMAIN="${PUBLIC_IP//./-}.sslip.io"
# dev 는 같은 443 을 쓰고 이름으로 나눈다. GCP 방화벽은 80·443 만 열려 있으면 된다.
DEV_DOMAIN="dev.$DOMAIN"
echo "prod https://$DOMAIN"
echo "dev  https://$DEV_DOMAIN"
# 서비스가 읽는 주소 설정. 비밀이 아니라 /etc 에 둔다. 바뀐 서비스만 아래에서 다시 시작한다.
origin_changed=false
write_if_changed /etc/haepung/prod.env "# bootstrap.sh 가 만든 파일. 직접 고치지 않는다 (외부 IP 가 바뀌면 bootstrap 을 다시 실행).
HOST=127.0.0.1
PORT=3000
PUBLIC_ORIGINS=https://$DOMAIN" && origin_changed=true
write_if_changed /etc/haepung/dev.env "# bootstrap.sh 가 만든 파일. 직접 고치지 않는다 (외부 IP 가 바뀌면 bootstrap 을 다시 실행).
PUBLIC_ORIGINS=https://$DEV_DOMAIN
DEV_ALLOWED_HOSTS=$DEV_DOMAIN
DEV_HMR_CLIENT_PORT=443" && origin_changed=true

step 'systemd'
install -m 644 "$ROOT"/dev/infra/gcp/systemd/*.service "$ROOT"/dev/infra/gcp/systemd/*.timer /etc/systemd/system/
install -o root -g root -m 755 "$ROOT/dev/infra/gcp/backup.sh" /usr/local/bin/haepung-backup
# root 로 돌리는 배포 스크립트는 root 소유 사본을 쓴다 (서비스 계정이 dev 폴더의 원본을 고칠 수 있으므로).
install -o root -g root -m 755 "$ROOT/dev/infra/gcp/deploy.sh" /usr/local/sbin/haepung-deploy
systemctl daemon-reload
systemctl enable --now haepung-backup.timer haepung-collect.timer
# prod 는 첫 haepung-deploy 가 띄운다. 켜 두기만 한다.
systemctl enable haepung-dev haepung-prod
if [[ "$origin_changed" == true ]]; then
  echo '주소 설정이 바뀌었다. 떠 있는 서비스를 다시 시작한다.'
  systemctl try-restart haepung-dev haepung-prod
fi

step 'dev 서버'
# package-lock.json 이 그대로면 다시 깔지 않는다 (npm ci 는 node_modules 를 지우고 시작한다).
if [[ ! "$ROOT/dev/node_modules/.package-lock.json" -nt "$ROOT/dev/package-lock.json" ]]; then
  as_app bash -c "cd '$ROOT/dev' && npm ci --no-audit --no-fund"
fi
systemctl restart haepung-dev

step 'Caddy'
if ! command -v caddy >/dev/null; then
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
# 80 은 https 로 넘기고, 443 은 이름으로 prod 와 dev(웹소켓 포함, Caddy 가 알아서 넘긴다)를 나눈다.
# 다른 사이트가 화면을 iframe 으로 감싸 덕장 주인의 버튼을 누르게 만드는 것(클릭재킹)을 막는다.
caddyfile="# bootstrap.sh 가 만든 파일. 직접 고치지 않는다 (infra/gcp/bootstrap.sh).
(no_framing) {
	header X-Frame-Options DENY
	header Content-Security-Policy \"frame-ancestors 'none'\"
}

http://$DOMAIN, http://$DEV_DOMAIN {
	redir https://{host}{uri} permanent
}

$DOMAIN {
	import no_framing
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}

$DEV_DOMAIN {
	import no_framing
	reverse_proxy 127.0.0.1:3001
}"
if ! cmp -s <(printf '%s\n' "$caddyfile") /etc/caddy/Caddyfile; then
  printf '%s\n' "$caddyfile" > /etc/caddy/Caddyfile.new
  chmod 644 /etc/caddy/Caddyfile.new
  sudo -u caddy -H caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile \
    || { echo 'Caddyfile 검사 실패. 기존 설정은 그대로다'; rm -f /etc/caddy/Caddyfile.new; exit 1; }
  mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
  caddy_changed=true
fi
systemctl enable --now caddy
[[ "${caddy_changed:-}" != true ]] || systemctl reload-or-restart caddy

apt-get clean

step '상태'
systemctl is-active caddy haepung-dev haepung-backup.timer haepung-collect.timer || true
systemctl is-active haepung-prod || echo 'haepung-prod 는 첫 배포 전이라 꺼져 있다 (정상)'

step '다음 할 일'
cat <<EOF
- GCP 방화벽에 tcp:80,443 이 열려 있어야 인증서 발급과 접속이 된다 (VM 안에서는 확인할 수 없다)
- prod 배포:      sudo haepung-deploy          (기본 origin/main. 옵션은 sudo haepung-deploy --list)
- 비밀값:         sudoedit $ROOT/env/backend.env  후  sudo systemctl restart haepung-dev haepung-prod
- dev 접속 암호:  sudo grep DEV_BASIC_AUTH $ROOT/env/backend.env
- 팀원 그룹 반영:  각자 SSH 재접속
- 주소: https://$DOMAIN (prod), https://$DEV_DOMAIN (dev)
EOF
