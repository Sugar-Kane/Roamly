import React from "react";
import { AbsoluteFill, interpolate, useVideoConfig } from "remotion";
import {
  BrowserFrame,
  Capture,
  CaptionBlock,
  SceneWrap,
  TickingClock,
  useEntrance,
} from "../components";
import { fonts } from "../fonts";

/**
 * SCENE 2 — The timer (0:07–0:16)
 *
 * The first sight of the product. The screenshot slides up on a spring, and the
 * countdown is composited over it so it genuinely ticks rather than sitting
 * frozen at whatever second the capture happened to catch.
 *
 * The capture lands in Focus Mode, where the timer is large Fraunces numerals
 * on plain paper — not the ring the brief assumed. So rather than pasting a
 * coral monospace clock on top of the app's own digits, the baked-in numerals
 * are masked and redrawn in the app's typeface and ink. The scene reads as the
 * product, not as something stuck over it.
 *
 * Every constant below was measured off 01-focus-timer.png by scanning it, not
 * by eye. Re-measure if that capture is retaken:
 *   digits          x 0.267–0.498, y 0.440–0.569
 *   ink             #493527
 *   background      a gentle left-to-right gradient, #EEE7DD → #EDE5DB, so the
 *                   patch is a matching gradient; a flat fill showed as a box.
 */

/** Centre of the timer numerals, as a fraction of the framed capture. */
const CLOCK_ORIGIN = { x: 0.3823, y: 0.5046 };

/**
 * Patch covering the baked-in numerals. Bounded tightly: the "FOCUS" label sits
 * just above at y 0.42 and the task title just below at y 0.60, and covering
 * either of them would be visible.
 */
const CLOCK_MASK = { left: 0.253, top: 0.428, width: 0.259, height: 0.152 };

/** Sampled at the patch edges, so it disappears into the page. */
const MASK_GRADIENT = "linear-gradient(90deg, #EEE7DD 0%, #EDE5DB 100%)";

/** Sampled from the numerals themselves. */
const CLOCK_INK = "#493527";

/** Digit height measures 0.1296 of frame height; Fraunces figures run ~0.72 of
 * their font size, giving 0.18. */
const CLOCK_SIZE_RATIO = 0.18;

/** Matches the value on screen when the capture was taken, so it reads as real. */
const START_SECONDS = 24 * 60 + 52;

export const Timer: React.FC = () => {
  const { width, height } = useVideoConfig();
  const isVertical = height > width;

  const e = useEntrance(4, 30);
  const y = interpolate(e, [0, 1], [48, 0]);
  const scale = interpolate(e, [0, 1], [0.96, 1]);

  const frameW = isVertical ? width - 80 : 1420;
  const captureH = Math.round((frameW * 9) / 16);
  const frameH = captureH + 28;

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

            {/* Mask the frozen numerals, then redraw them ticking. */}
            <div
              style={{
                position: "absolute",
                left: `${CLOCK_MASK.left * 100}%`,
                top: `${CLOCK_MASK.top * 100}%`,
                width: `${CLOCK_MASK.width * 100}%`,
                height: `${CLOCK_MASK.height * 100}%`,
                background: MASK_GRADIENT,
              }}
            />
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
                fontSize={captureH * CLOCK_SIZE_RATIO}
                fontFamily={fonts.fraunces}
                color={CLOCK_INK}
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
