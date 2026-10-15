import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  BrowserFrame,
  Capture,
  CaptionBlock,
  PhoneBezel,
  SceneWrap,
  useEntrance,
} from "../components";

/**
 * SCENE 5 — You're not studying alone (0:34–0:44)
 *
 * The emotional peak, and the longest scene. Desktop room footage on the left,
 * the same room on a phone on the right, both showing the same countdown —
 * which is the whole point of the feature and only lands if both surfaces are
 * legible at once.
 *
 * The push-in is deliberately tiny (1.0 → 1.04 over ten seconds). It should
 * register as the scene leaning in, not as a zoom.
 */

export const Rooms: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const isVertical = height > width;

  const e = useEntrance(0, 28);
  const phoneIn = useEntrance(18, 30);

  const push = interpolate(frame, [0, durationInFrames], [1, 1.04], {
    extrapolateRight: "clamp",
  });

  const deskW = isVertical ? width - 90 : 1180;
  const deskH = isVertical
    ? Math.round((width - 90) * 0.5625) + 28
    : Math.round(1180 * 0.5625) + 28;

  return (
    <SceneWrap>
      <AbsoluteFill
        style={{
          flexDirection: isVertical ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: isVertical ? 40 : 56,
          padding: isVertical ? "0 45px" : "0 80px",
          // Reserve the lower third for the caption so the frames never sit
          // underneath it — this is the busiest scene in the video.
          paddingBottom: isVertical ? 340 : 180,
        }}
      >
        <div
          style={{
            opacity: e,
            transform: `scale(${push})`,
            flexShrink: 0,
          }}
        >
          <BrowserFrame width={deskW} height={deskH}>
            <Capture which="room" />
          </BrowserFrame>
        </div>

        <div
          style={{
            opacity: phoneIn,
            transform: `translateY(${interpolate(phoneIn, [0, 1], [24, 0])}px)`,
            flexShrink: 0,
          }}
        >
          <PhoneBezel width={isVertical ? 280 : 330}>
            <Capture which="mobileRoom" style={{ objectFit: "cover" }} />
          </PhoneBezel>
        </div>
      </AbsoluteFill>

      <CaptionBlock
        lines={["Live study rooms. One shared timer.", "Chat only opens on breaks."]}
        delayFrames={45}
        bottom={isVertical ? 170 : 46}
        scale={isVertical ? 1.12 : 1}
      />
    </SceneWrap>
  );
};
