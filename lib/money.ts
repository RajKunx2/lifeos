/** Money is always paise (integer), never float rupees. */
export type Paise = number;

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function fmtINR(paise: Paise): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: rupees % 1 === 0 ? 0 : 2,
  }).format(rupees);
}

/** ₹68.3K / ₹1.9L / ₹3.2Cr — the compact Indian-numbering form used on cards. */
export function fmtCompact(paise: Paise): string {
  const r = Math.abs(paise) / 100;
  const sign = paise < 0 ? '-' : '';
  if (r >= 1e7) return `${sign}₹${(r / 1e7).toFixed(r / 1e7 >= 10 ? 1 : 2)}Cr`;
  if (r >= 1e5) return `${sign}₹${(r / 1e5).toFixed(r / 1e5 >= 10 ? 1 : 2)}L`;
  if (r >= 1e3) return `${sign}₹${(r / 1e3).toFixed(r / 1e3 >= 10 ? 1 : 2)}K`;
  return `${sign}₹${Math.round(r)}`;
}
