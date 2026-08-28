'use client';

/**
 * Donut — allocation chart. Trimmed from the full app's chart set down
 * to just the one this dashboard uses; see the main app's
 * components/charts.tsx for Spark/Area/BarTracks too.
 */
import { useState } from 'react';

export interface Slice { label: string; value: number }

const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];

export function Donut({
  slices, size = 172, thickness = 20, centerTop, centerSub,
}: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  centerTop?: string;
  centerSub?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const shown = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const total = shown.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const GAP = 2;

  let offset = 0;
  const arcs = shown.map((s, i) => {
    const len = (s.value / total) * circ;
    const a = { ...s, hue: SERIES[i % SERIES.length], dash: Math.max(0, len - GAP), offset, pct: s.value / total, i };
    offset += len;
    return a;
  });

  return (
    <div className="row g16" style={{ alignItems: 'center' }}>
      <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} role="img"
             aria-label={shown.map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`).join(', ')}>
          <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={thickness} />
          {arcs.map((a) => (
            <circle
              key={a.label} cx={c} cy={c} r={r} fill="none" stroke={a.hue}
              strokeWidth={hover === a.i ? thickness + 3 : thickness}
              strokeDasharray={`${a.dash} ${circ - a.dash}`}
              strokeDashoffset={-a.offset}
              strokeLinecap="butt"
              style={{ transition: 'stroke-width 160ms ease' }}
              onPointerEnter={() => setHover(a.i)}
              onPointerLeave={() => setHover(null)}
            />
          ))}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
          <div>
            <div className="figure-sm">{hover !== null ? `${Math.round(arcs[hover].pct * 100)}%` : centerTop}</div>
            <div className="sublabel">{hover !== null ? arcs[hover].label : centerSub}</div>
          </div>
        </div>
      </div>

      <div className="col g6 grow">
        {arcs.map((a) => (
          <div key={a.label} className="row g8" onPointerEnter={() => setHover(a.i)} onPointerLeave={() => setHover(null)}
               style={{ opacity: hover === null || hover === a.i ? 1 : 0.5, transition: 'opacity 140ms' }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: a.hue, flex: 'none' }} />
            <span className="sublabel grow truncate" style={{ color: 'var(--ink-2)' }}>{a.label}</span>
            <span className="tnum sublabel">{Math.round(a.pct * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
