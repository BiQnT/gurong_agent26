import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { useVideoConfig } from "remotion";
import { AskNow } from "./scenes/AskNow";
import { Closing } from "./scenes/Closing";
import { History } from "./scenes/History";
import { Opening } from "./scenes/Opening";
import { Problem } from "./scenes/Problem";
import { Record } from "./scenes/Record";
import { Team } from "./scenes/Team";
import { Title } from "./scenes/Title";
import { Tomorrow } from "./scenes/Tomorrow";
import { Trust } from "./scenes/Trust";

// 해풍 IR 소개 영상 (약 75초). 장면 사이는 0.5초 페이드라 전체 길이는 장면 합에서 9 × 15프레임을 뺀다.
// 계획: .omc/plans/2026-10-09-ir-intro-video.md

export const INTRO_DURATION = 180 + 150 + 210 + 360 + 270 + 270 + 210 + 360 + 210 + 180 - 9 * 15;

export const HaepungIntro: React.FC = () => {
  const { fps } = useVideoConfig();
  const cut = <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />;
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="1 여는 말" durationInFrames={180} premountFor={fps}>
        <Opening />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="2 제품 이름" durationInFrames={150} premountFor={fps}>
        <Title />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="3 문제" durationInFrames={210} premountFor={fps}>
        <Problem />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="4 지금" durationInFrames={360} premountFor={fps}>
        <AskNow />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="5 예보" durationInFrames={270} premountFor={fps}>
        <Tomorrow />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="6 과거 분석" durationInFrames={270} premountFor={fps}>
        <History />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="7 건조 기록" durationInFrames={210} premountFor={fps}>
        <Record />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="8 관리자와 근로자" durationInFrames={360} premountFor={fps}>
        <Team />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="9 신뢰" durationInFrames={210} premountFor={fps}>
        <Trust />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence name="10 맺음" durationInFrames={180} premountFor={fps}>
        <Closing />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
