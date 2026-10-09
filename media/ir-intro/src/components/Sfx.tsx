import { Audio } from "@remotion/media";
import type React from "react";
import { Sequence, staticFile } from "remotion";
import { real } from "../timeline";

/** 음악과의 균형: 장면마다 적은 음량에 한꺼번에 곱한다 */
const GAIN = 1.3;

export type SfxName = "click" | "key" | "whoosh" | "send" | "chime" | "tap" | "typing" | "receive";

/** 효과음 하나 (scripts/make-audio.mjs 로 합성한 소리). at·length 는 설계 프레임, length 를 주면 그만큼만 튼다. */
export const Sfx: React.FC<{ at: number; name: SfxName; volume?: number; length?: number }> = ({
  at,
  name,
  volume = 0.5,
  length = 60,
}) => (
  <Sequence from={real(at)} durationInFrames={real(length)} layout="none" name={`소리 ${name}`}>
    <Audio src={staticFile(`audio/${name}.wav`)} volume={Math.min(1, volume * GAIN)} />
  </Sequence>
);
