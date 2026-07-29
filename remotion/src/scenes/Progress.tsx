import React from "react";
import { AbsoluteFill, Series, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../brand";
import { BrowserFrame, Capture, CaptionBlock, SceneWrap, useEntrance } from "../components";

/**
 * SCENE 7 — Progress you can see (0:50–0:56)
 *
 * Three ~2s beats: analytics, garden, theme cycling. The caption spans
 * all three rather than changing per beat, so it still clears the 2-second
 * minimum despite the faster cutting.
 *
 * The bar chart "grows" by retracting a paper-coloured mask up off the chart
 * rather than by drawing synthetic bars over the screenshot. That way the bars
 * that grow are the real ones from the account's own history — nothing is
 * invented, and the effect survives any change to the chart's layout.
 * CHART_REGION is the one value to retune once 05-analytics.png exists.
 */

const BEAT = 60; // 2s at 30fps

/** The chart area within 05-analytics.png, as fractions of the image. */
const CHART_REGION = { top: 0.30, left: 0.06, width: 0.88, height: 0.52 };

const AnalyticsBeat: React.FC<{ isVertical: boolean; width: number }> = ({
  isVertical,
  width,
}) => {
  const frame = useCurrentFrame();
  const e = useEntrance(0, 22);

  // Mask retracts from covering the whole chart to covering none of it.
  const cover = interpolate(frame, [4, 40], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const w = isVertical ? width - 80 : 1360;
  const h = isVertical ? Math.round((width - 80) * 0.6) + 28 : Math.round(1360 * 0.6) + 28;

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ opacity: e }}>
        <BrowserFrame width={w} height={h}>
          <Capture which="analytics" />
          <div
            style={{
              position: "absolute",
              left: `${CHART_REGION.left * 100}%`,
              width: `${CHART_REGION.width * 100}%`,
              top: `${CHART_REGION.top * 100}%`,
              height: `${CHART_REGION.height * cover * 100}%`,
              background: COLORS.paper,
            }}
          />
        </BrowserFrame>
      </div>
    </AbsoluteFill>
  );
};

const GardenBeat: React.FC<{ isVertical: boolean; width: number }> = ({
  isVertical,
  width,
}) => {
  const e = useEntrance(0, 24);
  const scale = interpolate(e, [0, 1], [0.94, 1]);
  const w = isVertical ? width - 80 : 1300;
  const h = isVertical ? Math.round((width - 80) * 0.62) + 28 : Math.round(1300 * 0.62) + 28;

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ opacity: e, transform: `scale(${scale})` }}>
        <BrowserFrame width={w} height={h}>
          <Capture which="garden" />
        </BrowserFrame>
      </div>
    </AbsoluteFill>
  );
};

/**
 * Theme cycling closes the montage. This beat was originally the
 * picture-in-picture timer, but Document PiP opens a separate OS window that
 * Playwright cannot record — see SHOTLIST.md.
 */
const ThemesBeat: React.FC<{ isVertical: boolean; width: number }> = ({ isVertical, width }) => {
  const e = useEntrance(0, 22);
  const w = isVertical ? width - 80 : 1300;
  const h = isVertical ? Math.round((width - 80) * 0.5625) + 28 : Math.round(1300 * 0.5625) + 28;

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ opacity: e }}>
        <BrowserFrame width={w} height={h}>
          <Capture which="themes" />
        </BrowserFrame>
      </div>
    </AbsoluteFill>
  );
};

export const Progress: React.FC = () => {
  const { width, height } = useVideoConfig();
  const isVertical = height > width;

  return (
    <SceneWrap>
      <Series>
        <Series.Sequence durationInFrames={BEAT}>
          <AnalyticsBeat isVertical={isVertical} width={width} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={BEAT}>
          <GardenBeat isVertical={isVertical} width={width} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={BEAT}>
          <ThemesBeat isVertical={isVertical} width={width} />
        </Series.Sequence>
      </Series>

      {/* Outside the Series so it persists across all three beats. */}
      <CaptionBlock
        lines={["Streaks, analytics, and a companion that grows with your hours."]}
        delayFrames={30}
        bottom={isVertical ? 200 : 46}
        scale={isVertical ? 1.0 : 0.92}
      />
    </SceneWrap>
  );
};
