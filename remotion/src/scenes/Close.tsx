import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useVideoConfig } from "remotion";
import { COLORS, SHADOW } from "../brand";
import { fonts } from "../fonts";
import { SceneWrap, useEntrance } from "../components";

/**
 * SCENE 8 — Close (0:56–1:00)
 *
 * Logo, the ask, the URL, and the QR. The QR is a build-time artifact
 * (scripts/make-qr.mjs writes public/qr.png) rather than a remote image,
 * because a render that silently 404s its call-to-action is worse than one
 * that fails loudly — and preflight checks the file exists.
 */

export const Close: React.FC = () => {
  const { width, height } = useVideoConfig();
  const isVertical = height > width;

  const logoIn = useEntrance(6, 26);
  const headlineIn = useEntrance(18, 24);
  const urlIn = useEntrance(28, 24);
  const qrIn = useEntrance(36, 24);

  const logoScale = interpolate(logoIn, [0, 1], [0.9, 1]);

  return (
    <SceneWrap>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          gap: 26,
          padding: isVertical ? "0 80px" : "0 160px",
          textAlign: "center",
        }}
      >
        <Img
          src={staticFile("roamly-logo.png")}
          style={{
            width: isVertical ? 260 : 220,
            opacity: logoIn,
            transform: `scale(${logoScale})`,
          }}
        />

        <div
          style={{
            fontFamily: fonts.fraunces,
            fontWeight: 600,
            fontSize: isVertical ? 78 : 82,
            lineHeight: 1.2,
            color: COLORS.ink,
            opacity: headlineIn,
            transform: `translateY(${interpolate(headlineIn, [0, 1], [8, 0])}px)`,
          }}
        >
          Start your next 25 minutes.
        </div>

        <div
          style={{
            fontFamily: fonts.inter,
            fontWeight: 500,
            fontSize: isVertical ? 38 : 36,
            color: COLORS.inkMuted,
            opacity: urlIn,
          }}
        >
          roamlyflow.com — free, no account needed.
        </div>
      </AbsoluteFill>

      {/* QR sits lower-right on the landscape cut; on the vertical cut it
          centres under the copy, since a corner QR is awkward to scan on a
          phone held in portrait. */}
      <div
        style={{
          position: "absolute",
          ...(isVertical
            ? { left: 0, right: 0, bottom: 200, display: "flex", justifyContent: "center" }
            : { right: 96, bottom: 84 }),
          opacity: qrIn,
        }}
      >
        <div
          style={{
            background: COLORS.white,
            padding: 14,
            borderRadius: 10,
            boxShadow: SHADOW,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Img src={staticFile("qr.png")} style={{ width: 180, height: 180, display: "block" }} />
          <div
            style={{
              fontFamily: fonts.inter,
              fontWeight: 500,
              fontSize: 18,
              color: COLORS.ink,
            }}
          >
            Scan to start
          </div>
        </div>
      </div>
    </SceneWrap>
  );
};
