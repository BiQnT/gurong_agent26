import type React from "react";
import { AbsoluteFill } from "remotion";
import { useFrame } from "../timeline";
import { Chapter } from "../components/Chapter";
import { Patch, Spotlight, Typing, Wipe } from "../components/Overlays";
import { Cursor } from "../components/Pointer";
import { Sfx } from "../components/Sfx";
import { AppScreen, FullStage } from "../components/Stage";
import { track } from "../motion";
import { DESK, FIELD, SPOT } from "../shots";
import { COLOR } from "../theme";

// 운영자 데스크톱 화면 장면 셋: 말로 기록, 지금 판단, 예보와 과거 분석.
// 모두 실제 화면 상태를 차례로 바꾸고, 그 위에 커서·타이핑·강조만 얹는다.

const HOME = { x: 720, y: 450, z: 1 };
const COMPOSER = { x: 800, y: 655, z: 1.95 };
const CHAT = { x: 849, y: 420, z: 1.3 };
/** 글자가 들어가면 켜지는 보내기 버튼 (record-typed 화면의 것) */
const SEND_BUTTON = { x: 1192, y: 810, w: 36, h: 36 };
const SendLit: React.FC<{ show: number; until: number }> = ({ show, until }) => (
  <Patch rect={SEND_BUTTON} from="record-typed" imageSize={DESK} show={show} until={until} />
);

const Paper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ background: COLOR.paper }}>{children}</AbsoluteFill>
);

/** 보내기: 누르는 소리와 보내는 소리 */
const SendSound: React.FC<{ at: number }> = ({ at }) => (
  <>
    <Sfx at={at} name="click" volume={0.5} />
    <Sfx at={at + 1} name="send" volume={0.32} />
  </>
);

/** 설계 24~33.6초: 말 한마디로 건조 기록이 시작된다 */
export const Record: React.FC = () => {
  const frame = useFrame();
  const pose = track(frame, HOME, [
    [36, 60, COMPOSER],
    [102, 122, CHAT],
    [126, 142, { x: 800, y: 300, z: 1.75 }],
    [160, 176, { x: 720, y: 470, z: 1.45 }],
    [228, 248, { x: 850, y: 470, z: 1.22 }],
  ]);
  return (
    <Paper>
      <Chapter title="말하면, 기록됩니다." out={34}>
        <Paper>
          <FullStage pose={pose}>
            <AppScreen
              width={DESK.w}
              height={DESK.h}
              states={[
                [0, "app-overview"],
                [86, "record-typed", 2],
                [102, "record-thinking", 5],
                [128, "record-answer", 6],
                [162, "record-dialog", 6],
                [206, "record-dialog-named", 2],
                [228, "record-batches", 6],
              ]}
            >
              <Typing field={FIELD.record} typed="record-typed" imageSize={DESK} chars={15} show={54} start={58} end={86} until={86} />
              <SendLit show={59} until={86} />
              <Typing field={FIELD.batchName} typed="record-dialog-named" imageSize={DESK} chars={7} show={182} start={186} end={204} until={206} />
              <Spotlight rect={SPOT.batchCard} show={242} hide={320} radius={18} />
            </AppScreen>
            <Cursor
              show={[34, 236]}
              start={{ x: 1100, y: 600 }}
              moves={[
                [34, 52, { x: 640, y: 782 }],
                [88, 99, SPOT.send],
                [132, 154, SPOT.startAction],
                [166, 180, SPOT.batchNameInput],
                [206, 222, SPOT.approveBatch],
              ]}
              clicks={[54, 100, 156, 182, 224]}
            />
          </FullStage>
        </Paper>
      </Chapter>
      <Sfx at={54} name="click" volume={0.5} />
      <Sfx at={58} name="typing" volume={0.35} length={28} />
      <SendSound at={100} />
      <Sfx at={128} name="receive" volume={0.3} />
      <Sfx at={156} name="click" volume={0.5} />
      <Sfx at={182} name="click" volume={0.5} />
      <Sfx at={186} name="typing" volume={0.35} length={18} />
      <Sfx at={224} name="click" volume={0.5} />
      <Sfx at={232} name="chime" volume={0.3} />
    </Paper>
  );
};

/** 설계 33.6~42초: 지금 널어도 되는지, 실제 관측과 근거로 */
export const Now: React.FC = () => {
  const frame = useFrame();
  const pose = track(frame, { x: 850, y: 470, z: 1.22 }, [
    [12, 30, HOME],
    [36, 56, COMPOSER],
    [96, 114, CHAT],
    [118, 136, { x: 849, y: 236, z: 1.62 }],
    [168, 190, { x: 849, y: 448, z: 1.62 }],
    [208, 228, { x: 849, y: 640, z: 1.45 }],
  ]);
  return (
    <Paper>
      <Chapter title="판단은, 실제 관측으로." out={34}>
        <Paper>
          <FullStage pose={pose}>
            <AppScreen
              width={DESK.w}
              height={DESK.h}
              states={[
                [0, "record-batches"],
                [14, "app-overview", 8],
                [97, "now-thinking", 5],
                [118, "now-answer", 6],
              ]}
            >
              <Typing field={FIELD.now} typed="now-typed" imageSize={DESK} chars={17} show={50} start={52} end={80} until={97} />
              <SendLit show={53} until={97} />
              <Spotlight rect={SPOT.nowHeadline} show={130} hide={172} />
              <Spotlight rect={SPOT.nowReasons} show={178} hide={214} />
              <Spotlight rect={SPOT.nowText} show={218} hide={290} />
            </AppScreen>
            <Cursor
              show={[34, 104]}
              start={{ x: 1100, y: 620 }}
              moves={[
                [34, 48, { x: 640, y: 782 }],
                [82, 94, SPOT.send],
              ]}
              clicks={[50, 96]}
            />
          </FullStage>
        </Paper>
      </Chapter>
      <Sfx at={50} name="click" volume={0.5} />
      <Sfx at={52} name="typing" volume={0.35} length={28} />
      <SendSound at={96} />
      <Sfx at={118} name="receive" volume={0.3} />
    </Paper>
  );
};

/** 설계 57.6~67.2초: 내일 예보, 그리고 지난 겨울 분석 */
export const Insight: React.FC = () => {
  const frame = useFrame();
  const pose = track(frame, HOME, [
    [34, 50, COMPOSER],
    [66, 80, CHAT],
    [82, 98, { x: 849, y: 280, z: 1.55 }],
    [150, 166, COMPOSER],
    [190, 200, CHAT],
    [200, 216, { x: 849, y: 410, z: 1.24 }],
    [240, 288, { x: 849, y: 380, z: 1.34 }],
  ]);
  return (
    <Paper>
      <Chapter title="내일도, 지난 겨울도." out={32} enterBlur={false}>
        <Paper>
          <FullStage pose={pose}>
            <AppScreen
              width={DESK.w}
              height={DESK.h}
              states={[
                [0, "app-overview"],
                [67, "tomorrow-thinking", 4],
                [84, "tomorrow-answer", 6],
                [192, "history-thinking", 4],
                [200, "history-answer", 6],
              ]}
            >
              <Typing field={FIELD.tomorrow} typed="tomorrow-typed" imageSize={DESK} chars={9} show={50} start={50} end={60} until={67} />
              <SendLit show={51} until={67} />
              <Wipe rect={SPOT.forecastBars} start={84} end={116} />
              <Spotlight rect={SPOT.forecastCard} show={122} hide={150} />
              <Typing field={FIELD.history} typed="history-typed" imageSize={DESK} chars={20} show={164} start={165} end={184} until={192} />
              <SendLit show={166} until={192} />
              <Wipe rect={SPOT.historyRows} start={200} end={244} />
              <Spotlight rect={SPOT.historySummary} show={248} hide={320} />
            </AppScreen>
            <Cursor
              show={[34, 198]}
              start={{ x: 1100, y: 620 }}
              moves={[
                [34, 48, { x: 640, y: 782 }],
                [56, 64, SPOT.send],
                [150, 162, { x: 640, y: 782 }],
                [182, 189, SPOT.send],
              ]}
              clicks={[50, 66, 164, 190]}
            />
          </FullStage>
        </Paper>
      </Chapter>
      <Sfx at={50} name="click" volume={0.5} />
      <Sfx at={50} name="typing" volume={0.35} length={10} />
      <SendSound at={66} />
      <Sfx at={84} name="receive" volume={0.3} />
      <Sfx at={164} name="click" volume={0.5} />
      <Sfx at={165} name="typing" volume={0.35} length={19} />
      <SendSound at={190} />
      <Sfx at={200} name="receive" volume={0.3} />
    </Paper>
  );
};
