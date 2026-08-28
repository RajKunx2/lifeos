import type { SVGProps } from 'react';

const base = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};
type P = SVGProps<SVGSVGElement>;
const mk = (path: React.ReactNode) => (p: P) => <svg {...base} {...p}>{path}</svg>;

export const IconWallet = mk(<><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5v-8Z"/><path d="M3 9h13.5"/><circle cx="17" cy="13.5" r="1.2" fill="currentColor" stroke="none"/></>);
export const IconArrowUpRight = mk(<><path d="M7 17 17 7"/><path d="M8.5 7H17v8.5"/></>);
export const IconArrowRight = mk(<><path d="M4.5 12h15"/><path d="M13.5 6l6 6-6 6"/></>);
export const IconBriefcase = mk(<><rect x="2.5" y="7.5" width="19" height="12" rx="2.5"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/><path d="M2.5 12.5h19"/></>);
