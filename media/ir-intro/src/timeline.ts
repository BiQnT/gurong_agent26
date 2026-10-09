// 장면 시각 (초). 음악(scripts/make-audio.mjs)이 100BPM, 화음 하나 4.8초라 장면 경계를 그 격자에 맞췄다.
// 14.4초 로고와 함께 본편 박자가 들어오고, 67.2초부터 쉬었다가 72초 마지막 화음에서 끝 장면이 열린다.

export const FPS = 30;

/** 초 → 프레임 */
export const sec = (seconds: number) => Math.round(seconds * FPS);

export const SCENES = {
  coldOpen: [0, 8],
  problem: [8, 14.4],
  intro: [14.4, 24],
  record: [24, 33.6],
  now: [33.6, 42],
  exchange: [42, 57.6],
  insight: [57.6, 67.2],
  statement: [67.2, 72],
  end: [72, 78],
} as const;

export const TOTAL = sec(78);

export const from = (scene: keyof typeof SCENES) => sec(SCENES[scene][0]);
export const length = (scene: keyof typeof SCENES) => sec(SCENES[scene][1]) - sec(SCENES[scene][0]);
