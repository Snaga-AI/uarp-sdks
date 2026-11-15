// Ported from apps/builder/components/landing/header-logo-mark.tsx.
// Keep the shared Snaga mark geometry, timing and reduced-motion behavior aligned.
/**
 * Compact Snaga animated logo (default 32x32px).
 * 3 neon dots with glow that morph to triangle and back.
 * Matches the full SnagaLogo style but optimized for small size.
 *
 * All animations are CSS/SMIL-driven (no rAF→setState).
 *
 * Sprint 143: palette-aware via CSS variables in SVG attributes —
 * accent carries the dot glow per palette, ink anchors the hot
 * centre. Drops the binary useThemeMode check that was painting
 * every palette in the same grey pair.
 *
 * Public-chat brand pass (2026-07-17): parametrized `size` (the mark
 * scales through the viewBox) and `animated`. The morph is SMIL
 * `<animate>`, which a CSS `prefers-reduced-motion` block CANNOT
 * stop — so a static render must not mount the `<animate>` nodes at
 * all. `animated={false}` OR OS reduced-motion renders the resting
 * three-dot row instead; this also closes the pre-existing gap where
 * the header mark kept morphing under reduced motion.
 */

import { useEffect, useId, useState } from "react";

const R = 20;
const THINK = [
  { x: -28, y: 0 },
  { x: 0, y: 0 },
  { x: 28, y: 0 },
];
const TRI = [
  { x: 0, y: -R },
  { x: R * Math.sin((2 * Math.PI) / 3), y: R * Math.cos(Math.PI / 3) },
  { x: -R * Math.sin((2 * Math.PI) / 3), y: R * Math.cos(Math.PI / 3) },
];

// Total cycle: 1.5s thinking + 0.7s morph + 0.6s hold + 0.7s unmorph = 3.5s
const TOTAL_DUR = "3.5s";
// Keyframe percentages: thinking=0-42.9%, morph=42.9-62.9%, hold=62.9-80%, unmorph=80-100%

const STROKE = "var(--accent)";
const CORE = "var(--ink)";
const HALO_BG = "color-mix(in srgb, var(--accent) 15%, transparent)";

/** Local matchMedia hook — deliberately NOT imported from the avatar
 *  module so the landing bundle doesn't pull the Canvas2D renderer. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function HeaderLogoMark({
  size = 32,
  animated = true,
}: {
  /** Rendered box in px; the SVG scales via its viewBox. */
  size?: number;
  /** false → static resting mark (no SMIL mounted). */
  animated?: boolean;
} = {}) {
  const reducedMotion = usePrefersReducedMotion();
  const live = animated && !reducedMotion;
  // Unique filter id — the mark now renders many times per page
  // (every assistant turn), and duplicate SVG ids are invalid.
  const filterId = useId().replace(/[«»:]/g, "") + "-hlg";
  const svgPx = Math.round(size * 0.875);

  return (
    <div
      className="rounded flex items-center justify-center transition-transform group-hover:scale-110 relative"
      style={{ width: size, height: size }}
    >
      {live && (
        <style>{`
          @keyframes hlm-edge-appear {
            0%, 42.9% { opacity: 0; }
            57%, 62.9% { opacity: 0.6; }
            80%, 85% { opacity: 0; }
            100% { opacity: 0; }
          }
          @keyframes hlm-glow-bg {
            0%, 42.9% { opacity: 0.5; }
            62.9% { opacity: 1; }
            100% { opacity: 0.5; }
          }
        `}</style>
      )}

      {/* Glow background */}
      <div
        className="absolute inset-0 rounded transition-opacity duration-500"
        style={{
          background: `radial-gradient(circle, ${HALO_BG} 0%, transparent 70%)`,
          ...(live ? { animation: `hlm-glow-bg ${TOTAL_DUR} ease-in-out infinite` } : { opacity: 0.5 }),
        }}
      />
      <svg
        width={svgPx}
        height={svgPx}
        viewBox="-45 -45 90 90"
        style={{ overflow: "visible" }}
        aria-hidden="true"
      >
        <defs>
          <filter id={filterId} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Lines — only exist mid-morph, so a static render skips them. */}
        {live &&
          [0, 1, 2].map((i) => {
            const j = (i + 1) % 3;
            return (
              <line
                key={`l${i}`}
                x1={THINK[i].x}
                y1="0"
                x2={THINK[j].x}
                y2="0"
                stroke={STROKE}
                strokeWidth={1.2}
                strokeLinecap="round"
                opacity="0"
                filter={`url(#${filterId})`}
                style={{ animation: `hlm-edge-appear ${TOTAL_DUR} ease-in-out infinite` }}
              >
                <animate attributeName="x1" values={`${THINK[i].x};${THINK[i].x};${TRI[i].x.toFixed(2)};${TRI[i].x.toFixed(2)};${THINK[i].x}`} keyTimes="0;0.429;0.629;0.8;1" dur={TOTAL_DUR} repeatCount="indefinite" />
                <animate attributeName="y1" values={`0;0;${TRI[i].y.toFixed(2)};${TRI[i].y.toFixed(2)};0`} keyTimes="0;0.429;0.629;0.8;1" dur={TOTAL_DUR} repeatCount="indefinite" />
                <animate attributeName="x2" values={`${THINK[j].x};${THINK[j].x};${TRI[j].x.toFixed(2)};${TRI[j].x.toFixed(2)};${THINK[j].x}`} keyTimes="0;0.429;0.629;0.8;1" dur={TOTAL_DUR} repeatCount="indefinite" />
                <animate attributeName="y2" values={`0;0;${TRI[j].y.toFixed(2)};${TRI[j].y.toFixed(2)};0`} keyTimes="0;0.429;0.629;0.8;1" dur={TOTAL_DUR} repeatCount="indefinite" />
              </line>
            );
          })}

        {/* Dots */}
        {[0, 1, 2].map((i) => (
          <g key={i} filter={`url(#${filterId})`}>
            {/* Outer glow */}
            <circle cx={THINK[i].x} cy="0" r="8" fill={STROKE} opacity="0.1">
              {live && (
                <>
                  <animate attributeName="cx" values={`${THINK[i].x};${THINK[i].x};${TRI[i].x.toFixed(2)};${TRI[i].x.toFixed(2)};${THINK[i].x}`} keyTimes="0;0.429;0.629;0.8;1" dur={TOTAL_DUR} repeatCount="indefinite" />
                  <animate attributeName="cy" values={`0;0;${TRI[i].y.toFixed(2)};${TRI[i].y.toFixed(2)};0`} keyTimes="0;0.429;0.629;0.8;1" dur={TOTAL_DUR} repeatCount="indefinite" />
                </>
              )}
            </circle>
            {/* Core dot */}
            <circle cx={THINK[i].x} cy="0" r="4" fill={STROKE} opacity="0.7">
              {live && (
                <>
                  <animate attributeName="cx" values={`${THINK[i].x};${THINK[i].x};${TRI[i].x.toFixed(2)};${TRI[i].x.toFixed(2)};${THINK[i].x}`} keyTimes="0;0.429;0.629;0.8;1" dur={TOTAL_DUR} repeatCount="indefinite" />
                  <animate attributeName="cy" values={`0;0;${TRI[i].y.toFixed(2)};${TRI[i].y.toFixed(2)};0`} keyTimes="0;0.429;0.629;0.8;1" dur={TOTAL_DUR} repeatCount="indefinite" />
                  <animate attributeName="r" values="4;4;5;5;4" keyTimes="0;0.429;0.629;0.8;1" dur={TOTAL_DUR} repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.5;0.5;0.95;0.95;0.5" keyTimes="0;0.429;0.629;0.8;1" dur={TOTAL_DUR} repeatCount="indefinite" />
                </>
              )}
            </circle>
            {/* Hot center */}
            <circle cx={THINK[i].x} cy="0" r="1.2" fill={CORE} opacity="0.8">
              {live && (
                <>
                  <animate attributeName="cx" values={`${THINK[i].x};${THINK[i].x};${TRI[i].x.toFixed(2)};${TRI[i].x.toFixed(2)};${THINK[i].x}`} keyTimes="0;0.429;0.629;0.8;1" dur={TOTAL_DUR} repeatCount="indefinite" />
                  <animate attributeName="cy" values={`0;0;${TRI[i].y.toFixed(2)};${TRI[i].y.toFixed(2)};0`} keyTimes="0;0.429;0.629;0.8;1" dur={TOTAL_DUR} repeatCount="indefinite" />
                </>
              )}
            </circle>
          </g>
        ))}
      </svg>
    </div>
  );
}
