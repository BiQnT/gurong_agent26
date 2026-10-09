import { AbsoluteFill } from "remotion";
import { Caption } from "../components/Caption";
import { CrossShot } from "../components/CrossShot";
import { Window } from "../components/Frames";
import { Reveal } from "../components/Reveal";
import { COLOR } from "../theme";

/** 7. 건조 기록: "꽁치 500마리 널었어" → 미리 채워진 시작 창 → 배치 기록. */
export const Record: React.FC = () => (
  <AbsoluteFill style={{ background: COLOR.paper }}>
    <div style={{ position: "absolute", left: 120, top: 230 }}>
      <Caption
        kicker="건조 기록"
        title={
          <>
            "널었어" 한마디면
            <br />
            기록이 시작돼요
          </>
        }
        lines={["원물과 마리 수를 미리 채워요", "진행 중엔 30분마다 자동 기록", "부적합이 되면 경보를 남겨요"]}
      />
    </div>
    <Reveal at={0.3} style={{ position: "absolute", left: 790, top: 150 }}>
      <Window width={1030} height={772}>
        <CrossShot
          width={1030}
          height={720}
          items={[
            // 미리 채워진 시작 창 (꽁치 · 500마리)
            { file: "start-dialog.png", width: 2880, height: 1800, from: 0, crop: [860, 240, 1160], to: [900, 300, 1080] },
            // 30분 자동 기록이 쌓인 배치 기록 (평균·결측·경보·판정 분포)
            { file: "batch-report.png", width: 2880, height: 1800, from: 3.6, crop: [740, 80, 1420], to: [740, 640, 1420] },
          ]}
        />
      </Window>
    </Reveal>
  </AbsoluteFill>
);
