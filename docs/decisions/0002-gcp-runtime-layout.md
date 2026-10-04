# 0002. GCP VM 하나에 dev·prod 를 나눠 띄우고 SQLite 는 공유한다

- **날짜**: 2026-10-04
- **상태**: 대체됨 (→ [0005](0005-merge-backend-into-haepung-app.md))
- **정한 사람**: 안동현
- **관련**: [infra/gcp/README.md](../../infra/gcp/README.md), 본선 서비스 기획서 "기본 개발 환경"

## 맥락

본선용으로 주최 측 GCP VM 하나(`bremen`, 디스크 10GB, 팀원 4명이 각자 SSH 계정)를 받았다.
기획서는 Next.js 단일 앱 + SQLite 단일 파일로 정해 두었다. 정해야 했던 것:

- 개발용과 배포용을 어떻게 나누나 (폴더, 포트, 코드 반영 방식)
- 4명이 같은 VM 에서 작업할 때 파일 권한
- DB 를 나누나 합치나

제약: VM 방화벽은 주최 측이 관리하고 지금은 22번만 열려 있다. 디스크 여유는 5GB 였다.

## 결정

- `/srv/gwamegi` 아래에 `dev`(git clone, `next dev` 127.0.0.1:3001)와
  `prod/releases/*` + `current` 링크(`next start` 0.0.0.0:3000)를 둔다. 둘 다 systemd 서비스다.
- prod 는 `deploy.sh` 로만 바꾼다. dev 저장소로 fetch 한 커밋을 새 release 폴더에 풀어 빌드하고,
  `current` 를 바꾼 뒤 `/api/health` 의 commit 이 맞지 않으면 직전 release 로 되돌린다.
- 서비스는 전용 계정 `gwamegi` 로 돌리고, 팀원은 `gwamegi` 그룹 + setgid 폴더 + umask 002 로 같이 쓴다.
- GitHub 인증은 이 저장소 전용 쓰기 deploy key 하나.
- SQLite 파일 하나(`data/gwamegi.db`)를 dev·prod 가 같이 쓴다. WAL 모드.
- `claude` CLI 는 앱 의존성이 아니라 VM 전역에 버전을 고정해 하나만 설치한다.

## 이유

- release 폴더 방식이면 빌드 중에도 prod 가 이전 빌드로 계속 돈다. 같은 폴더에서
  `next build` 하면 돌고 있는 서버의 `.next` 를 덮어쓴다.
- DB 공유는 팀 결정이다. dev 에서 만든 배치·대화가 prod 화면에도 바로 보여 시연 준비가 빠르다.
  대신 마이그레이션은 추가만 하고, 정기 수집은 prod 에서만 돌린다 (두 번 쌓이지 않게).
- npm 으로 받은 Claude Code 는 glibc·musl 바이너리를 둘 다 받아 465MB 다. dev 와 release 마다
  깔았더니 첫 배포 후 디스크 여유가 1.9GB 로 줄었다.
- 개인 GitHub 로그인을 VM 에 남기면 그 사람의 모든 저장소 권한이 공용 VM 에 남는다.

## 검토한 대안

| 대안 | 왜 안 골랐나 |
| --- | --- |
| dev·prod DB 분리 | 팀이 공유를 원했다. 경로가 환경변수(`DATABASE_PATH`)라 나중에 한 줄로 나눌 수 있다 |
| prod 도 git clone 에서 `git pull` 후 빌드 | 빌드 중 prod 가 깨지고, 롤백이 번거롭다 |
| Docker | 10GB 디스크에 이미지 레이어까지 얹기 어렵고, 팀원이 VM 에서 바로 고치는 흐름과 안 맞는다 |
| nginx 리버스 프록시 | 지금은 방화벽이 22번만 열려 있어 의미가 없다. HTTPS(음성 입력)가 필요해지면 추가 |

## 결과

- 쉬워지는 것: 팀원 누구나 SSH 로 dev 를 고치고 `deploy.sh` 한 줄로 prod 반영, 실패하면 자동 롤백
- 감수하는 것: dev 의 실수가 prod DB 에 바로 닿는다 (매일 백업 14개로 보완). dev 작업 폴더를 4명이 같이 쓴다
- 되돌리려면: systemd 유닛의 `DATABASE_PATH` 를 나누고, `infra/gcp/` 스크립트를 고쳐 다시 실행
