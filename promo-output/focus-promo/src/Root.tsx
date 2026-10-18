import { Composition } from "remotion";
import { FocusPromo } from "./FocusPromo";
import { FPS, DURATION } from "./timeline";

export const RemotionRoot = () => (
  <Composition id="FocusPromo" component={FocusPromo} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
);
