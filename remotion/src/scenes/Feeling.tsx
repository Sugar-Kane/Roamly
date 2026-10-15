import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../brand";
import { fonts } from "../fonts";
import { SceneWrap } from "../components";

/**
 * SCENE 1 — The feeling (0:00–0:07)
 *
 * No footage. Three pressure lines type on one at a time, fade back together,
 * and resolve to the relief line. The whole video's emotional premise lives
 * here, so it is deliberately slow: the last line holds for over two seconds
 * with nothing competing for attention.
 */

const PRESSURE = [
  "Four exams in three weeks.",
  "A pharm deck you haven't opened.",
  "And it's already 9pm.",
];

/** Frames at which each pressure line begins to appear. */
const LINE_IN = [12, 36, 60];
/** All three pressure lines start fading out here. */
const PRESSURE_OUT = 132;
/** The relief line arrives as the pressure clears. */
const RELIEF_IN = 141;

const PressureLine: React.FC<{ text: string; appearAt: number }> = ({ text, appearAt }) => {
  const frame = useCurrentFrame();

  // Fade up 6px, per the brief. 18 frames (600ms) is slow enough to read as
  // a thought landing rather than a UI animation.
  const appear = interpolate(frame, [appearAt, appearAt + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const leave = interpolate(frame, [PRESSURE_OUT, PRESSURE_OUT + 15], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = appear * leave;
  const y = interpolate(appear, [0, 1], [6, 0]);

  return (
    <div
      style={{
        fontFamily: fonts.fraunces,
        fontWeight: 500,
        fontSize: 62,
        lineHeight: 1.35,
        color: COLORS.ink,
        opacity,
        transform: `translateY(${y}px)`,
      }}
    >
      {text}
    </div>
  );
};

export const Feeling: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const isVertical = height > width;

  const reliefIn = interpolate(frame, [RELIEF_IN, RELIEF_IN + 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const reliefY = interpolate(reliefIn, [0, 1], [6, 0]);

  return (
    <SceneWrap>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: isVertical ? "center" : "flex-start",
          padding: isVertical ? "0 90px" : "0 160px",
          textAlign: isVertical ? "center" : "left",
        }}
      >
        {/* The two blocks are stacked in the same cell so the relief line
            appears where the pressure lines were, not below them. */}
        <div style={{ position: "relative", width: "100%" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 18,
              alignItems: isVertical ? "center" : "flex-start",
            }}
          >
            {PRESSURE.map((t, i) => (
              <PressureLine key={t} text={t} appearAt={LINE_IN[i]} />
            ))}
          </div>

          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: isVertical ? "center" : "flex-start",
              gap: 10,
              opacity: reliefIn,
              transform: `translateY(${reliefY}px)`,
            }}
          >
            <div
              style={{
                fontFamily: fonts.fraunces,
                fontWeight: 600,
                fontSize: 70,
                lineHeight: 1.25,
                color: COLORS.ink,
              }}
            >
              You're not behind.
            </div>
            <div
              style={{
                fontFamily: fonts.fraunces,
                fontWeight: 500,
                fontSize: 70,
                lineHeight: 1.25,
                color: COLORS.primary,
              }}
            >
              You just need the next 25 minutes.
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </SceneWrap>
  );
};
