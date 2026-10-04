# 0006. dev·prod DB 공유를 유지하고, 저장 검증 규칙 변경은 prod 배포를 먼저 한다

- **날짜**: 2026-10-04
- **상태**: 확정
- **정한 사람**: 안동현
- **관련**: [0005](0005-merge-backend-into-haepung-app.md), [docs/design/backend.md 저장](../design/backend.md#저장), [infra/gcp/README.md](../../infra/gcp/README.md)

## 맥락

VM 의 dev 와 prod 는 같은 SQLite 파일(`/srv/haepung/db/haepung.db`)을 쓴다. 팀이 dev 화면에서 만든 계정·덕장·기록을 prod 에서도 그대로 보려는 것이다 (처음 요구사항: "DB 는 배포랑 개발이 공유").

통합 리뷰(2026-10-04)에서 이 구조의 위험이 확인됐다. 저장소는 문서 전체를 저장할 때와 다른 프로세스가 바꾼 문서를 읽을 때 코드의 검증 규칙으로 검사한다.

- `src/lib/operations.ts` 의 `validateOperationsData` (배치·관측·안내·응답의 허용 값과 필드)
- `server/workspace.ts` 의 `validDatabase`, `validSiteInput` (계정·덕장·소속·초대·세션)

dev 는 `/srv/haepung/dev` 의 코드를 바로 띄우므로 prod 보다 새 규칙을 먼저 가진다. dev 가 새 규칙에서만 허용되는 값(예: 새 생선 종류, 새 기록 종류)을 저장하면, prod 는 다음 읽기에서 그 문서를 옛 규칙으로 검사해 `INVALID_DOCUMENT` 로 실패한다. 그 뒤로 prod 의 로그인·덕장·기록 API 가 모두 500, `/api/health` 가 503 이 된다. 문서의 `schema` 번호는 그대로라 `SCHEMA_TOO_NEW` 보호가 잡지 못하고, 배포 스크립트의 자동 되돌리기도 데이터 문제라서 소용이 없다.

## 결정

공유를 유지한다. 대신 저장 검증 규칙을 바꾸는 작업은 아래 순서를 지킨다.

1. 규칙을 **넓히는** 변경(새 값·새 선택 필드 허용)은 PR 을 머지한 직후 prod 배포(`sudo haepung-deploy`)까지 한 번에 한다. prod 배포가 끝나기 전에는 dev 화면에서 새 값을 저장하지 않는다.
2. 규칙을 **좁히는** 변경(값 제거, 필드를 필수로)은 이미 저장된 데이터가 새 규칙에 맞아야 하므로 백엔드 담당과 먼저 정한다. 지금 저장소에는 형식 변환(migration) 기능이 없다.
3. `/srv/haepung/dev` 폴더에서 머지 전 코드를 고쳐 띄우지 않는다. 개인 작업은 `/srv/haepung/work/$USER/<이름>` worktree 에서 한다 ([infra/gcp/README.md](../../infra/gcp/README.md)).

prod 가 이미 멈췄다면 (`/api/health` 가 503 `INVALID_DOCUMENT`):

- 새 규칙이 main 에 머지돼 있으면 `sudo haepung-deploy` 로 prod 에 배포한다. 데이터 손실이 없다.
- 머지되지 않은 규칙이면 dev 화면에서 새 값을 쓴 기록을 지우거나 고쳐 prod 규칙에 맞춘다.
- 둘 다 안 되면 마지막 백업으로 복원한다 (그 뒤의 기록은 잃는다).

## 검토한 대안

- **dev 는 복사본 DB (`dev.db`) 를 쓰고 필요할 때 prod 에서 복사**: prod 가 dev 실험에서 안전해진다. 그러나 dev 에서 만든 계정·기록이 prod 에 보이지 않아 팀이 원한 확인 방식과 맞지 않는다. 복사 스크립트(`scripts/copy-prod-to-dev.ts`)는 남겨 두어 나중에 바꾸기 쉽다.
- **검증 규칙의 해시를 형식 번호로 쓰기**: 규칙 파일을 고칠 때마다 번호가 바뀌어 dev 저장이 자주 막힌다. 번호의 앞뒤를 정할 수 없어 지금의 `SCHEMA_TOO_NEW` 보호와도 맞지 않는다.

## 결과

- 팀원(과 팀원의 Claude Code)이 위 순서를 알도록 [CLAUDE.md](../../CLAUDE.md) 작업 규칙에 한 줄로 링크한다.
- 위험은 남는다. 순서를 어기면 prod 가 멈출 수 있고, 복구는 위 세 가지 중 하나다.
