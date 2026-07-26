# 2026 디지털 트윈 구룡포 AI 해커톤

포항시 구룡포 디지털 트윈 데이터를 활용한 AI Agent 개발 프로젝트.

- **팀명**: (미정)
- **프로젝트명**: (미정)
- **팀 노션**: https://www.notion.so/3726333509038301b90d0183ba492277

## 핵심 일정

| 단계 | 기간 |
| --- | --- |
| 신청서 접수 | ~ 2026-08-30 (팀 목표: **08-29**) |
| 서면평가 / 본선팀 발표 | 09-04 / 09-07 |
| 서비스 디벨롭 + 멘토링 | 09-07 ~ 09-28 |
| 해커톤 본선 | 09-29 |

## 반드시 지켜야 할 3가지 요건

1. 생성형 AI(LLM)로 자연어 입력을 이해·응답
2. 디지털 트윈 데이터/API를 **최소 1개 이상 실제 호출·활용** (더미 데이터 불가)
3. 단순 질의응답이 아닌 **판단·추천·경보·시각화** 등 문제 해결형 동작

## 디렉토리 구조

```
ideas/         아이디어 하나 = 폴더 하나 = 브랜치 하나 (ideas/README.md 참고)
  _template/   복사해서 쓰는 템플릿
docs/
  api-catalog/ E-UM Open API 전체 카탈로그 (40개, 요청·응답 필드 포함)
  대회자료/    주최 측 제공 원본 (안내 PDF, 신청서 양식 hwp/docx)
  회의록/      회의록 마크다운 (노션과 이중화가 싫으면 노션만 써도 됨)
data/
  eum-api-catalog.json   위 카탈로그의 기계 판독용 원본
research/
  api-tests/   API 호출 테스트 기록 + 카탈로그 수집 스크립트
scripts/
  new-idea.sh  아이디어 브랜치 + 폴더 생성
prototype/     확정된 아이디어의 AI Agent 프로토타입 코드
```

## 아이디어 관리

아이디어는 각자 브랜치를 파서 `ideas/` 아래에 정리한다. 문서든 코드든 데이터 조사든 한 폴더에 모은다.

```bash
scripts/new-idea.sh breakwater-guard "방파제 보행자 위험 경보 에이전트"
```

`main`에서 `idea/NNN-<slug>` 브랜치를 파고 `ideas/NNN-<slug>/`에 템플릿을 복사한다.
자세한 규칙은 [ideas/README.md](ideas/README.md).

## 데이터 소스

- **E-UM Open API — [카탈로그 문서](docs/api-catalog/README.md) (40개 API / 7개 서비스)**
- E-UM 디지털트윈 포항: https://pohang-eum.kr/data
- 공공데이터포털: https://www.data.go.kr/

전 API에 `serviceKey`(개인 발급 인증키)가 필수다. `.env.example`을 복사해 `.env`를 만들고
E-UM 로그인 후 API 자료실에서 신청해 받은 키를 넣는다.

카탈로그 갱신: `python3 research/api-tests/fetch_eum_catalog.py`

## 개발 규칙

- `main` 직접 푸시 금지. `feat/`, `docs/` 브랜치 + PR
- 비밀키는 절대 커밋하지 않는다. `.env.example`만 커밋하고 실제 값은 각자 `.env`
- API 호출 성공 사례는 `research/api-tests/`에 요청·응답 샘플을 남긴다 (기획서에 그대로 인용)

## 문의처

포스텍 미래도시연구센터 권소현 · ikwon@postech.ac.kr · 054-279-9154 (평일 9:00-18:00)
