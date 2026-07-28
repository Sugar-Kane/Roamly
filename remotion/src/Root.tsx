import React from "react";
import { Composition } from "remotion";
import { Promo } from "./Promo";
import { FPS, TOTAL_FRAMES } from "./timing";

/**
 * Two compositions, one timeline. The vertical cut exists because Instagram and
 * TikTok are where PA students actually are; it reuses every scene component
 * rather than duplicating the storyboard.
 */
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="RoamlyPromo"
      component={Promo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ withAudio: false }}
    />
    <Composition
      id="RoamlyPromoVertical"
      component={Promo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ withAudio: false }}
    />
  </>
);
