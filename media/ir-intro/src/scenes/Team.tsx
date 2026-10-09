import { AbsoluteFill } from "remotion";
import { CrossShot } from "../components/CrossShot";
import { Phone, Window } from "../components/Frames";
import { Reveal } from "../components/Reveal";
import { COLOR, FONT } from "../theme";

/** 8. 관리자와 근로자: 승인한 안내가 근로자 언어로, 질문과 답변이 한 화면에. */
export const Team: React.FC = () => (
  <AbsoluteFill style={{ background: COLOR.paper }}>
    <div style={{ position: "absolute", left: 120, top: 96 }}>
      <Reveal at={0.2}>
        <div style={{ fontFamily: FONT.sans, fontSize: 30, fontWeight: 500, color: COLOR.sea, letterSpacing: 1 }}>
          관리자와 근로자
        </div>
      </Reveal>
      <Reveal at={0.45}>
        <div
          style={{
            marginTop: 16,
            fontFamily: FONT.serif,
            fontSize: 76,
            fontWeight: 700,
            color: COLOR.ink,
            letterSpacing: -2,
          }}
        >
          같은 작업, 각자의 언어로
        </div>
      </Reveal>
      <Reveal at={0.9}>
        <div style={{ marginTop: 10, fontFamily: FONT.sans, fontSize: 34, color: COLOR.muted }}>
          운영자가 승인한 안내는 근로자 언어로 · 확인과 질문, 답변이 한 흐름에
        </div>
      </Reveal>
    </div>
    <Reveal at={0.8} style={{ position: "absolute", left: 120, top: 360 }}>
      <Window width={1120} height={640} label="운영자 화면 · 작업 안내 승인과 답변">
        <CrossShot
          width={1120}
          height={588}
          items={[
            // 승인한 안내: 한국어 원문과 베트남어 미리보기
            { file: "guidance-approved.png", width: 2880, height: 1800, from: 0, crop: [660, 720, 2120], to: [1150, 720, 1640] },
            // 근로자 질문 아래에 운영자 답변
            { file: "owner-answered.png", width: 2880, height: 1800, from: 7.2, crop: [1160, 900, 1620], to: [1160, 1000, 1620] },
          ]}
        />
      </Window>
    </Reveal>
    <Reveal at={1.6} style={{ position: "absolute", left: 1330, top: 120 }}>
      <Phone width={440} height={880}>
        <CrossShot
          width={412}
          height={852}
          items={[
            // 베트남어 근로자 홈: 진행 중인 건조와 받은 안내
            { file: "worker-home.png", width: 1170, height: 2532, from: 0, crop: [0, 0, 1170], to: [0, 110, 1170] },
            // 확인을 누르고 베트남어로 질문
            { file: "worker-asked.png", width: 1170, height: 4443, from: 4.2, crop: [0, 1500, 1170], to: [0, 2020, 1170] },
            // 운영자 답변이 질문 아래에
            { file: "worker-answered.png", width: 1170, height: 4785, from: 8.2, crop: [0, 2100, 1170], to: [0, 2360, 1170] },
          ]}
        />
      </Phone>
    </Reveal>
  </AbsoluteFill>
);
