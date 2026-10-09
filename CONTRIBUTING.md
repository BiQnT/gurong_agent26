# 팀 작업 방식

2026 디지털 트윈 구룡포 AI 해커톤 팀 브레멘의 작업 규칙입니다. 제품 소개와 실행 방법은 [README](README.md)에 있습니다.

- **팀 노션:** https://app.notion.com/p/183d9a77d21882288fe501ad8fc2397d
- **처음 왔다면:** [🚀 온보딩](https://app.notion.com/p/3a9d9a77d2188142b8a7d270c4299160). 1일차 체크리스트와 문서 지도
- **AI 에이전트로 작업한다면:** [CLAUDE.md](CLAUDE.md)의 규칙을 함께 따릅니다.

일정, 담당자, 진행 상황은 노션 프로젝트 트래커가 정본입니다. 저장소에 진행 상황 표를 만들지 않습니다.

## 대회 요건

1. 생성형 AI(LLM)로 자연어 입력을 이해하고 응답한다.
2. 디지털 트윈 데이터·API 를 **최소 1개 이상 실제로 호출해 활용**한다. 더미 데이터는 안 된다.
3. 단순 질의응답이 아니라 **판단·추천·경보·시각화** 같은 문제 해결형 동작을 한다.

## 디렉토리

```
src/, server/  해풍 웹앱 (README 의 "구조" 참고)
ideas/         아이디어 하나 = 폴더 하나 = 브랜치 하나 (ideas/README.md 참고)
  _template/   복사해서 쓰는 템플릿
docs/
  decisions/   결정 기록 (ADR). 한 결정 = 한 파일, 고치지 않고 쌓는다
  design/      파이프라인·아키텍처·API 계약
  api-catalog/ E-UM Open API 전체 카탈로그 (요청·응답 필드 포함)
  assets/      README 이미지
  대회자료/    주최 측 제공 원본 (안내 PDF, 신청서 양식)
data/
  eum-api-catalog.json   위 카탈로그의 기계 판독용 원본
research/
  api-tests/   API 호출 테스트 기록과 카탈로그 수집 스크립트
scripts/       아이디어 브랜치 생성, 운영 관리 스크립트
infra/gcp/     GCP VM 셋업·배포 스크립트와 운영 문서
media/         발표용 영상 (Remotion)
```

## 아이디어 관리

아이디어는 각자 브랜치를 파서 `ideas/` 아래에 정리합니다. 문서든 코드든 데이터 조사든 한 폴더에 모읍니다.

```bash
scripts/new-idea.sh breakwater-guard "방파제 보행자 위험 경보 에이전트"
```

`main` 에서 `idea/NNN-<slug>` 브랜치를 파고 `ideas/NNN-<slug>/` 에 템플릿을 복사합니다. 아이디어 브랜치에서는 그 폴더만 고칩니다. 자세한 규칙은 [ideas/README.md](ideas/README.md).

## 문서를 어디에 쓰나

**"이걸 PR 에서 리뷰받아야 하나?"** 그렇다면 저장소, 아니면 노션입니다.

- **노션:** 진행 상황 트래커, 회의록, 제출 서류 체크리스트, 팀원 정보
- **저장소:** 결정([ADR](docs/decisions/)), 설계, API 스펙, 아이디어, 코드

한 사실은 한 곳에만 둡니다. 두 번째 위치에는 링크만 남깁니다. 전체 규칙은 [ADR 0001](docs/decisions/0001-context-management.md).

## E-UM API 키

- E-UM Open API: [카탈로그 문서](docs/api-catalog/README.md)
- E-UM 디지털트윈 포항: https://pohang-eum.kr/data
- 공공데이터포털: https://www.data.go.kr/

모든 E-UM API 에 `serviceKey`(개인 발급 인증키)가 필요합니다. E-UM 에 로그인해 API 자료실에서 신청하고, 받은 키를 `.env.example` 을 복사한 `.env.local` 에 넣습니다.

카탈로그 갱신: `python3 research/api-tests/fetch_eum_catalog.py`

## 개발 규칙

- `main` 에 직접 푸시하지 않습니다. 브랜치를 만들고 PR 로 합칩니다.
- 비밀키는 커밋하지 않습니다. `.env.example` 에는 이름만 두고 실제 값은 각자 `.env.local` 에 둡니다.
- 팀원 개인정보(생년월일, 연락처, 서명)는 커밋하지 않습니다.
- API 호출에 성공하면 `research/api-tests/` 에 요청·응답 샘플을 남깁니다. 기획서에 그대로 인용할 수 있어야 합니다.
- 호출 성공을 확인하지 않은 API 는 기획서나 코드에 넣지 않습니다.
- VM 의 dev·prod 는 DB 하나를 같이 씁니다. 저장 검증 규칙을 바꾸면 [ADR 0006](docs/decisions/0006-shared-db-validation-order.md)의 순서를 따릅니다.

## 대회 문의처

포스텍 미래도시연구센터 권소현 · ikwon@postech.ac.kr · 054-279-9154 (평일 9:00-18:00)
