import type { ReactNode } from 'react';

export function Card({
  children, span, flush, className = '',
}: { children?: ReactNode; span?: 3 | 4 | 5 | 6 | 7 | 9 | 12; flush?: boolean; className?: string }) {
  const cls = ['card', span ? `c${span}` : '', flush ? 'flush' : '', className].filter(Boolean).join(' ');
  return <div className={cls}>{children}</div>;
}

export function CardHead({
  label, sub, right,
}: { label?: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="card-head">
      <div className="col">
        {label && <div className="label">{label}</div>}
        {sub && <div className="sublabel">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Pill({
  children, tone = 'flat',
}: { children: ReactNode; tone?: 'flat' | 'pos' | 'warn' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
