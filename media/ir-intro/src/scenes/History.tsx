import { AbsoluteFill } from "remotion";
import { Caption } from "../components/Caption";
import { ChatDemo } from "../components/ChatDemo";
import { Window } from "../components/Frames";
import { Reveal } from "../components/Reveal";
import { COLOR } from "../theme";

/** 6. AI 도우미: 과거 분석 (기상청 구룡포 AWS 관측으로 일별 등급 시간) */
export const History: React.FC = () => (
  <AbsoluteFill style={{ background: COLOR.paper }}>
    <div style={{ position: "absolute", left: 120, top: 230 }}>
      <Caption
        kicker="AI 도우미 · 과거 분석"
        title={
          <>
            작년 12월은
            <br />
            어땠을까요?
          </>
        }
        lines={["구룡포 AWS 관측을 시간마다", "날짜별 적합 시간과 표로 확인"]}
      />
    </div>
    <Reveal at={0.3} style={{ position: "absolute", left: 780, top: 110 }}>
      <Window width={1040} height={860}>
        <ChatDemo
          question="작년 12월 구룡포 건조 조건 분석해줘"
          shots={[
            { file: "chat-history-cards.png", width: 1480, height: 1894 },
            { file: "chat-history-text.png", width: 1480, height: 390 },
          ]}
          viewWidth={1040}
          viewHeight={808}
          answerAt={2.6}
          scrollFrom={4}
          scrollTo={8.4}
        />
      </Window>
    </Reveal>
  </AbsoluteFill>
);
