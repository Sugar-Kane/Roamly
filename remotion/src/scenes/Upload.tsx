import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../brand";
import { BrowserFrame, Capture, CaptionBlock, SceneWrap, useEntrance } from "../components";

/**
 * SCENE 4 — AI from your notes (0:24–0:34)
 *
 * Plays 03-upload.mp4 inside a browser frame. Once the generated task list has
 * appeared in the footage, three coral underlines sweep across the rows that
 * matter.
 *
 * TASK_ROWS and LIST_APPEARS_AT are the two things to retune after a capture
 * session: they encode where the generated rows land in the recording and when.
 * Both are called out in README.md as post-capture adjustments, because they
 * cannot be derived until the clip exists.
 */

/** Frame (within this scene) at which the generated list is on screen. */
const LIST_APPEARS_AT = 150;

/** Vertical position of each highlighted row, as a fraction of the frame. */
const TASK_ROWS = [0.46, 0.57, 0.68];

/** Horizontal extent of the sweep, as fractions of the frame width. */
const SWEEP_X = { from: 0.08, to: 0.62 };

const UnderlineSweep: React.FC<{ y: number; delay: number }> = ({ y, delay }) => {
  const frame = useCurrentFrame();
  // 10 frames ≈ 333ms, at the calm end of the brief's motion budget.
  const p = interpolate(frame, [delay, delay + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: `${SWEEP_X.from * 100}%`,
        top: `${y * 100}%`,
        width: `${(SWEEP_X.to - SWEEP_X.from) * p * 100}%`,
        height: 4,
        borderRadius: 4,
        background: COLORS.coral,
        opacity: 0.9,
      }}
    />
  );
};

export const Upload: React.FC = () => {
  const { width, height } = useVideoConfig();
  const isVertical = height > width;

  const e = useEntrance(0, 26);
  const scale = interpolate(e, [0, 1], [0.97, 1]);

  const frameW = isVertical ? width - 70 : 1500;
  const frameH = isVertical
    ? Math.round((width - 70) * 0.5625) + 28
    : Math.round(1500 * 0.5625) + 28;

  return (
    <SceneWrap>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ opacity: e, transform: `scale(${scale})` }}>
          <BrowserFrame width={frameW} height={frameH}>
            <Capture which="upload" />
            {TASK_ROWS.map((y, i) => (
              <UnderlineSweep key={y} y={y} delay={LIST_APPEARS_AT + i * 14} />
            ))}
          </BrowserFrame>
        </div>
      </AbsoluteFill>

      <CaptionBlock
        lines={["Drop in a lecture PDF.", "Get a task list you can actually finish."]}
        sub="3 free AI uploads a month."
        delayFrames={45}
        bottom={isVertical ? 220 : 46}
        scale={isVertical ? 1.12 : 1}
      />
    </SceneWrap>
  );
};
