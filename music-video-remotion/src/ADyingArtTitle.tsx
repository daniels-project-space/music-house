import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Easing } from "remotion";
import { loadFont } from "@remotion/google-fonts/Cinzel";

const { fontFamily } = loadFont();
const GOLD = "#E8B84B", GOLD_HI = "#F7E7B0", GOLD_DK = "#8A6C1C", BLACK = "#080604";

// "A DYING ART" — spy Art-Deco title card matching the album cover (gun-barrel rifling,
// gold deco frame, tuxedo silhouette, brass light-burst, film grain). 1920x1080 @30, ~5s.
export const ADyingArtTitle: React.FC = () => {
  const f = useCurrentFrame();
  const { fps, width: W, height: H, durationInFrames: D } = useVideoConfig();
  const cx = W / 2, cy = H / 2;

  const bloom = interpolate(f, [0, 42], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const frameDraw = interpolate(f, [8, 62], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
  const titleUp = spring({ frame: f - 46, fps, config: { damping: 200, stiffness: 90 } });
  const titleOp = interpolate(f, [46, 78], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subOp = interpolate(f, [74, 100], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const sil = interpolate(f, [28, 70], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rot = f * 0.14, rot2 = -f * 0.09;
  const pulse = 0.82 + 0.18 * Math.sin(f / 11);
  const shimmerX = interpolate((f + 30) % 120, [0, 120], [-0.4, 1.4]);
  const outFade = interpolate(f, [D - 22, D], [1, 0], { extrapolateLeft: "clamp" });

  const rings = [];
  for (let i = 0; i < 15; i++) {
    const r = 80 + i * 50;
    rings.push(<circle key={i} cx={cx} cy={cy} r={r} fill="none"
      stroke={i % 2 ? GOLD_DK : GOLD} strokeWidth={i % 3 === 0 ? 3.2 : 1.3}
      opacity={(0.12 + 0.5 * (1 - i / 17)) * bloom}
      strokeDasharray={i % 4 === 0 ? undefined : `${7 + i} ${13 + i}`} />);
  }
  const rays = [];
  for (let a = 0; a < 54; a++) {
    const ang = (a / 54) * Math.PI * 2, r1 = 55, r2 = 55 + (130 + (a % 3) * 95) * bloom * pulse;
    rays.push(<line key={a} x1={cx + Math.cos(ang) * r1} y1={cy + Math.sin(ang) * r1}
      x2={cx + Math.cos(ang) * r2} y2={cy + Math.sin(ang) * r2}
      stroke={GOLD_HI} strokeWidth={a % 4 === 0 ? 2 : 0.7} opacity={0.28 * bloom} />);
  }
  // deco frame corner ornament (stepped)
  const corner = (tx: number, ty: number, sx: number, sy: number) => (
    <g transform={`translate(${tx},${ty}) scale(${sx},${sy})`} stroke={GOLD} strokeWidth={2.4} fill="none"
       opacity={frameDraw} strokeDasharray={600} strokeDashoffset={600 * (1 - frameDraw)}>
      <path d="M0,120 L0,40 L40,40 L40,0 L120,0" />
      <path d="M18,120 L18,58 L58,58 L58,18 L120,18" opacity={0.6} />
      <rect x={30} y={30} width={12} height={12} fill={GOLD} stroke="none" />
    </g>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: BLACK, opacity: outFade }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute" }}>
        <defs>
          <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={GOLD_HI} stopOpacity={0.95 * bloom} />
            <stop offset="22%" stopColor={GOLD} stopOpacity={0.55 * bloom} />
            <stop offset="60%" stopColor={GOLD_DK} stopOpacity={0.12 * bloom} />
            <stop offset="100%" stopColor={BLACK} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="vig" cx="50%" cy="50%" r="72%">
            <stop offset="55%" stopColor={BLACK} stopOpacity={0} />
            <stop offset="100%" stopColor={BLACK} stopOpacity={0.92} />
          </radialGradient>
          <linearGradient id="tgold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GOLD_HI} /><stop offset="48%" stopColor={GOLD} />
            <stop offset="100%" stopColor={GOLD_DK} />
          </linearGradient>
          <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={f % 100} result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0" /></filter>
          <filter id="soft"><feGaussianBlur stdDeviation="2.2" /></filter>
        </defs>

        <rect x={0} y={0} width={W} height={H} fill="url(#coreGlow)" />
        <g transform={`rotate(${rot} ${cx} ${cy})`}>{rings.slice(0, 8)}</g>
        <g transform={`rotate(${rot2} ${cx} ${cy})`}>{rings.slice(8)}</g>
        <g filter="url(#soft)">{rays}</g>
        <circle cx={cx} cy={cy} r={46 * pulse} fill={GOLD_HI} opacity={0.9 * bloom} filter="url(#soft)" />

        {/* tuxedo silhouette emerging from the light */}
        <g opacity={sil} transform={`translate(${cx},${cy - 30})`}>
          <path d="M-34,150 L-30,20 Q-30,-30 0,-46 Q30,-30 30,20 L34,150 Z" fill={BLACK} />
          <circle cx={0} cy={-70} r={26} fill={BLACK} />
          <path d="M-14,10 L0,44 L14,10 L8,-2 L-8,-2 Z" fill={GOLD} opacity={0.85} />
          <path d="M-3,12 L3,12 L2,120 L-2,120 Z" fill={GOLD_DK} opacity={0.7} />
        </g>

        {/* Art-Deco frame */}
        <rect x={70} y={70} width={W - 140} height={H - 140} fill="none" stroke={GOLD} strokeWidth={2.6}
          opacity={frameDraw} strokeDasharray={2 * (W + H)} strokeDashoffset={2 * (W + H) * (1 - frameDraw)} />
        <rect x={86} y={86} width={W - 172} height={H - 172} fill="none" stroke={GOLD_DK} strokeWidth={1.4} opacity={0.7 * frameDraw} />
        {corner(70, 70, 1, 1)}{corner(W - 70, 70, -1, 1)}{corner(70, H - 70, 1, -1)}{corner(W - 70, H - 70, -1, -1)}
        {/* top-center deco chevron ornament (matches cover) */}
        <g opacity={frameDraw} transform={`translate(${cx},64)`}>
          <path d="M-46,0 L0,26 L46,0" fill="none" stroke={GOLD} strokeWidth={2.6} />
          <path d="M0,4 L0,30" stroke={GOLD} strokeWidth={2.6} /><rect x={-6} y={-2} width={12} height={12} fill={GOLD} transform="rotate(45)" />
        </g>
      </svg>

      {/* TITLE */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
        <div style={{ transform: `translateY(${(1 - titleUp) * 46}px)`, opacity: titleOp, position: "relative", marginTop: 120 }}>
          <div style={{
            fontFamily, fontWeight: 800, fontSize: 168, letterSpacing: 18, lineHeight: 1,
            background: "linear-gradient(180deg,#F7E7B0 0%,#E8B84B 48%,#8A6C1C 100%)",
            WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
            textShadow: "0 0 40px rgba(232,184,75,0.35)", filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.6))",
          }}>A DYING ART</div>
          {/* specular shimmer sweep */}
          <div style={{
            position: "absolute", inset: 0, mixBlendMode: "screen", pointerEvents: "none",
            background: `linear-gradient(105deg, transparent ${shimmerX * 100 - 12}%, rgba(255,255,255,0.75) ${shimmerX * 100}%, transparent ${shimmerX * 100 + 12}%)`,
            WebkitMaskImage: "linear-gradient(#000,#000)",
          }} />
        </div>
        <div style={{
          fontFamily, fontWeight: 500, fontSize: 34, letterSpacing: 26, color: GOLD, opacity: subOp,
          marginTop: 30, textShadow: "0 0 18px rgba(232,184,75,0.4)",
        }}>THE&nbsp;&nbsp;DOLLCAT&nbsp;&nbsp;CLUB</div>
        <div style={{ width: 360 * subOp, height: 1, marginTop: 22, background: `linear-gradient(90deg,transparent,${GOLD},transparent)`, opacity: subOp }} />
      </AbsoluteFill>

      <svg width={W} height={H} style={{ position: "absolute", opacity: 0.05, mixBlendMode: "overlay" }}><rect width={W} height={H} filter="url(#grain)" /></svg>
      <svg width={W} height={H} style={{ position: "absolute" }}><rect width={W} height={H} fill="url(#vig)" /></svg>
    </AbsoluteFill>
  );
};
