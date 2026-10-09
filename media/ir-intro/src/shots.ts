import { staticFile } from "remotion";

// 실제 앱 화면 (배포한 main 과 같은 코드, 로컬 시연 DB, 실제 E-UM·기상청·claude 응답).
// 데스크톱 1440×900 (2배), 휴대폰 390×844 (3배). 아래 좌표는 모두 화면의 CSS px 이고
// 찍을 때 Playwright 로 잰 요소 위치와, 입력칸 안 글자 범위를 픽셀로 잰 값이다.

export const DESK = { w: 1440, h: 900, scale: 2 };
export const PHONE = { w: 390, h: 844, scale: 3 };

export const shot = (name: string) => staticFile(`shots/${name}.png`);

export type Rect = { x: number; y: number; w: number; h: number };

/** 입력칸 하나: 지울 자리(cover, 자리 표시 글자까지)와 입력한 글자 범위(text) */
export type Field = { cover: Rect; text: Rect; background: string };

const composer = (textEnd: number): Field => ({
  cover: { x: 473, y: 769, w: 200, h: 19 },
  text: { x: 474.5, y: 769, w: textEnd - 474.5, h: 19 },
  background: "#ffffff",
});

export const FIELD = {
  record: composer(608),
  now: composer(628.5),
  tomorrow: composer(554),
  history: composer(661),
  batchName: { cover: { x: 503, y: 284, w: 106, h: 21 }, text: { x: 505, y: 284, w: 81, h: 21 }, background: "#ffffff" },
  answer: { cover: { x: 655, y: 551, w: 300, h: 22 }, text: { x: 656, y: 551, w: 291, h: 22 }, background: "#fafbfc" },
  question: { cover: { x: 48, y: 574, w: 272, h: 52 }, text: { x: 49, y: 574, w: 152, h: 24 }, background: "#fafbfc" },
} satisfies Record<string, Field>;

/** 누르는 곳과 비추는 곳 */
export const SPOT = {
  composer: { x: 849, y: 780 },
  send: { x: 1210, y: 828 },
  sidebar: [0, 1, 2, 3].map((i) => ({ x: 17, y: 208 + i * 48, w: 223, h: 44 })),
  startAction: { x: 557, y: 332 },
  batchNameInput: { x: 640, y: 294 },
  approveBatch: { x: 880, y: 717 },
  batchCard: { x: 338, y: 253, w: 1022, h: 484 },
  nowHeadline: { x: 490, y: 130, w: 718, h: 190 },
  nowReasons: { x: 490, y: 350, w: 718, h: 175 },
  nowText: { x: 470, y: 655, w: 758, h: 64 },
  guideDraft: { x: 485, y: 392, w: 470, h: 106 },
  approveGuide: { x: 866, y: 739 },
  guidePreview: { x: 590, y: 543, w: 771, h: 357 },
  ownerQuestion: { x: 632, y: 444, w: 644, h: 56 },
  answerInput: { x: 950, y: 585 },
  answerSend: { x: 1209, y: 665 },
  ownerAnswer: { x: 632, y: 578, w: 644, h: 112 },
  workerGuide: { x: 30, y: 196, w: 330, h: 116 },
  workerRead: { x: 113, y: 456 },
  workerQuestionInput: { x: 195, y: 600 },
  workerSend: { x: 296, y: 663 },
  workerThread: { x: 50, y: 462, w: 314, h: 198 },
  forecastBars: { x: 590, y: 220, w: 607, h: 110 },
  forecastCard: { x: 490, y: 128, w: 718, h: 300 },
  historyRows: { x: 560, y: 345, w: 640, h: 560 },
  historySummary: { x: 490, y: 160, w: 718, h: 150 },
};
