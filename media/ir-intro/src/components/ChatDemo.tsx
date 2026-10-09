import { Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE } from "../theme";
import { Bubble } from "./Bubble";

export type Shot = { file: string; width: number; height: number };

/**
 * 창 안에서 질문을 치고, 실제 답 화면(스크린샷)이 올라온 뒤 천천히 아래로 훑는다.
 * shots 의 width·height 는 원본 픽셀(2배)이다.
 */
export const ChatDemo: React.FC<{
  question: string;
  shots: Shot[];
  viewWidth: number;
  viewHeight: number;
  answerAt: number;
  scrollFrom: number;
  scrollTo: number;
}> = ({ question, shots, viewWidth, viewHeight, answerAt, scrollFrom, scrollTo }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pad = 44;
  const imageWidth = viewWidth - pad * 2;
  const bubbleHeight = 96;
  const gap = 28;
  const contentHeight =
    pad + bubbleHeight + gap + shots.reduce((sum, shot) => sum + (shot.height * imageWidth) / shot.width + 12, 0) + pad;
  const travel = Math.max(0, contentHeight - viewHeight);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: viewWidth,
        padding: pad,
        display: "flex",
        flexDirection: "column",
        gap,
        translate: interpolate(frame, [scrollFrom * fps, scrollTo * fps], ["0px 0px", `0px ${-travel}px`], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.inOut(Easing.cubic),
        }),
      }}
    >
      <div style={{ height: bubbleHeight }}>
        <Bubble text={question} at={0.8} duration={Math.min(1.8, 0.4 + question.length * 0.07)} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          opacity: interpolate(frame, [answerAt * fps, (answerAt + 0.6) * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [answerAt * fps, (answerAt + 1) * fps], ["0px 50px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(...EASE),
          }),
        }}
      >
        {shots.map((shot) => (
          <Img
            key={shot.file}
            src={staticFile(`shots/${shot.file}`)}
            style={{ width: imageWidth, height: (shot.height * imageWidth) / shot.width, display: "block" }}
          />
        ))}
      </div>
    </div>
  );
};
