import React from "react";
import { AbsoluteFill, interpolate, useVideoConfig } from "remotion";
import { COLORS } from "../brand";
import {
  BrowserFrame,
  Capture,
  CaptionBlock,
  SceneWrap,
  TickingClock,
  useEntrance,
} from "../components";

/**
 * SCENE 2 — The timer (0:07–0:16)
 *
 * The first sight of the product. The screenshot slides up on a spring, and a
 * live countdown is composited over it — driven by useCurrentFrame, so the
 * clock genuinely ticks rather than sitting frozen at whatever second the
 * screenshot happened to catch.
 *
 * CLOCK_ORIGIN is the one number to re-check after a capture session: it must
 * line up with where the timer ring sits in 01-focus-timer.png. See the
 * placement note in README.md.
 */

/** Where the composited clock sits, as a fraction of the framed capture. */
const CLOCK_ORIGIN = { x: 0.29, y: 0.44 };

/** Seconds shown at the top of the scene; counts down from here. */
const START_SECONDS = 24 * 60 + 13;

export const Timer: React.FC = () => {
  const { width, height } = useVideoConfig();
  const isVertical = height > width;

  const e = useEntrance(4, 30);
  const y = interpolate(e, [0, 1], [48, 0]);
  const scale = interpolate(e, [0, 1], [0.96, 1]);

  const frameW = isVertical ? width - 80 : 1420;
  const frameH = isVertical ? Math.round((width - 80) * 0.5625) + 28 : 828;

  return (
    <SceneWrap>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            opacity: e,
            transform: `translateY(${y}px) scale(${scale})`,
            position: "relative",
          }}
        >
          <BrowserFrame width={frameW} height={frameH}>
            <Capture which="focusTimer" />

            {/* The composited clock. It sits inside the frame so it inherits
                the frame's rounding and cannot spill onto the paper. */}
            <div
              style={{
                position: "absolute",
                left: `${CLOCK_ORIGIN.x * 100}%`,
                top: `${CLOCK_ORIGIN.y * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <TickingClock
                startSeconds={START_SECONDS}
                fontSize={isVertical ? 64 : 92}
              />
            </div>
          </BrowserFrame>
        </div>
      </AbsoluteFill>

      <CaptionBlock
        lines={["A focus timer built for PA school.", "Free. No account needed."]}
        delayFrames={45}
        bottom={isVertical ? 240 : 56}
        scale={isVertical ? 1.15 : 1}
      />
    </SceneWrap>
  );
};
