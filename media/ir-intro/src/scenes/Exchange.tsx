import type React from "react";
import { AbsoluteFill } from "remotion";
import { useFrame } from "../timeline";
import { Chapter } from "../components/Chapter";
import { Spotlight, Typing } from "../components/Overlays";
import { Packet } from "../components/Packet";
import { Cursor, Taps } from "../components/Pointer";
import { Sfx } from "../components/Sfx";
import { AppScreen, Stage, type Pose } from "../components/Stage";
import { mix, progress, track } from "../motion";
import { DESK, FIELD, PHONE, SPOT } from "../shots";
import { COLOR, FONT } from "../theme";

// 설계 42~57.6초: 운영자(데스크톱, 한국어)와 근로자(휴대폰, 베트남어)가 안내·질문·답변을 주고받는다.
// 받는 쪽 화면이 커지고, 주고받는 내용은 칩이 되어 두 화면 사이를 날아간다.

const BEZEL = 12;
const GAP = 100;
const CENTER_Y = 566;

/** focus 0 이면 운영자 화면이, 1 이면 근로자 휴대폰이 크다 */
function layout(focus: number) {
  const ownerScale = mix(0.84, 0.64, focus);
  const phoneScale = mix(0.8, 1, focus);
  const ownerW = DESK.w * ownerScale;
  const ownerH = DESK.h * ownerScale;
  const phoneW = PHONE.w * phoneScale + BEZEL * 2;
  const phoneH = PHONE.h * phoneScale + BEZEL * 2;
  const left = (1920 - (ownerW + GAP + phoneW)) / 2;
  return {
    owner: { x: left, y: CENTER_Y - ownerH / 2, w: ownerW, h: ownerH, scale: ownerScale },
    phone: { x: left + ownerW + GAP, y: CENTER_Y - phoneH / 2, w: phoneW, h: phoneH, scale: phoneScale },
  };
}

/** 운영자 화면 안 카메라가 화면 밖을 비추지 않게 */
function clampPose(pose: Pose): Pose {
  const halfW = DESK.w / 2 / pose.z;
  const halfH = DESK.h / 2 / pose.z;
  return {
    x: Math.min(DESK.w - halfW, Math.max(halfW, pose.x)),
    y: Math.min(DESK.h - halfH, Math.max(halfH, pose.y)),
    z: pose.z,
  };
}

const Label: React.FC<{ x: number; y: number; role: string; language: string }> = ({ x, y, role, language }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y - 52,
      display: "flex",
      alignItems: "baseline",
      gap: 12,
      fontFamily: FONT.sans,
      whiteSpace: "nowrap",
    }}
  >
    <span style={{ fontSize: 28, fontWeight: 700, color: COLOR.ink }}>{role}</span>
    <span style={{ fontSize: 24, fontWeight: 500, color: COLOR.muted }}>{language}</span>
  </div>
);

export const Exchange: React.FC = () => {
  const frame = useFrame();
  const focus = track(frame, { f: 0 }, [
    [96, 126, { f: 1 }],
    [226, 256, { f: 0 }],
    [372, 402, { f: 1 }],
    [420, 452, { f: 0.45 }],
  ]).f;
  const { owner, phone } = layout(focus);
  const enter = progress(frame, 0, 26);
  const inner = clampPose(
    track(frame, { x: 720, y: 450, z: 1 }, [
      [36, 56, { x: 720, y: 445, z: 1.55 }],
      [84, 100, { x: 975, y: 620, z: 1.3 }],
      [244, 262, { x: 950, y: 545, z: 1.45 }],
      [420, 452, { x: 950, y: 560, z: 1.3 }],
    ]),
  );
  const ownerPose = { ...inner, z: inner.z * owner.scale };

  // 세계 좌표 → 화면 좌표 (칩이 날아갈 자리)
  const ownerPoint = (x: number, y: number) => ({
    x: owner.x + owner.w / 2 + (x - ownerPose.x) * ownerPose.z,
    y: owner.y + owner.h / 2 + (y - ownerPose.y) * ownerPose.z,
  });
  const phonePoint = (x: number, y: number) => ({
    x: phone.x + BEZEL + x * phone.scale,
    y: phone.y + BEZEL + y * phone.scale,
  });

  return (
    <AbsoluteFill style={{ background: COLOR.paper }}>
      <Chapter title="현장에, 바로." out={36} enterBlur={false}>
        <AbsoluteFill style={{ background: COLOR.paper }}>
          <div style={{ position: "absolute", inset: 0, transform: `translateX(${(1 - enter) * -60}px)` }}>
            <Label x={owner.x} y={owner.y} role="운영자" language="한국어" />
            <div
              style={{
                position: "absolute",
                left: owner.x,
                top: owner.y,
                width: owner.w,
                height: owner.h,
                borderRadius: 14,
                boxShadow: "0 40px 100px rgba(27,27,25,0.16), 0 0 0 1px rgba(27,27,25,0.08)",
              }}
            >
              <Stage width={owner.w} height={owner.h} pose={ownerPose} style={{ borderRadius: 14, background: "#fff" }}>
                <AppScreen
                  width={DESK.w}
                  height={DESK.h}
                  radius={0}
                  shadow={false}
                  states={[
                    [0, "o1-dialog"],
                    [84, "o2-approved", 6],
                    [248, "o3-question", 6],
                    [346, "o4-typed", 2],
                    [364, "o5-answered", 5],
                  ]}
                >
                  <Typing field={FIELD.answer} typed="o4-typed" imageSize={DESK} chars={31} show={298} start={300} end={344} until={346} />
                  <Spotlight rect={SPOT.guideDraft} show={40} hide={84} />
                  <Spotlight rect={SPOT.guidePreview} show={90} hide={132} />
                  <Spotlight rect={SPOT.ownerQuestion} show={252} hide={296} />
                  <Spotlight rect={SPOT.ownerAnswer} show={370} hide={500} />
                </AppScreen>
                <Cursor
                  show={[56, 372]}
                  start={{ x: 1100, y: 830 }}
                  moves={[
                    [58, 78, SPOT.approveGuide],
                    [282, 296, SPOT.answerInput],
                    [348, 358, SPOT.answerSend],
                  ]}
                  clicks={[82, 298, 360]}
                />
              </Stage>
            </div>
          </div>
          <div style={{ position: "absolute", inset: 0, transform: `translateX(${(1 - enter) * 60}px)` }}>
            <Label x={phone.x + 8} y={phone.y} role="근로자" language="Tiếng Việt" />
            <div
              style={{
                position: "absolute",
                left: phone.x,
                top: phone.y,
                width: phone.w,
                height: phone.h,
                borderRadius: 40 * phone.scale + BEZEL,
                background: COLOR.ink,
                padding: BEZEL,
                boxShadow: "0 40px 100px rgba(27,27,25,0.24)",
              }}
            >
              <Stage
                width={phone.w - BEZEL * 2}
                height={phone.h - BEZEL * 2}
                pose={{ x: PHONE.w / 2, y: PHONE.h / 2, z: phone.scale }}
                style={{ borderRadius: 40 * phone.scale, background: "#fff" }}
              >
                <AppScreen
                  width={PHONE.w}
                  height={PHONE.h}
                  radius={0}
                  shadow={false}
                  states={[
                    [0, "w0-waiting"],
                    [118, "w1-received", 6],
                    [152, "w1b-read", 4],
                    [208, "w2-typed", 2],
                    [216, "w3-sent", 4],
                    [398, "w4-answer", 6],
                  ]}
                >
                  <Typing field={FIELD.question} typed="w2-typed" imageSize={PHONE} chars={21} show={168} start={172} end={206} until={208} />
                  <Spotlight rect={SPOT.workerGuide} show={122} hide={148} radius={12} />
                  <Spotlight rect={SPOT.workerThread} show={402} hide={500} radius={12} />
                </AppScreen>
                <Taps
                  taps={[
                    { at: 150, ...SPOT.workerRead },
                    { at: 168, ...SPOT.workerQuestionInput },
                    { at: 214, ...SPOT.workerSend },
                  ]}
                />
              </Stage>
            </div>
          </div>
          <Packet
            start={86}
            end={118}
            from={ownerPoint(975, 640)}
            to={phonePoint(195, 236)}
            label="과메기 회수"
            labelTo="Thu cá trên giàn phơi"
            icon="guide"
          />
          <Packet
            start={218}
            end={248}
            from={phonePoint(200, 606)}
            to={ownerPoint(900, 472)}
            label="Mấy giờ thì thu cá ạ?"
            icon="question"
          />
          <Packet
            start={366}
            end={398}
            from={ownerPoint(900, 630)}
            to={phonePoint(200, 615)}
            label="오후 4시에 회수해요."
            icon="answer"
          />
        </AbsoluteFill>
      </Chapter>
      <Sfx at={82} name="click" volume={0.5} />
      <Sfx at={86} name="send" volume={0.32} />
      <Sfx at={118} name="chime" volume={0.3} />
      <Sfx at={150} name="tap" volume={0.4} />
      <Sfx at={168} name="tap" volume={0.4} />
      <Sfx at={172} name="typing" volume={0.3} length={34} />
      <Sfx at={214} name="tap" volume={0.4} />
      <Sfx at={218} name="send" volume={0.32} />
      <Sfx at={248} name="receive" volume={0.32} />
      <Sfx at={298} name="click" volume={0.5} />
      <Sfx at={300} name="typing" volume={0.35} length={44} />
      <Sfx at={360} name="click" volume={0.5} />
      <Sfx at={366} name="send" volume={0.32} />
      <Sfx at={398} name="chime" volume={0.3} />
    </AbsoluteFill>
  );
};
