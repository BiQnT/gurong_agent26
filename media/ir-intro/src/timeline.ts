import { useCurrentFrame } from "remotion";

// 장면 안의 시각은 모두 "설계 프레임"(30fps 기준, 1초 = 30)으로 적었다.
// 2판 평가에서 조금 늦춰 달라고 해서(0.8배는 너무 느려 0.9배), 실제 영상은 설계 프레임을 SPEED 로 나눈 만큼 길다
// (78초 → 약 86.7초). 음악(scripts/make-audio.mjs, 3판)은 135BPM 이라 화음 하나(실제 약 5.3초)가 3마디로 떨어져 박자가 맞는다.

export const FPS = 30;
export const SPEED = 0.9;

/** 설계 초 → 설계 프레임 */
export const sec = (seconds: number) => Math.round(seconds * FPS);

/** 설계 프레임 → 실제 영상 프레임 (Sequence 의 from·길이에 쓴다) */
export const real = (designFrames: number) => Math.round(designFrames / SPEED);

/** 지금의 설계 프레임. 장면과 부품은 useCurrentFrame 대신 이것을 쓴다. */
export const useFrame = () => useCurrentFrame() * SPEED;

// 설계 초. 음악 격자(화음 하나 4.8 설계 초 = 실제 약 5.3초)에 맞췄다.
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

type Scene = keyof typeof SCENES;

/** 장면이 시작하는 실제 프레임 */
export const from = (scene: Scene) => real(sec(SCENES[scene][0]));
/** 장면 길이 (실제 프레임) */
export const length = (scene: Scene) => real(sec(SCENES[scene][1])) - real(sec(SCENES[scene][0]));

export const TOTAL = real(sec(78));
