# 해풍 IR 소개 영상 (Remotion)

본선 발표 맨 앞에 트는 약 75초 소개 영상. 계획과 장면 구성은 [PLAN.md](PLAN.md)(2026-10-09)를 따랐고, 화면은 배포한 main(`6ecbce1`)과 같은 코드를 로컬에서 따로 만든 DB 로 띄워 실제 E-UM·기상청·claude 답으로 찍었다 (prod DB 에 시연 자료를 넣지 않으려고).

## 보기·만들기

```bash
cd media/ir-intro
npm i
npx remotion studio                                   # 미리 보기 (장면별 타임라인 수정 가능)
npx remotion render HaepungIntro out/haepung-intro.mp4 # MP4 (1920×1080, 30fps)
```

## 구성

| 파일 | 내용 |
| --- | --- |
| `src/HaepungIntro.tsx` | 장면 10개를 0.5초 페이드로 잇는 전체 영상 |
| `src/scenes/*.tsx` | 여는 말, 제품 이름, 문제, AI 도우미(지금·예보·과거 분석), 건조 기록, 관리자와 근로자, 신뢰, 맺음 |
| `src/components/` | 창·폰 틀, 질문 말풍선(타이핑), 실제 화면을 잘라 확대하는 `CrossShot`, 물결선, 로고(앱과 같은 SVG) |
| `public/shots/` | 실제 앱 화면 (데스크톱 1440×900 · 폰 390×844, 2·3배) |

화면 속 숫자와 답은 찍은 날(2026-10-09, 가을이라 대부분 부적합)의 실제 값이다. 영상에서 숫자를 새로 만들어 넣지 않는다.
