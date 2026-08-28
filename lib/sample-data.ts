/**
 * Static sample data for the dashboard — no database, no API keys, and
 * no real accounts. Every name, balance, and transaction here is made
 * up for demonstration purposes.
 *
 * In the real app this same shape comes from MongoDB (see lib/db.ts and
 * the pipeline under app/api/gmail/ + lib/email-parser.ts), but the
 * dashboard itself doesn't need to know or care where it came from.
 */

export interface AccountBalance {
  name: string;
  paise: number;   // positive for assets, negative for card dues
}

export const ACCOUNTS: AccountBalance[] = [
  { name: 'Meridian Bank Savings',   paise: 18_642_900 },
  { name: 'Horizon Mutual Fund',     paise: 3_119_400 },
  { name: 'Bluepeak Broking',        paise: 2_247_650 },
  { name: 'Meridian Platinum Card',  paise: -3_384_200 },
  { name: 'Northfield Rewards Card', paise: -1_876_150 },
];

export const NET_WORTH_PAISE = ACCOUNTS.reduce((s, a) => s + a.paise, 0);

export interface Expense {
  id: string;
  label: string;
  amountPaise: number;
  account: string;
  date: string;
  category: string;
  categoryColor: string;
  source: 'email';
}

export const RECENT_EXPENSES: Expense[] = [
  { id: 'e1', label: 'Swiggy', amountPaise: 58700, account: 'Meridian Platinum Card', date: '2026-08-27', category: 'Food', categoryColor: 'var(--s1)', source: 'email' },
  { id: 'e2', label: 'Uber', amountPaise: 31200, account: 'Northfield Rewards Card', date: '2026-08-27', category: 'Transport', categoryColor: 'var(--s2)', source: 'email' },
  { id: 'e3', label: 'Amazon', amountPaise: 214500, account: 'Meridian Platinum Card', date: '2026-08-26', category: 'Shopping', categoryColor: 'var(--s3)', source: 'email' },
  { id: 'e4', label: 'Riverbend Trust', amountPaise: 300000, account: 'Meridian Bank Savings', date: '2026-08-25', category: 'Donation', categoryColor: 'var(--s4)', source: 'email' },
  { id: 'e5', label: 'FitZone Gym', amountPaise: 129900, account: 'Northfield Rewards Card', date: '2026-08-24', category: 'Fitness', categoryColor: 'var(--s5)', source: 'email' },
  { id: 'e6', label: 'City Power Co.', amountPaise: 194000, account: 'Meridian Bank Savings', date: '2026-08-23', category: 'Utilities', categoryColor: 'var(--s6)', source: 'email' },
];

export interface Budget { label: string; paise: number }

export const BUDGETS: Budget[] = [
  { label: 'Food', paise: 1_200_000 },
  { label: 'Transport', paise: 500_000 },
  { label: 'Shopping', paise: 1_800_000 },
  { label: 'Fitness', paise: 200_000 },
];
