import React from "react";
import { AbsoluteFill, Audio, Series, staticFile } from "remotion";
import { COLORS } from "./brand";
import { SCENES, TRANSITION_FRAMES, sceneFrames } from "./timing";
import { Feeling } from "./scenes/Feeling";
import { Timer } from "./scenes/Timer";
import { Methods } from "./scenes/Methods";
import { Upload } from "./scenes/Upload";
import { Rooms } from "./scenes/Rooms";
import { Breaks } from "./scenes/Breaks";
import { Progress } from "./scenes/Progress";
import { Close } from "./scenes/Close";
import { installFonts } from "./fonts";

/**
 * The 60-second promo, shared by the landscape and vertical compositions.
 * Every scene reads useVideoConfig() to decide its own layout, so there is one
 * timeline and one set of scene components regardless of aspect ratio.
 *
 * Scenes are laid out back-to-back; each fades itself in over TRANSITION_FRAMES
 * (see SceneWrap), which reads as a cross-dissolve against the previous scene's
 * last frame while keeping the timeline arithmetic exact — captions.ts and the
 * generated .srt both depend on scene starts being the plain sum of durations.
 */

const SCENE_COMPONENTS = {
  feeling: Feeling,
  timer: Timer,
  methods: Methods,
  upload: Upload,
  rooms: Rooms,
  breaks: Breaks,
  progress: Progress,
  close: Close,
} as const;

export const Promo: React.FC<{ withAudio?: boolean }> = ({ withAudio = false }) => {
  installFonts();

  return (
  <AbsoluteFill style={{ background: COLORS.paper }}>
    <Series>
      {SCENES.map((s) => {
        const Component = SCENE_COMPONENTS[s.id];
        return (
          <Series.Sequence key={s.id} durationInFrames={sceneFrames(s)} name={s.title}>
            <Component />
          </Series.Sequence>
        );
      })}
    </Series>

    {/*
      The music bed is opt-in because no track is committed yet — see the Audio
      section of README.md. Enabling it without a licensed file in
      public/audio/bed.mp3 would fail the render, which is the intended
      behaviour: silence-by-default beats shipping an unlicensed track.
    */}
    {withAudio ? <Audio src={staticFile("audio/bed.mp3")} volume={0.5} /> : null}
  </AbsoluteFill>
  );
};

export { TRANSITION_FRAMES };
