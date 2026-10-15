import React from 'react';

/**
 * A small declarative 2D scene renderer shared by the physics labs.
 *
 * Everything a lab draws — trajectories, bodies, vectors, rays, field arrows, bands —
 * is described as data in world coordinates, and this component maps it into pixels.
 * Keeps each lab's view a short spec instead of a page of SVG.
 */

const TONES = {
  cyan: 'hsl(189 100% 50%)',
  cyanSoft: 'hsl(189 100% 50% / 0.35)',
  violet: 'hsl(265 85% 68%)',
  emerald: 'hsl(160 84% 52%)',
  amber: 'hsl(38 92% 55%)',
  rose: 'hsl(350 89% 60%)',
  muted: 'hsl(var(--muted-foreground))',
  foreground: 'hsl(var(--foreground))',
  border: 'hsl(var(--border))',
  card: 'hsl(var(--card))',
};

export const tone = (name) => TONES[name] || TONES.cyan;

const pointsOf = (list) => list.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

export default function Scene({
  width = 420,
  height = 260,
  xDomain = [0, 1],
  yDomain = [0, 1],
  pad = 26,
  xLabel,
  yLabel,
  grid = true,
  bands = [],
  polys = [],
  circles = [],
  series = [],
  arrows = [],
  markers = [],
  texts = [],
  field = null,
  ariaLabel = 'Simulation view',
}) {
  const [x0, x1] = xDomain;
  const [y0, y1] = yDomain;
  const spanX = x1 - x0 || 1;
  const spanY = y1 - y0 || 1;
  const px = (x) => pad + ((x - x0) / spanX) * (width - 2 * pad);
  const py = (y) => height - pad - ((y - y0) / spanY) * (height - 2 * pad);
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-xl bg-background/50" role="img" aria-label={ariaLabel}>
      {grid && (
        <g stroke={tone('border')} strokeWidth="0.6" opacity="0.7">
          {gridLines.map((t) => (
            <line key={`vx${t}`} x1={px(x0 + t * spanX)} y1={py(y0)} x2={px(x0 + t * spanX)} y2={py(y1)} />
          ))}
          {gridLines.map((t) => (
            <line key={`hy${t}`} x1={px(x0)} y1={py(y0 + t * spanY)} x2={px(x1)} y2={py(y0 + t * spanY)} />
          ))}
        </g>
      )}

      {bands.map((band, index) => (
        <g key={`band${index}`}>
          <rect
            x={band.x0 !== undefined ? px(band.x0) : px(x0)}
            y={band.y0 !== undefined ? py(band.y1) : py(y1)}
            width={px(band.x1 ?? x1) - px(band.x0 ?? x0)}
            height={py(band.y0 ?? y0) - py(band.y1 ?? y1)}
            fill={tone(band.tone || 'border')}
            opacity={band.opacity ?? 0.12}
          />
          {band.label && (
            <text x={px(band.x0 ?? x0) + 4} y={py(band.y1 ?? y1) + 11} fontSize="9" fill={tone('muted')}>{band.label}</text>
          )}
        </g>
      ))}

      {field && field.points.map((point, index) => {
        const scale = field.scale ?? 1;
        const dx = Math.cos(point.angle) * point.mag * scale;
        const dy = Math.sin(point.angle) * point.mag * scale;
        return (
          <g key={`f${index}`}>
            <line x1={px(point.x)} y1={py(point.y)} x2={px(point.x + dx)} y2={py(point.y + dy)} stroke={tone(point.tone || 'cyan')} strokeWidth={field.width ?? 1.2} opacity={0.75} />
            <circle cx={px(point.x + dx)} cy={py(point.y + dy)} r="1.4" fill={tone(point.tone || 'cyan')} opacity="0.9" />
          </g>
        );
      })}

      {polys.map((poly, index) => (
        poly.closed === false
          ? <polyline key={`p${index}`} points={pointsOf(poly.points)} fill="none" stroke={tone(poly.tone || 'border')} strokeWidth={poly.width ?? 1.5} strokeDasharray={poly.dashed ? '4 3' : undefined} opacity={poly.opacity ?? 1} />
          : <polygon key={`p${index}`} points={pointsOf(poly.points)} fill={tone(poly.fill || 'card')} fillOpacity={poly.fillOpacity ?? 0.65} stroke={tone(poly.tone || 'border')} strokeWidth={poly.width ?? 1.5} strokeDasharray={poly.dashed ? '4 3' : undefined} opacity={poly.opacity ?? 1} />
      ))}

      {circles.map((circle, index) => (
        <g key={`c${index}`}>
          <circle cx={px(circle.x)} cy={py(circle.y)} r={circle.r * (width - 2 * pad) / spanX} fill={tone(circle.fill || circle.tone || 'card')} fillOpacity={circle.fillOpacity ?? 0.8} stroke={tone(circle.tone || 'border')} strokeWidth={circle.width ?? 1.5} />
          {circle.label && <text x={px(circle.x)} y={py(circle.y) + 3} fontSize="9" textAnchor="middle" fill={tone('foreground')}>{circle.label}</text>}
        </g>
      ))}

      {series.map((line, index) => (
        <polyline
          key={`s${index}`}
          points={pointsOf(line.points)}
          fill={line.fill ? tone(line.fill) : 'none'}
          fillOpacity={line.fillOpacity ?? 0.18}
          stroke={tone(line.tone || 'cyan')}
          strokeWidth={line.width ?? 2}
          strokeDasharray={line.dashed ? '5 4' : undefined}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={line.opacity ?? 1}
        />
      ))}

      {arrows.map((arrow, index) => (
        <g key={`a${index}`}>
          <line
            x1={px(arrow.x)}
            y1={py(arrow.y)}
            x2={px(arrow.x + arrow.dx)}
            y2={py(arrow.y + arrow.dy)}
            stroke={tone(arrow.tone || 'cyan')}
            strokeWidth={arrow.width ?? 2}
            markerEnd={`url(#scene-head-${arrow.tone || 'cyan'})`}
          />
          {arrow.label && (
            <text x={px(arrow.x + arrow.dx * 1.08)} y={py(arrow.y + arrow.dy * 1.08)} fontSize="9" fill={tone(arrow.tone || 'cyan')}>{arrow.label}</text>
          )}
        </g>
      ))}

      {markers.map((marker, index) => (
        <g key={`m${index}`}>
          <circle cx={px(marker.x)} cy={py(marker.y)} r={marker.r ?? 3.2} fill={tone(marker.tone || 'cyan')} />
          {marker.label && (
            <text x={px(marker.x) + 6} y={py(marker.y) - 5} fontSize="9" fill={tone(marker.tone || 'cyan')}>{marker.label}</text>
          )}
        </g>
      ))}

      {texts.map((item, index) => (
        <text
          key={`t${index}`}
          x={px(item.x)}
          y={py(item.y)}
          fontSize={item.size ?? 9}
          textAnchor={item.anchor || 'start'}
          fill={tone(item.tone || 'muted')}
        >
          {item.text}
        </text>
      ))}

      {yLabel && <text x="6" y={pad - 8} fontSize="9" fill={tone('muted')}>{yLabel}</text>}
      {xLabel && <text x={width - pad - 46} y={height - 6} fontSize="9" fill={tone('muted')}>{xLabel}</text>}

      <defs>
        {Object.keys(TONES).map((name) => (
          <marker key={name} id={`scene-head-${name}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill={tone(name)} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}