/*
 * The electron shells of one atom, drawn.
 *
 * NOT the user's own file — theirs is not in any extracted archive. Written from the one call site, which passes
 * `atomicNumber` and a `color`.
 *
 * The shell occupancies are computed, not tabulated: electrons are filled in the standard subshell order and
 * then counted per principal shell. That is the Madelung order, so it gives the textbook shell picture, and it
 * is honest about where it is wrong — a handful of transition metals (chromium, copper and their groups) really
 * fill differently, and the drawing says so rather than showing a wrong picture as if it were right.
 */
import React from 'react';

/** Subshells in filling order, with how many electrons each holds. */
const ORDER = [
  ['1s', 1, 2], ['2s', 2, 2], ['2p', 2, 6], ['3s', 3, 2], ['3p', 3, 6], ['4s', 4, 2],
  ['3d', 3, 10], ['4p', 4, 6], ['5s', 5, 2], ['4d', 4, 10], ['5p', 5, 6], ['6s', 6, 2],
  ['4f', 4, 14], ['5d', 5, 10], ['6p', 6, 6], ['7s', 7, 2], ['5f', 5, 14], ['6d', 6, 10], ['7p', 7, 6]
];

/** The elements whose real filling is not the plain order, so the drawing can say so. */
const EXCEPTIONS = new Set([24, 29, 41, 42, 44, 45, 46, 47, 57, 58, 64, 78, 79, 89, 90, 91, 92, 93, 96]);

function shellsFor(z) {
  const perShell = [];
  let left = z;
  for (const [, shell, holds] of ORDER) {
    if (left <= 0) break;
    const put = Math.min(holds, left);
    perShell[shell - 1] = (perShell[shell - 1] ?? 0) + put;
    left -= put;
  }
  return perShell.filter((n) => n > 0);
}

export default function ShellDiagram({ atomicNumber, color = '#22d3ee' }) {
  const z = Number(atomicNumber);
  if (!Number.isFinite(z) || z < 1) return null;
  const shells = shellsFor(z);
  const size = 186;
  const middle = size / 2;
  const gap = (middle - 20) / Math.max(1, shells.length);

  return (
    <div className="flex flex-col items-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Electron shells for element ${z}: ${shells.join(', ')}`}
      >
        {shells.map((count, i) => {
          const r = 18 + (i + 1) * gap;
          return (
            <g key={i}>
              <circle cx={middle} cy={middle} r={r} fill="none" stroke={color} strokeOpacity="0.3" strokeWidth="1" />
              {Array.from({ length: count }, (_, k) => {
                const turn = (k / count) * Math.PI * 2 - Math.PI / 2;
                return (
                  <circle
                    key={k}
                    cx={middle + r * Math.cos(turn)}
                    cy={middle + r * Math.sin(turn)}
                    r="2.3"
                    fill={color}
                  />
                );
              })}
            </g>
          );
        })}
        <circle cx={middle} cy={middle} r="13" fill={color} fillOpacity="0.16" stroke={color} strokeOpacity="0.5" />
        <text
          x={middle}
          y={middle + 4}
          textAnchor="middle"
          fill={color}
          style={{ fontSize: 11, fontWeight: 700 }}
        >
          {z}
        </text>
      </svg>
      <div className="mt-1 font-mono-j text-[11px] text-muted-foreground">{shells.join(' · ')}</div>
      {EXCEPTIONS.has(z) && (
        <div className="mt-1 max-w-[200px] text-center text-[10px] text-muted-foreground/80">
          This element really fills its shells in a different order from the usual one, so take the outer shell
          here as the simple picture rather than the measured one.
        </div>
      )}
    </div>
  );
}
