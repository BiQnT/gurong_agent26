import { AbsoluteFill } from "remotion";
import { Caption } from "../components/Caption";
import { ChatDemo } from "../components/ChatDemo";
import { Window } from "../components/Frames";
import { Reveal } from "../components/Reveal";
import { COLOR } from "../theme";

/** 5. AI 도우미: 내일은? (기상청 단기예보로 매긴 예상 등급) */
export const Tomorrow: React.FC = () => (
  <AbsoluteFill style={{ background: COLOR.paper }}>
    <Reveal at={0.3} style={{ position: "absolute", left: 110, top: 110 }}>
      <Window width={1040} height={860}>
        <ChatDemo
          question="내일 널어도 돼?"
          shots={[
            { file: "chat-tomorrow-cards.png", width: 1480, height: 1004 },
            { file: "chat-tomorrow-text.png", width: 1480, height: 114 },
          ]}
          viewWidth={1040}
          viewHeight={808}
          answerAt={2.2}
          scrollFrom={4.2}
          scrollTo={7.5}
        />
      </Window>
    </Reveal>
    <div style={{ position: "absolute", left: 1220, top: 230 }}>
      <Caption
        kicker="AI 도우미 · 예보"
        title={
          <>
            내일은,
            <br />
            모레는?
          </>
        }
        lines={["기상청 단기예보에 같은 규칙", "날짜별 예상 등급과 강수확률"]}
        width={580}
      />
    </div>
  </AbsoluteFill>
);
