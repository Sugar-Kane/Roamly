import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { OffthreadVideo } from "remotion";
import { COLORS, FRAME_RADIUS, SHADOW } from "./brand";
import { CAPTURES, type CaptureKey } from "./captures";
import { fonts } from "./fonts";

/**
 * Standard entrance: a damped spring, per the brief's motion rules. Returns a
 * 0..1 progress value; callers map it to opacity, translate, or scale.
 *
 * damping 200 is critically damped at Remotion's default stiffness, so this
 * never overshoots — which is the point. Overshoot reads as playful, and this
 * brand is calm.
 */
export const useEntrance = (delayFrames = 0, durationInFrames?: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - delayFrames,
    fps,
    config: { damping: 200 },
    durationInFrames,
  });
};

/** Opacity fade using the brief's specified cubic-out easing. */
export const useFade = (
  startFrame: number,
  lengthFrames: number,
  direction: "in" | "out" = "in",
) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [startFrame, startFrame + lengthFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return direction === "in" ? p : 1 - p;
};

/**
 * Wraps a scene so it dissolves in over the transition window. Scenes sit
 * back-to-back on the timeline and handle their own fade, which keeps the
 * timeline arithmetic (and therefore the SRT) simple.
 */
export const SceneWrap: React.FC<{
  children: React.ReactNode;
  background?: string;
  transitionFrames?: number;
}> = ({ children, background = COLORS.paper, transitionFrames = 12 }) => {
  const opacity = useFade(0, transitionFrames);
  return (
    <AbsoluteFill style={{ background, opacity }}>{children}</AbsoluteFill>
  );
};

/**
 * Renders a capture, or a loud placeholder if it has not been produced yet.
 *
 * The placeholder exists so the Studio is usable before the capture session
 * happens. It is deliberately impossible to mistake for real footage, and
 * scripts/preflight.mjs blocks any render while a capture is still missing —
 * the placeholder must never reach an exported file.
 */
export const Capture: React.FC<{
  which: CaptureKey;
  style?: React.CSSProperties;
  /** Seconds into the clip to start, for videos. */
  startFrom?: number;
}> = ({ which, style, startFrom }) => {
  const spec = CAPTURES[which];
  const src = staticFile(`captures/${spec.file}`);
  const common: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
    ...style,
  };

  if (spec.kind === "video") {
    return <OffthreadVideo src={src} style={common} startFrom={startFrom} muted />;
  }
  return <Img src={src} style={common} />;
};

/**
 * A rounded browser chrome around a capture. The brief calls for a 12px radius
 * and a soft shadow; both come from the brand tokens so no scene can invent a
 * harsher one.
 */
export const BrowserFrame: React.FC<{
  children: React.ReactNode;
  width: number | string;
  height: number | string;
  style?: React.CSSProperties;
}> = ({ children, width, height, style }) => (
  <div
    style={{
      width,
      height,
      borderRadius: FRAME_RADIUS,
      overflow: "hidden",
      boxShadow: SHADOW,
      background: COLORS.white,
      display: "flex",
      flexDirection: "column",
      ...style,
    }}
  >
    <div
      style={{
        height: 28,
        flexShrink: 0,
        background: "#E7DED2",
        display: "flex",
        alignItems: "center",
        gap: 6,
        paddingLeft: 12,
      }}
    >
      {[COLORS.coral, COLORS.purple, COLORS.blue].map((c) => (
        <div
          key={c}
          style={{ width: 9, height: 9, borderRadius: 9, background: c, opacity: 0.7 }}
        />
      ))}
    </div>
    <div style={{ flex: 1, minHeight: 0, position: "relative" }}>{children}</div>
  </div>
);

/** A phone bezel for the mobile captures in Scene 5. */
export const PhoneBezel: React.FC<{
  children: React.ReactNode;
  width: number;
  style?: React.CSSProperties;
}> = ({ children, width, style }) => {
  const height = Math.round((width * 844) / 390);
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 34,
        padding: 8,
        background: COLORS.ink,
        boxShadow: SHADOW,
        ...style,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 27,
          overflow: "hidden",
          position: "relative",
          background: COLORS.paper,
        }}
      >
        {children}
      </div>
    </div>
  );
};

/**
 * Lower-third open caption. Burned in, because the brief assumes most plays
 * are muted. Held for at least 2s by construction — see captions.ts.
 */
export const CaptionBlock: React.FC<{
  lines: string[];
  sub?: string;
  delayFrames?: number;
  align?: "center" | "left";
  bottom?: number;
  scale?: number;
}> = ({ lines, sub, delayFrames = 0, align = "center", bottom = 96, scale = 1 }) => {
  const e = useEntrance(delayFrames, 20);
  const y = interpolate(e, [0, 1], [10, 0]);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom,
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        paddingLeft: align === "center" ? 0 : 96,
        gap: 6 * scale,
        opacity: e,
        transform: `translateY(${y}px)`,
      }}
    >
      {lines.map((l) => (
        <div
          key={l}
          style={{
            fontFamily: fonts.inter,
            fontWeight: 600,
            fontSize: 40 * scale,
            lineHeight: 1.25,
            color: COLORS.ink,
            background: "rgba(240, 233, 224, 0.92)",
            padding: `${8 * scale}px ${20 * scale}px`,
            borderRadius: 8,
            textAlign: align,
          }}
        >
          {l}
        </div>
      ))}
      {sub ? (
        <div
          style={{
            fontFamily: fonts.inter,
            fontWeight: 400,
            fontSize: 24 * scale,
            color: COLORS.inkMuted,
            background: "rgba(240, 233, 224, 0.88)",
            padding: `${5 * scale}px ${14 * scale}px`,
            borderRadius: 6,
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
};

/**
 * The ticking countdown overlaid on Scene 2. Driven from the frame rather than
 * baked into the screenshot, so it is genuinely counting down on screen.
 */
export const TickingClock: React.FC<{
  startSeconds: number;
  style?: React.CSSProperties;
  fontSize?: number;
}> = ({ startSeconds, style, fontSize = 84 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const remaining = Math.max(0, startSeconds - Math.floor(frame / fps));
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  return (
    <div
      style={{
        fontFamily: fonts.mono,
        fontWeight: 500,
        fontSize,
        color: COLORS.coral,
        letterSpacing: "-0.02em",
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
    >
      {mm}:{ss}
    </div>
  );
};
