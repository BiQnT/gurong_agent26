import { Easing, interpolate } from "remotion";

export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 구간 [a, b] 에서 0 → 1 (기본: 부드럽게 멈춤) */
export const progress = (frame: number, a: number, b: number, easing = easeOut) =>
  interpolate(frame, [a, b], [0, 1], { ...clamp, easing });

/** 나타났다 사라지는 값: [a, b] 에서 켜지고 [c, d] 에서 꺼진다 */
export const window01 = (frame: number, a: number, b: number, c: number, d: number) =>
  Math.min(progress(frame, a, b), 1 - progress(frame, c, d, easeInOut));

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * 숫자 묶음을 시간에 따라 옮긴다. 각 이동은 [시작, 끝, 목표] 이고, 이동 사이에는 그대로 머문다.
 * 카메라(x, y, z), 커서(x, y), 배치 비율 같은 것에 쓴다.
 */
export function track<T extends Record<string, number>>(
  frame: number,
  start: T,
  moves: ReadonlyArray<readonly [number, number, Partial<T>]>,
  easing = easeInOut,
): T {
  let pose = start;
  for (const [a, b, target] of moves) {
    const next = { ...pose, ...target } as T;
    if (frame >= b) {
      pose = next;
      continue;
    }
    if (frame <= a) return pose;
    const t = easing((frame - a) / (b - a));
    const out = { ...pose };
    for (const key of Object.keys(next) as Array<keyof T>) {
      (out[key] as number) = mix(pose[key], next[key], t);
    }
    return out;
  }
  return pose;
}
