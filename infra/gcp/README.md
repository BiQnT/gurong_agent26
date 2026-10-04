# GCP VM 운영

- **마지막 확인일**: 2026-10-04
- VM: `bremen` · `34.30.209.101` · 프로젝트 `dt-509509` · `us-central1-a` · Debian 13 · 4 vCPU / 15GB / 디스크 10GB
- 왜 이렇게 구성했나: [0002 GCP 실행 환경](../../docs/decisions/0002-gcp-runtime-layout.md)

## 구성

```
/srv/gwamegi/
  dev/                 git clone. 팀원이 SSH 로 들어와 고치는 곳 → gwamegi-dev  127.0.0.1:3001 (next dev)
  prod/releases/<시각>-<커밋>/   배포본 (최근 2개)
  prod/current → releases/...    → gwamegi-prod  0.0.0.0:3000 (next start)
  data/gwamegi.db      dev·prod 공유 SQLite (data·backups·env 는 gwamegi 그룹만 읽는다)
  data/agent-workdir/  claude 를 띄우는 빈 폴더
  data/claude-home/    서버용 claude 설정·대화 세션 (CLAUDE_CONFIG_DIR)
  env/secrets.env      비밀값 (gwamegi 그룹만 읽기)
  env/github_deploy    이 저장소 전용 deploy key (쓰기 가능)
  backups/             매일 04:00 KST DB 백업, 14개 보존
```

- 서비스는 `gwamegi` 시스템 계정으로 돈다. 팀원 계정(biqnt, kyo74, seong, ytae)은 `gwamegi` 그룹이라 `/srv/gwamegi` 를 같이 쓴다.
- `claude` CLI 는 전역 설치(`/usr/bin/claude`, 버전은 `bootstrap.sh` 의 `CLAUDE_CODE_VERSION`). 서버도 팀원도 같은 걸 쓴다.

## 접속

```bash
ssh -i ~/.ssh/my_key <계정>@34.30.209.101
# 브라우저로 보려면 터널 (지금은 방화벽이 22번만 열려 있다)
ssh -i ~/.ssh/my_key -L 3000:localhost:3000 -L 3001:localhost:3001 <계정>@34.30.209.101
# → http://localhost:3000 (prod), http://localhost:3001 (dev)
```

브라우저가 아이디·비밀번호를 물으면 `secrets.env` 의 `BASIC_AUTH`(`아이디:비밀번호`)를 넣는다.
팀원은 `sudo grep BASIC_AUTH /srv/gwamegi/env/secrets.env` 로 확인한다.

**외부 공개는 주최 측 요청이 필요하다.** VM 에서는 방화벽을 바꿀 권한이 없다. 요청할 내용:

```bash
gcloud compute firewall-rules create bremen-web --project=dt-509509 --network=default \
  --direction=INGRESS --action=ALLOW --rules=tcp:3000 --source-ranges=0.0.0.0/0 --target-tags=bremen-web
gcloud compute instances add-tags bremen --project=dt-509509 --zone=us-central1-a --tags=bremen-web
```

음성 입력(마이크)은 브라우저가 HTTPS 에서만 허용하므로, 쓰게 되면 80·443 도 함께 요청한다.

## 처음 한 번 (완료됨, 2026-10-04)

```bash
scp -i ~/.ssh/my_key infra/gcp/bootstrap.sh <계정>@34.30.209.101:~/
ssh ... 'sudo BRANCH=main bash ~/bootstrap.sh kyo74 seong ytae'
# deploy key 가 없으면 공개키를 출력하고 멈춘다 → 출력된 gh 명령으로 등록 → 다시 실행
```

## 팀원이 처음 들어왔을 때

```bash
# 1. 그룹 반영을 위해 한 번 나갔다 다시 접속
# 2. dev 에서 push 하려면 deploy key 를 내 계정에 복사
install -m 600 /srv/gwamegi/env/github_deploy ~/.ssh/gwamegi_github
# 3. 커밋 작성자 설정
git -C /srv/gwamegi/dev config user.name "이름"; git -C /srv/gwamegi/dev config user.email "메일"
# 4. Claude Code 로 작업하려면
cd /srv/gwamegi/dev && claude     # 처음엔 각자 /login
```

dev 폴더는 하나를 같이 쓴다. 두 사람이 동시에 다른 브랜치를 체크아웃하면 서로 덮어쓰므로
VM 에서 작업할 때는 단톡에 알리고, 큰 작업은 각자 로컬에서 한다.

## 비밀값

```bash
sudo -u gwamegi -e /srv/gwamegi/env/secrets.env      # 항목 설명은 secrets.env.example
sudo systemctl restart gwamegi-dev gwamegi-prod
```

- `EUM_SERVICE_KEY`: 없으면 E-UM 도구가 "키 없음" 실패를 돌려준다.
- `BASIC_AUTH`: 공용 접속 암호. bootstrap 이 비어 있으면 만들어 넣는다. 지우면 암호 없이 열린다 (권하지 않는다).
- `AGENT_AUTH_MODE=subscription`: 로컬 맥에서 `claude setup-token` 을 실행해 받은 토큰을 `CLAUDE_CODE_OAUTH_TOKEN` 에 넣는다.
- 심사·시연처럼 팀 밖 사람이 쓰기 전에 `AGENT_AUTH_MODE=api_key` 와 `ANTHROPIC_API_KEY` 로 바꾼다.
  개인 구독 계정으로 다른 사람에게 서비스하는 것은 Anthropic 약관상 허용되지 않는다.

## 배포 (prod)

```bash
sudo gwamegi-deploy                  # origin/main
sudo gwamegi-deploy <브랜치·커밋>      # 확인용으로 다른 ref
sudo gwamegi-deploy --rollback       # 직전 정상 release 로
```

새 release 폴더에 풀고 빌드한 뒤 `current` 를 바꿔 재시작한다. 재시작이 실패하거나 `/api/health` 의
commit 이 맞지 않으면 직전 release 로 자동으로 되돌리고 실패한 폴더는 지운다. 빌드는 1~2분 걸린다.

`gwamegi-deploy` 는 `infra/gcp/deploy.sh` 의 root 소유 사본이다. `deploy.sh` 를 고쳤으면
`sudo bash /srv/gwamegi/dev/infra/gcp/bootstrap.sh` 를 다시 돌려야 반영된다 (systemd 유닛도 같다).

## dev

dev 서버는 `next dev` 라 파일을 저장하면 바로 반영된다. 의존성이 바뀌었으면:

```bash
cd /srv/gwamegi/dev/prototype && npm ci && sudo systemctl restart gwamegi-dev
```

## 규칙 (DB 공유 때문에)

- 마이그레이션은 테이블·컬럼 **추가만** 한다. dev 에서 적용하는 순간 prod 도 같은 DB 를 쓴다.
- 30분 주기 수집 같은 정기 작업은 prod 에서만 돌린다 (dev 도 돌리면 두 번 쌓인다).
- 테스트 대화는 `app_env='dev'` 로 남는다. 시연 전에 지우려면 `app_env` 로 거른다.

## 상태 확인

```bash
systemctl status gwamegi-prod gwamegi-dev
journalctl -u gwamegi-prod -f                 # 채팅 한 턴마다 {"event":"chat_turn",...} 한 줄
curl -s localhost:3000/api/health
systemctl list-timers gwamegi-backup.timer
df -h /                                        # 디스크 10GB. 배포본은 2개만 남긴다
```

DB 복구 (`-wal`·`-shm` 을 지우지 않으면 남은 기록이 복구본 위에 덧씌워진다):

```bash
sudo systemctl stop gwamegi-dev gwamegi-prod
sudo rm -f /srv/gwamegi/data/gwamegi.db-wal /srv/gwamegi/data/gwamegi.db-shm
gunzip -c /srv/gwamegi/backups/<파일> | sudo -u gwamegi tee /srv/gwamegi/data/gwamegi.db >/dev/null
sudo systemctl start gwamegi-dev gwamegi-prod
```
