import { Audio } from "@remotion/media";
import type React from "react";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { ColdOpen, Problem, Statement } from "./scenes/Dark";
import { Insight, Now, Record } from "./scenes/Desk";
import { Exchange } from "./scenes/Exchange";
import { End, Intro } from "./scenes/Light";
import { from, length, SCENES } from "./timeline";
import { COLOR } from "./theme";

// 해풍 IR 소개 영상 2판 (78초). 장면 시각은 timeline.ts, 계획은 PLAN.md.

const PARTS: Array<[keyof typeof SCENES, string, React.FC]> = [
  ["coldOpen", "1 여는 말", ColdOpen],
  ["problem", "2 문제", Problem],
  ["intro", "3 해풍과 앱 전체", Intro],
  ["record", "4 말하면 기록", Record],
  ["now", "5 지금 판단", Now],
  ["exchange", "6 운영자와 근로자", Exchange],
  ["insight", "7 예보와 과거 분석", Insight],
  ["statement", "8 한 줄 정리", Statement],
  ["end", "9 맺음", End],
];

export const HaepungIntro: React.FC = () => (
  <AbsoluteFill style={{ background: COLOR.night }}>
    {PARTS.map(([key, name, Scene]) => (
      <Sequence key={key} name={name} from={from(key)} durationInFrames={length(key)} premountFor={30}>
        <Scene />
      </Sequence>
    ))}
    <Audio src={staticFile("audio/music.wav")} volume={0.8} />
  </AbsoluteFill>
);
