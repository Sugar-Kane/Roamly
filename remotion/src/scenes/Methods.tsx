import React from "react";
import { AbsoluteFill, interpolate, useVideoConfig } from "remotion";
import { COLORS, SHADOW } from "../brand";
import { fonts } from "../fonts";
import { BrowserFrame, Capture, CaptionBlock, SceneWrap, useEntrance } from "../components";
import { METHOD_CHIPS } from "../captions";

/**
 * SCENE 3 — The methods (0:16–0:24)
 *
 * Chips pop in one at a time over the method picker. Every label is a real
 * method name and interval from src/data.ts — the pairing of a block length to
 * a kind of studying is the actual product insight, so the notes ("flashcards",
 * "pharm") matter as much as the numbers.
 *
 * PANCE Drill is Premium. It carries no "Premium" badge here because the chip
 * row is showing the range of methods, not making a pricing claim; the pricing
 * is stated in Scene 4's subcaption and on the close card.
 */

/** Frames between each chip's entrance. Slow enough to read each one. */
const CHIP_STAGGER = 11;
const FIRST_CHIP_AT = 20;

const Chip: React.FC<{ label: string; note: string; delay: number; scale: number }> = ({
  label,
  note,
  delay,
  scale,
}) => {
  const e = useEntrance(delay, 14);
  const x = interpolate(e, [0, 1], [24, 0]);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10 * scale,
        background: COLORS.white,
        borderLeft: `4px solid ${COLORS.coral}`,
        borderRadius: 10,
        padding: `${14 * scale}px ${22 * scale}px`,
        boxShadow: SHADOW,
        opacity: e,
        transform: `translateX(${x}px)`,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          fontFamily: fonts.mono,
          fontWeight: 500,
          fontSize: 30 * scale,
          color: COLORS.ink,
        }}
      >
        {label}
      </span>
      {note ? (
        <span
          style={{
            fontFamily: fonts.inter,
            fontWeight: 400,
            fontSize: 24 * scale,
            color: COLORS.inkMuted,
          }}
        >
          {note}
        </span>
      ) : null}
    </div>
  );
};

export const Methods: React.FC = () => {
  const { width, height } = useVideoConfig();
  const isVertical = height > width;

  const e = useEntrance(0, 26);
  const scale = interpolate(e, [0, 1], [0.97, 1]);

  return (
    <SceneWrap>
      {/* Landscape: capture left, chips right. Vertical: capture on top,
          chips beneath, since a side-by-side split is unreadable at 1080 wide. */}
      <AbsoluteFill
        style={{
          flexDirection: isVertical ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: isVertical ? 44 : 64,
          padding: isVertical ? "0 50px" : "0 90px",
        }}
      >
        <div style={{ opacity: e, transform: `scale(${scale})`, flexShrink: 0 }}>
          <BrowserFrame
            width={isVertical ? width - 100 : 1040}
            height={isVertical ? Math.round((width - 100) * 0.62) + 28 : 668}
          >
            <Capture which="methods" />
          </BrowserFrame>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: isVertical ? 12 : 16,
            alignItems: "flex-start",
          }}
        >
          {METHOD_CHIPS.map((c, i) => (
            <Chip
              key={c.label}
              label={c.label}
              note={c.note}
              delay={FIRST_CHIP_AT + i * CHIP_STAGGER}
              scale={isVertical ? 0.82 : 1}
            />
          ))}
        </div>
      </AbsoluteFill>

      <CaptionBlock
        lines={["Pick the block that matches the material."]}
        delayFrames={30}
        bottom={isVertical ? 190 : 52}
        scale={isVertical ? 1.15 : 1}
      />
    </SceneWrap>
  );
};
