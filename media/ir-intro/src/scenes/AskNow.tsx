import { AbsoluteFill } from "remotion";
import { Caption } from "../components/Caption";
import { ChatDemo } from "../components/ChatDemo";
import { Window } from "../components/Frames";
import { Reveal } from "../components/Reveal";
import { COLOR } from "../theme";

/** 4. AI 도우미: 지금 널어도 될까? (실제 답 화면) */
export const AskNow: React.FC = () => (
  <AbsoluteFill style={{ background: COLOR.paper }}>
    <div style={{ position: "absolute", left: 140, top: 210 }}>
      <Caption
        kicker="AI 도우미 · 지금"
        title={
          <>
            지금 널어도
            <br />
            될까요?
          </>
        }
        lines={["덕장 1km 안 실제 관측기로 판단", "등급은 규칙이 정하고 AI는 설명", "카드 하나에 관측값과 근거"]}
      />
    </div>
    <Reveal at={0.3} style={{ position: "absolute", left: 780, top: 110 }}>
      <Window width={1040} height={860}>
        <ChatDemo
          question="오늘 우리 덕장 널어도 괜찮아?"
          shots={[{ file: "chat-now.png", width: 1480, height: 1492 }]}
          viewWidth={1040}
          viewHeight={808}
          answerAt={3}
          scrollFrom={5}
          scrollTo={10.5}
        />
      </Window>
    </Reveal>
  </AbsoluteFill>
);
