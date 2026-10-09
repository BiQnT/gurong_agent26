import { Composition, Folder } from "remotion";
import { HaepungIntro } from "./HaepungIntro";
import { ReadmeHero, ReadmeHistory, ReadmeNow } from "./Readme";
import { ColdOpen, Problem, Statement } from "./scenes/Dark";
import { Insight, Now, Record } from "./scenes/Desk";
import { Exchange } from "./scenes/Exchange";
import { End, Intro } from "./scenes/Light";
import { FPS, length, TOTAL } from "./timeline";

const SIZE = { fps: FPS, width: 1920, height: 1080 };

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="HaepungIntro" component={HaepungIntro} durationInFrames={TOTAL} {...SIZE} />
    <Folder name="Scenes">
      <Composition id="ColdOpen" component={ColdOpen} durationInFrames={length("coldOpen")} {...SIZE} />
      <Composition id="Problem" component={Problem} durationInFrames={length("problem")} {...SIZE} />
      <Composition id="Intro" component={Intro} durationInFrames={length("intro")} {...SIZE} />
      <Composition id="Record" component={Record} durationInFrames={length("record")} {...SIZE} />
      <Composition id="Now" component={Now} durationInFrames={length("now")} {...SIZE} />
      <Composition id="Exchange" component={Exchange} durationInFrames={length("exchange")} {...SIZE} />
      <Composition id="Insight" component={Insight} durationInFrames={length("insight")} {...SIZE} />
      <Composition id="Statement" component={Statement} durationInFrames={length("statement")} {...SIZE} />
      <Composition id="End" component={End} durationInFrames={length("end")} {...SIZE} />
    </Folder>
    <Folder name="Readme">
      <Composition id="ReadmeHero" component={ReadmeHero} durationInFrames={1} fps={FPS} width={1600} height={800} />
      <Composition id="ReadmeNow" component={ReadmeNow} durationInFrames={1} fps={FPS} width={1600} height={1300} />
      <Composition id="ReadmeHistory" component={ReadmeHistory} durationInFrames={1} fps={FPS} width={1600} height={1380} />
    </Folder>
  </>
);
