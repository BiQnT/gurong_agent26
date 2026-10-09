import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOR, FONT } from "../theme";

/** 운영자가 묻는 말풍선. 글자가 차례로 쳐진다 (앱의 오른쪽 회색 말풍선과 같은 모양). */
export const Bubble: React.FC<{ text: string; at: number; duration?: number; size?: number }> = ({
  text,
  at,
  duration = 1.6,
  size = 30,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shown = Math.floor(
    interpolate(frame, [at * fps, (at + duration) * fps], [0, text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const visible = frame >= at * fps;
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", opacity: visible ? 1 : 0 }}>
      <div
        style={{
          background: "#F2F1EE",
          color: "#404040",
          borderRadius: "26px 26px 6px 26px",
          padding: "20px 30px",
          fontFamily: FONT.sans,
          fontSize: size,
          lineHeight: 1.4,
          minWidth: 80,
        }}
      >
        {text.slice(0, shown)}
        <span
          style={{
            display: "inline-block",
            width: 3,
            height: size,
            marginLeft: 4,
            verticalAlign: "middle",
            background: COLOR.ink,
            opacity: shown < text.length && Math.floor(frame / 8) % 2 === 0 ? 1 : 0,
          }}
        />
      </div>
    </div>
  );
};
