# GCP VM 운영 (해풍)

- **작성**: 2026-10-04 · 같은 날 새 VM 에서 bootstrap, prod 배포, 복원 연습까지 실행해 확인했다
- VM: `35.192.216.232` · Debian 12 · 8 vCPU · 메모리 31GB, 스왑 없음 (2026-10-04 확인. 처음 받았을 때는 2 vCPU·1.9GB) · 디스크 296GB · Node v22
- 계정: biqnt, kyo74, seong, ytae (모두 sudo). 서비스 계정·그룹 이름은 `haepung`
- 배경: [0002 GCP 실행 환경](../../docs/decisions/0002-gcp-runtime-layout.md) (옛 VM 기준) → [0005 백엔드를 해풍 앱에 합침](../../docs/decisions/0005-merge-backend-into-haepung-app.md)

| | 주소 | 앱 (내부) | 접속 암호 |
| --- | --- | --- | --- |
| prod | `https://35-192-216-232.sslip.io` (80 은 https 로 넘김) | `node server/main.ts` 127.0.0.1:3000 | 없음 (앱 로그인) |
| dev | `https://dev.35-192-216-232.sslip.io` (80 은 https 로 넘김) | `vite` 127.0.0.1:3001 (저장하면 바로 반영) | 없음. 화면 파일만 준다 (`DEV_OPEN=1`) |

## 구성

```
/srv/haepung/
  dev/                  git clone (공용 "합쳐진 결과 확인" 폴더, main) → haepung-dev
  releases/<시각>-<커밋>/   배포본 (정상 5개). 저장소 전체를 풀어 빌드한 것
  current → releases/...    → haepung-prod, haepung-collect (30분 수집기)
  db/haepung.db         dev·prod 공유 SQLite (db·backups·claude·env 는 haepung 그룹만 읽는다)
  backups/              매일 04:00 KST 와 배포 직전 DB 백업, 종류별 14개
  claude/{home,workdir} CLAUDE_CONFIG_DIR, AGENT_WORKDIR
  env/haepung.env       팀원이 만든 E-UM 키·OpenAI 키. 고치지 않는다
  env/backend.env       우리 쪽 키와 설정 (틀: infra/gcp/backend.env.example)
  env/github_deploy     이 저장소 전용 deploy key (쓰기 가능)
  work/<계정>/           개인 worktree 자리 (아래 규칙)
  data/workspace.json   옛 앱의 데이터. 처음 한 번 DB 로 가져온 뒤 그대로 둔다
/etc/haepung/{prod,dev}.env   bootstrap 이 만드는 주소 설정 (PUBLIC_ORIGINS 등)
/etc/caddy/Caddyfile          bootstrap 이 만든다. 직접 고치지 않는다
```

- 유닛은 `infra/gcp/systemd/`. 서비스는 `haepung` 계정으로 돌고, NoNewPrivileges·PrivateTmp·ProtectSystem=full·ProtectHome 으로 좁힌다 (`/srv`·`/var` 는 쓰기 가능).
- Caddy 가 80·443 을 받아 앱(127.0.0.1)으로 넘긴다. 443 은 주소 이름으로 prod(`<도메인>`)와 dev(`dev.<도메인>`)를 나누고, dev 는 Vite 의 웹소켓(화면 자동 갱신)도 같이 넘긴다. 이유는 [0007](../../docs/decisions/0007-dev-subdomain-on-443.md).
- prod 와 dev 응답에는 `X-Frame-Options: DENY` 와 `Content-Security-Policy: frame-ancestors 'none'` 을 붙인다. 다른 사이트가 화면을 iframe 으로 감싸 덕장 주인의 버튼을 누르게 만드는 것(클릭재킹)을 막는다. 80 은 https 로 넘기기만 한다.
- 수집기: `haepung-collect.timer` 가 매시 00분·30분에 `haepung-collect.service`(oneshot, prod 와 같은 환경, `Nice=10`, 시간 제한 300초)를 띄운다. current 에 `server/collect.ts` 가 없는 옛 release 면 건너뛴다. 동작은 [수집기](../../docs/design/backend.md#수집기).
- 인증서는 Caddy 가 자동 발급한다. sslip.io 는 공용 도메인이라 발급 한도에 걸릴 수 있다 (`journalctl -u caddy`, Caddy 가 다른 발급처로 재시도한다).
- 방화벽은 tcp:80,443 만 있으면 된다. 지금 VM 의 `http-server`·`https-server` 태그(GCP 기본 규칙)가 연다. 방화벽은 VM 안(sudo)에서 바꿀 수 없고, GCP 프로젝트에 권한(예: Compute Security Admin)이 있는 계정이 콘솔이나 `gcloud` 로 바꾼다.
- `claude` CLI 는 전역 설치 (버전은 `bootstrap.sh` 의 `CLAUDE_CODE_VERSION`). 서버도 팀원도 같은 걸 쓴다.
- 옛 `haepung.service` (vite preview 4173)는 bootstrap 이 끄고 비활성화한다. 파일과 `data/`·`env/` 는 지우지 않는다.

## 처음 한 번 (컷오버)

저장소의 `infra/gcp` 가 main 에 들어가기 전이면 `BRANCH=<브랜치>` 를 붙인다.

```bash
# 1. 내 맥에서 bootstrap 만 올려 실행. deploy key 가 없으면 공개키를 출력하고 멈춘다
scp -i ~/.ssh/<키> infra/gcp/bootstrap.sh biqnt@35.192.216.232:~/
ssh -t -i ~/.ssh/<키> biqnt@35.192.216.232 'sudo BRANCH=main bash ~/bootstrap.sh'
# 2. 출력된 gh 명령으로 deploy key 등록 → 1번 그대로 다시 실행 (dev 를 클론하고 서비스를 설치한다)
# 3. 키 채우기 (KMA_AUTH_KEY, DATA_GO_KR_KEY, CLAUDE_CODE_OAUTH_TOKEN). 비밀이라 화면에 찍지 않는다
sudoedit /srv/haepung/env/backend.env
# 4. 옛 앱 데이터를 DB 로 한 번만 가져온다 (bootstrap 은 데이터를 건드리지 않는다)
cd /srv/haepung/dev && sudo -u haepung DATABASE_PATH=/srv/haepung/db/haepung.db node scripts/admin.ts import-json /srv/haepung/data/workspace.json
# 5. prod 배포 후 확인
sudo haepung-deploy
curl -s http://127.0.0.1:3000/api/health      # commit, DB 읽기, eum 설정 상태
```

폰에서 prod·dev 로그인과 채팅, 밖에서 dev 로 `/.env.local` 같은 파일이 막히는지 확인한다.
bootstrap 은 여러 번 돌려도 안전하다. 유닛·Caddyfile·배포 스크립트를 고쳤거나 외부 IP 가 바뀌면 main 에 머지하고
`git -C /srv/haepung/dev pull --ff-only` 후 `sudo bash /srv/haepung/dev/infra/gcp/bootstrap.sh` 를 다시 돌린다.
dev 의 `infra/gcp` 에 커밋되지 않은 변경이 있으면 bootstrap 이 멈춘다 (고친 내용이 root 로 깔리는 것을 막는다).

## 비밀값

```bash
sudoedit /srv/haepung/env/backend.env        # 항목 설명은 backend.env.example
sudo systemctl restart haepung-dev haepung-prod
```

- 두 서비스(와 수집기)는 `haepung.env` → `backend.env` 순으로 읽고, 뒤가 앞을 이긴다. `PUBLIC_ORIGINS` 등 주소 설정은 `/etc/haepung/*.env` 가 마지막이다.
- `DEV_BASIC_AUTH`: dev 접속 암호 `아이디:비밀번호`. 비어 있으면 bootstrap 이 만든다. 지금은 `/etc/haepung/dev.env` 의 `DEV_OPEN=1` 이 앞서서 쓰이지 않는다. 다시 잠그려면 bootstrap 에서 `DEV_OPEN=1` 을 빼고 머지·재실행한다. prod 유닛은 이 값을 지우고 띄운다([접근 제어](../../docs/design/backend.md#접근-제어)).
- `AGENT_AUTH_MODE=subscription`: 로컬에서 `claude setup-token` 으로 받은 토큰을 `CLAUDE_CODE_OAUTH_TOKEN` 에 넣는다.
  심사·시연처럼 팀 밖 사람이 쓰기 전에 `api_key` 와 `ANTHROPIC_API_KEY` 로 바꾼다 (개인 구독으로 남에게 서비스하는 것은 약관상 안 된다).
- 키·토큰 값은 채팅·로그·커밋에 올리지 않는다.

## 배포 (prod)

```bash
sudo haepung-deploy --list           # main 최근 커밋, 태그, 서버에 남은 정상 배포본
sudo haepung-deploy                  # origin/main
sudo haepung-deploy v0.1             # 태그·커밋·브랜치
sudo haepung-deploy --rollback       # 현재가 아닌 가장 최근 정상 release 로 (두 번 하면 다시 돌아온다)
```

흐름: 저장소 전체를 새 release 폴더에 풀기 → `npm ci && npm run build` → **DB 백업(배포 직전)** → `current` 교체·재시작 →
`http://127.0.0.1:3000/api/health` 에 새 커밋이 보이면 성공. 재시작이나 헬스체크가 실패하면 직전 정상 release 로 자동으로 되돌린다.
되돌린 뒤에는 그 release 의 커밋이 헬스체크에 보이는지도 확인한다. 이것도 통과하지 못하면 "되돌린 prod 도 헬스체크를 통과하지 못했다" 경고를 내므로 `journalctl -u haepung-prod` 를 본다. 어느 쪽이든 배포는 실패(종료 코드 1)로 끝난다.
빌드는 1-2분. 메모리 여유가 600MB 미만이면 시작 전에 멈춘다 (`sudo systemctl stop haepung-dev` 후 다시, 감수하면 `--force-low-mem`).

- `npm prune` 은 하지 않는다. 서버가 쓰는 외부 패키지는 `better-sqlite3` 뿐이지만, release 안에서 admin·collect 스크립트를 돌릴 때
  개발 의존성이 필요할 수 있고 디스크가 넉넉하다.
- **DB 저장 형식(schema)을 올리는 배포**는 `--upgrade-schema` 를 붙인다. 새 prod 를 시작하는 동안만 `ALLOW_SCHEMA_UPGRADE=1` 을 건다.
  이후 옛 release 가 DB 를 못 읽을 수 있어서 `--rollback` 이 안 되면 아래 복구로 배포 직전 백업(`predeploy`)을 되살린다.
  dev 와 DB 를 공유하므로, 형식을 바꾸는 작업은 dev 를 따로 만든 DB 로 돌린 뒤 배포한다.
- 옛 팀원 release(`.ok` 표시가 없는 폴더)는 배포·롤백·정리 어디에도 쓰지 않는다. 쓸모가 없어지면 사람이 지운다.
- `haepung-deploy` 는 `infra/gcp/deploy.sh` 의 root 소유 사본이다 (고치면 bootstrap 재실행).

## 백업과 복구

DB 는 매일 04:00 KST 와 배포 직전에 `/srv/haepung/backups/haepung-{daily,predeploy}-<시각>.db.gz` 로 남고 종류별 14개를 보존한다.
`.backup` 으로 복사한 뒤 `integrity_check` 를 통과해야 저장한다. 지금 한 번 받기: `sudo -u haepung /usr/local/bin/haepung-backup`.

복구 (`-wal`·`-shm` 을 지우지 않으면 남은 기록이 복구본 위에 덧씌워진다):

```bash
sudo -u haepung /usr/local/bin/haepung-backup predeploy      # 복구 직전 상태도 남긴다
sudo systemctl stop haepung-dev haepung-prod haepung-collect.timer
sudo rm -f /srv/haepung/db/haepung.db-wal /srv/haepung/db/haepung.db-shm
gunzip -c /srv/haepung/backups/<파일> | sudo -u haepung tee /srv/haepung/db/haepung.db >/dev/null
sudo chmod 660 /srv/haepung/db/haepung.db
sudo systemctl start haepung-dev haepung-prod haepung-collect.timer
```

**복원 연습** (배포 직후 한 번, 서비스를 건드리지 않는다):

```bash
f=$(ls -1t /srv/haepung/backups/haepung-*.db.gz | head -1)
sudo -u haepung bash -c "gunzip -c '$f' > /srv/haepung/backups/drill.db"
sqlite3 /srv/haepung/backups/drill.db 'PRAGMA integrity_check;' '.tables'      # ok 와 표 목록
cd /srv/haepung/current
sudo -u haepung env DATABASE_PATH=/srv/haepung/backups/drill.db HOST=127.0.0.1 PORT=3999 timeout 15 node server/main.ts &
sleep 4; curl -s http://127.0.0.1:3999/api/health; echo; wait
sudo rm -f /srv/haepung/backups/drill.db*
```

health 가 DB 를 읽어서 정상이면 통과다. 날짜와 결과는 팀 노션에 남긴다.

## 팀원이 처음 들어왔을 때

```bash
# 1. 그룹 반영을 위해 한 번 나갔다 다시 접속
# 2. push 하려면 deploy key 를 내 계정에 복사하고 작성자를 설정
install -m 600 /srv/haepung/env/github_deploy ~/.ssh/haepung_github
git config --global user.name "이름"; git config --global user.email "메일"
# 3. Claude Code 는 각자 /login. 설치는 전역에 이미 있다
```

### 개인 worktree 규칙 (SSH 로 Claude Code 를 쓸 때)

- `/srv/haepung/dev` 는 **합쳐진 결과를 폰으로 확인하는 공용 폴더**다. 여기서 직접 고치거나 브랜치를 바꾸지 않는다.
  main 이 바뀌면 `git -C /srv/haepung/dev pull --ff-only` 로 맞출 뿐이다.
- 내 작업은 내 자리에 worktree 를 따로 만들어 한다. 확인은 테스트로 하고(`npm test`, `npm run build`), 통과하면 push → PR:

```bash
git -C /srv/haepung/dev fetch origin
git -C /srv/haepung/dev worktree add /srv/haepung/work/$USER/<이름> -b <브랜치> origin/main
cd /srv/haepung/work/$USER/<이름> && npm ci && claude
# 끝나면: git -C /srv/haepung/dev worktree remove /srv/haepung/work/$USER/<이름>
```

- **개인 dev 서버는 띄우지 않는다** (`npm run dev`, `vite`). 포트(3000·3001)와 DB 를 서버와 같이 쓰게 된다. 화면 확인은 머지 후 공용 dev 에서.
- worktree 마다 `node_modules`(수백 MB)가 생긴다. 안 쓰는 건 지운다.

## 메모리 주의 (31GB, 스왑 없음)

- 상시: Caddy, prod(node), dev(vite 와 dev 가 띄운 claude), 가끔 수집기(oneshot). 더해서 claude 가 채팅 한 턴마다 뜬다.
  `AGENT_MAX_CONCURRENCY=2` 로 claude 를 동시에 2개까지만 띄운다.
- 스왑이 없어서 폭주한 서비스가 VM 전체(SSH 포함)를 멈추지 않게 prod·dev 유닛에 cgroup 상한을 둔다. 띄운 claude 도 이 상한 안에 든다. `MemoryHigh` 를 넘으면 커널이 메모리를 회수하며 느려지고, `MemoryMax` 를 넘으면 그 cgroup 안에서만 프로세스가 죽고 `Restart=on-failure` 로 다시 뜬다.

| 유닛 | `MemoryHigh` | `MemoryMax` |
| --- | --- | --- |
| `haepung-prod` | 3G | 4G |
| `haepung-dev` | 1500M | 2G |
- SSH 의 Claude Code 와 빌드(`npm ci`, `npm run build`)도 수백 MB 를 쓴다. 여럿이 동시에 돌리지 않는다.
  시작 전에 `free -m` 의 `available` 이 600MB 이상인지 본다. 배포는 이 검사를 스스로 한다.
- 어디서 쓰는지 보기:

```bash
free -m
ps -eo pid,user,rss,args --sort=-rss | head -8      # rss 는 KB
systemctl status haepung-prod haepung-dev | grep -E 'Memory|Active'
journalctl -k --since '1 day ago' | grep -i 'out of memory'    # OOM 으로 죽은 기록
```

- OOM 이 반복되면 먼저 스왑 파일 추가를 검토한다 (지금은 소유자 결정으로 없다).

## 상태 확인

```bash
systemctl status haepung-prod haepung-dev caddy
systemctl list-timers 'haepung-*'
journalctl -u haepung-prod -f
journalctl -u haepung-collect -n 20      # 수집 결과 한 줄 (source, recorded, missing, failed)
journalctl -u caddy -f
curl -s http://127.0.0.1:3000/api/health
df -h /
```

## 새 VM 으로 옮길 때

외부 IP 가 바뀌면 주소(`<IP 를 -로>.sslip.io`)도 바뀐다. 같은 VM 에서 IP 만 바뀐 경우는 4번(bootstrap 재실행)만 하면 된다.

1. 새 VM: Debian 12, 팀원 계정·SSH 키, GCP 방화벽 tcp:22,80,443 (`http-server`·`https-server` 태그). Node 22.18 이상은 bootstrap 이 없으면 설치한다.
2. 옛 VM 에서 가져올 것: `env/haepung.env`, `env/backend.env` (`scp` 로 내 맥을 거쳐 옮기고 화면에 찍지 않는다), 최신 DB 백업 하나.
3. 새 VM 에서 "처음 한 번" 1-2 단계 (deploy key 는 새로 만들어진다. 옛 키는 `gh repo deploy-key delete` 로 지운다).
4. `sudo bash /srv/haepung/dev/infra/gcp/bootstrap.sh`: 메타데이터의 외부 IP 로 Caddyfile 과 `/etc/haepung/*.env` 를 다시 만든다.
5. 서비스를 멈추고 위 "복구" 절차로 백업을 `/srv/haepung/db/haepung.db` 에 올린다. 옛 `data/workspace.json` 은 처음 컷오버에만 쓴다.
6. `sudo install -o root -g haepung -m 0640 <옮긴 파일> /srv/haepung/env/` 후 `sudo haepung-deploy`.
7. 팀에 새 주소를 알린다. 초대 링크와 로그인 쿠키는 주소에 묶여 있어 새 주소에서 다시 해야 한다.
8. 옛 VM 은 서비스를 멈추고 deploy key 를 지운 뒤 정리한다. 고정 외부 IP 를 쓰면 주소가 바뀌지 않는다.

## 규칙 (DB 공유 때문에)

- 저장 형식 변경은 위 `--upgrade-schema` 절차와 dev 분리 DB 로 한다. dev 의 실수가 prod 에 바로 닿는다 (백업 14개로 보완).
- 30분 수집 같은 정기 작업은 prod 에서만 돌린다 (`haepung-collect.timer`). dev 에서 돌리면 두 번 쌓인다.
