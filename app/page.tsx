import { ACCOUNTS, NET_WORTH_PAISE, RECENT_EXPENSES, BUDGETS } from '@/lib/sample-data';
import { fmtINR, fmtCompact } from '@/lib/money';
import { Card, CardHead, Pill } from '@/components/ui';
import { Donut } from '@/components/charts';
import { IconWallet, IconArrowUpRight, IconArrowRight, IconBriefcase } from '@/components/icons';

const QUICK_ACTIONS = [
  { label: 'New Income', icon: <IconArrowUpRight /> },
  { label: 'New Expense', icon: <IconWallet /> },
  { label: 'New Transfer', icon: <IconArrowRight /> },
  { label: 'New Account', icon: <IconBriefcase /> },
];

function fmtDateLong(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function Home() {
  const accountSlices = ACCOUNTS.filter((a) => a.paise !== 0).map((a) => ({ label: a.name, value: Math.abs(a.paise) }));

  return (
    <div className="shell">
      <div className="topbar">
        <div className="page-title">Expense Tracker</div>
        <div className="page-sub">
          Sample dashboard — every number below is static demo data (lib/sample-data.ts), no database required.
        </div>
      </div>

      <div className="bento">
        <Card span={3}>
          <CardHead label="Quick Actions" />
          <div className="qa-list">
            {QUICK_ACTIONS.map((a) => (
              <span key={a.label} className="qa-btn">{a.icon}<span>{a.label}</span></span>
            ))}
          </div>
        </Card>

        <Card span={6} flush>
          <CardHead label="Recent Expenses" right={<Pill>{RECENT_EXPENSES.length} this week</Pill>} />
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Expense</th><th className="num">Amount</th><th>Account</th><th>Date</th><th>Category</th></tr>
              </thead>
              <tbody>
                {RECENT_EXPENSES.map((e) => (
                  <tr key={e.id}>
                    <td className="row-label">{e.label}</td>
                    <td className="num">{fmtINR(e.amountPaise)}</td>
                    <td>{e.account}</td>
                    <td>{fmtDateLong(e.date)}</td>
                    <td><span className="cat-dot" style={{ background: e.categoryColor }} />{e.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card span={3}>
          <CardHead label="Accounts" sub="Where the balance sits" />
          <div className="col" style={{ alignItems: 'center', justifyContent: 'center', flex: 1, paddingTop: 8 }}>
            <Donut slices={accountSlices} centerTop={fmtCompact(NET_WORTH_PAISE)} centerSub="Total Balance" />
          </div>
        </Card>

        <Card span={12}>
          <CardHead label="Budgets" sub="This month" />
          <div className="budget-grid" style={{ marginTop: 10 }}>
            {BUDGETS.map((b) => (
              <div className="budget-tile" key={b.label}>
                <span className="budget-name">{b.label}</span>
                <span className="budget-amt">{fmtCompact(b.paise)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
