import { Composition, Folder } from "remotion";
import { HaepungIntro, INTRO_DURATION } from "./HaepungIntro";
import { AskNow } from "./scenes/AskNow";
import { Closing } from "./scenes/Closing";
import { History } from "./scenes/History";
import { Opening } from "./scenes/Opening";
import { Problem } from "./scenes/Problem";
import { Record } from "./scenes/Record";
import { Team } from "./scenes/Team";
import { Title } from "./scenes/Title";
import { Tomorrow } from "./scenes/Tomorrow";
import { Trust } from "./scenes/Trust";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="HaepungIntro"
      component={HaepungIntro}
      durationInFrames={INTRO_DURATION}
      fps={30}
      width={1920}
      height={1080}
    />
    <Folder name="Scenes">
      <Composition id="Opening" component={Opening} durationInFrames={180} fps={30} width={1920} height={1080} />
      <Composition id="Title" component={Title} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="Problem" component={Problem} durationInFrames={210} fps={30} width={1920} height={1080} />
      <Composition id="AskNow" component={AskNow} durationInFrames={360} fps={30} width={1920} height={1080} />
      <Composition id="Tomorrow" component={Tomorrow} durationInFrames={270} fps={30} width={1920} height={1080} />
      <Composition id="History" component={History} durationInFrames={270} fps={30} width={1920} height={1080} />
      <Composition id="Record" component={Record} durationInFrames={210} fps={30} width={1920} height={1080} />
      <Composition id="Team" component={Team} durationInFrames={360} fps={30} width={1920} height={1080} />
      <Composition id="Trust" component={Trust} durationInFrames={210} fps={30} width={1920} height={1080} />
      <Composition id="Closing" component={Closing} durationInFrames={180} fps={30} width={1920} height={1080} />
    </Folder>
  </>
);
