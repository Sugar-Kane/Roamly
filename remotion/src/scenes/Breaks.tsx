import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, GRADIENTS, SHADOW } from "../brand";
import { fonts } from "../fonts";
import { CaptionBlock, SceneWrap, useEntrance } from "../components";
import { BREAK_PROMPTS } from "../captions";

/**
 * SCENE 6 — Breaks without guilt (0:44–0:50)
 *
 * The one scene with no product footage in the middle of the video. That is
 * intentional: it is a permission slip, not a feature demo, and cutting to a
 * warm wash after the busy rooms scene gives the eye somewhere to rest before
 * the closing montage.
 *
 * The prompts are worded exactly as they appear in src/HealthyBreakActivities.tsx,
 * including the "if your space allows" hedge — the app is careful not to
 * prescribe movement, and the video should not undo that.
 */

const CARD_IN = [10, 26, 42];

const PromptCard: React.FC<{ text: string; delay: number }> = ({ text, delay }) => {
  const e = useEntrance(delay, 22);
  const y = interpolate(e, [0, 1], [12, 0]);
  return (
    <div
      style={{
        fontFamily: fonts.fraunces,
        fontWeight: 500,
        fontSize: 46,
        color: COLORS.ink,
        background: "rgba(240, 233, 224, 0.94)",
        padding: "26px 44px",
        borderRadius: 14,
        boxShadow: SHADOW,
        opacity: e,
        transform: `translateY(${y}px)`,
      }}
    >
      {text}
    </div>
  );
};

export const Breaks: React.FC = () => {
  const frame = useCurrentFrame();
  const { height, width } = useVideoConfig();
  const isVertical = height > width;

  // A very slow drift on the gradient so the wash is not a flat card.
  const shift = interpolate(frame, [0, 180], [0, 8], { extrapolateRight: "clamp" });

  return (
    <SceneWrap background={COLORS.paper}>
      <AbsoluteFill
        style={{
          background: GRADIENTS.accent,
          transform: `scale(1.06) translateX(${-shift}px)`,
        }}
      />
      {/* Softening veil: the raw accent gradient is too saturated to sit
          behind cream cards for six seconds. */}
      <AbsoluteFill style={{ background: "rgba(240, 233, 224, 0.18)" }} />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          gap: 26,
          flexDirection: "column",
          padding: isVertical ? "0 70px" : "0 200px",
        }}
      >
        {BREAK_PROMPTS.map((t, i) => (
          <PromptCard key={t} text={t} delay={CARD_IN[i]} />
        ))}
      </AbsoluteFill>

      <CaptionBlock
        lines={["Breaks are part of the method, not a failure of it."]}
        delayFrames={75}
        bottom={isVertical ? 260 : 84}
        scale={isVertical ? 1.15 : 1}
      />
    </SceneWrap>
  );
};
