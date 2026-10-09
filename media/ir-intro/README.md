# 해풍 IR 소개 영상 (Remotion)

본선 발표 맨 앞에 트는 약 87초 소개 영상 (2판, 0.9배 속도). 계획과 1판 평가 반영은 [PLAN.md](PLAN.md)(2026-10-09)를 따랐고, 화면은 배포한 main(`6ecbce1`)과 같은 코드를 로컬에서 따로 만든 DB 로 띄워 실제 E-UM·기상청·claude 답으로 찍었다 (prod DB 에 시연 자료를 넣지 않으려고).

## 보기·만들기

```bash
cd media/ir-intro
npm i
node scripts/make-audio.mjs                           # 음악·효과음 합성 (public/audio, 한 번만)
npx remotion studio                                   # 미리 보기
npx remotion render HaepungIntro out/haepung-intro.mp4 # MP4 (1920×1080, 30fps, 소리 포함)
node scripts/stills.mjs 600 1200                      # 확인용 정지 화면 (out/stills)
```

## 구성

| 파일 | 내용 |
| --- | --- |
| `src/timeline.ts` | 장면 시각. 장면 안 시각은 설계 프레임(30fps)으로 적고 `SPEED`(0.9)로 늦춰 튼다. 음악 박자 격자(90BPM, 화음 하나 약 5.3초)에 맞췄다 |
| `src/HaepungIntro.tsx` | 장면 9개와 음악 |
| `src/scenes/` | `Dark` 여는 말·문제·한 줄 정리, `Light` 로고·앱 전체·맺음, `Desk` 말하면 기록·지금 판단·예보와 과거, `Exchange` 운영자와 근로자 |
| `src/components/` | 카메라(`Stage`), 화면 상태 전환(`AppScreen`), 커서·탭, 타이핑·강조·막대 걷어 내기, 장 제목, 날아가는 칩, 바람 줄기, 로고(앱과 같은 SVG), 효과음 |
| `src/shots.ts` | 화면 안 좌표 (찍을 때 잰 요소 위치와 입력칸 글자 범위, CSS px) |
| `public/shots/` | 실제 앱 화면 상태 27장 (데스크톱 1440×900 · 폰 390×844, 2·3배) |
| `public/audio/`, `scripts/make-audio.mjs` | 직접 합성한 음악·효과음 |

화면 속 숫자와 답은 찍은 날(2026-10-09, 가을이라 대부분 부적합)의 실제 값이다. 영상에서 숫자를 새로 만들어 넣지 않는다.
