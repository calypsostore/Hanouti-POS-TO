import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusTag } from '../components/StatusTag';
import { ownerWorkspaceLinks } from '../app/navigation';
import { t, type TranslationKey } from '../i18n/translations';
import { formatTnd } from '../lib/format';
import { reportService } from '../services/reportService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import type { ShiftRecord, StoreRecord } from '../types/domain';

type Period = 'day' | 'week' | 'month' | 'year';

const periodLabels: Record<Period, TranslationKey> = {
  day: 'owner.today',
  week: 'owner.week',
  month: 'owner.month',
  year: 'owner.year',
};

type DashboardSummary = Awaited<ReturnType<typeof reportService.getDashboard>>;

const emptySummary: DashboardSummary = {
  salesMillimes: 0,
  orderCount: 0,
  cashDifferenceMillimes: 0,
  topItems: {},
  shifts: [],
  tabsOutstandingMillimes: 0,
  salesByCategory: [],
  itemsSold: [],
  voids: { count: 0, totalMillimes: 0, orders: [] },
  shiftLines: [],
  paymentSplit: { cash: 0, card: 0, other: 0, tab: 0 },
  totalExpectedCashMillimes: 0,
  totalCountedMillimes: 0,
  totalDifferenceMillimes: 0,
  tabsIssuedMillimes: 0,
  tabsSettledMillimes: 0,
};

function OwnerDashboardContent() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [store, setStore] = useState<StoreRecord>();
  const [period, setPeriod] = useState<Period>('day');
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);

  useEffect(() => {
    void Promise.all([reportService.getDashboard(storeId, 'day'), userService.getStore(storeId)])
      .then(([nextSummary, nextStore]) => {
        setSummary(nextSummary);
        setStore(nextStore);
      })
      .catch((loadError: unknown) => console.error('Unable to load owner dashboard.', loadError));
  }, [storeId]);

  async function selectPeriod(nextPeriod: Period) {
    setPeriod(nextPeriod);
    setSummary(await reportService.getDashboard(storeId, nextPeriod));
  }

  const topItems = Object.entries(summary.topItems)
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);
  const closedShifts = summary.shifts.filter((shift) => shift.status === 'closed');
  const openShifts = summary.shifts.filter((shift) => shift.status === 'open');

  return (
    <WorkspaceLayout title={t('owner.dashboard')} storeName={store?.name} links={ownerWorkspaceLinks}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-headline-lg text-on-surface">{t('owner.dashboard')}</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">{store?.name}</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-surface-container-high p-1">
          {(Object.keys(periodLabels) as Period[]).map((value) => (
            <button key={value} type="button" onClick={() => selectPeriod(value)} className={`min-h-10 rounded-lg px-3 font-body text-label-sm ${period === value ? 'bg-primary text-on-primary shadow-card' : 'text-on-surface-variant'}`}>
              {t(periodLabels[value])}
            </button>
          ))}
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard icon="payments" label={t('owner.sales')} value={`${formatTnd(summary.salesMillimes / 1000)} DT`} tone="primary" />
        <SummaryCard icon="receipt_long" label={t('owner.orderCount')} value={String(summary.orderCount)} tone="success" />
        <SummaryCard icon="schedule" label="Open shifts" value={String(openShifts.length)} tone="warning" />
        <SummaryCard icon="account_balance" label={t('owner.cashDifferences')} value={`${formatTnd(summary.cashDifferenceMillimes / 1000)} DT`} tone="error" />
        <SummaryCard icon="account_balance_wallet" label="Outstanding tabs" value={`${formatTnd(summary.tabsOutstandingMillimes / 1000)} DT`} tone="warning" />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <h2 className="mb-4 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="trending_up" className="text-primary" />{t('owner.topItems')}</h2>
          {topItems.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topItems} margin={{ left: 0, right: 12, top: 8, bottom: 8 }}>
                  <CartesianGrid stroke="#E1ECEE" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="quantity" name="Units sold" fill="#0F5F6E" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
        </article>

        <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <h2 className="mb-4 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="payments" className="text-primary" />{t('owner.shiftSummary')}</h2>
          <div className="flex flex-col gap-2">
            {summary.shifts.map((shift) => (
              <ShiftSummary key={shift.id} shift={shift} />
            ))}
            {summary.shifts.length === 0 && <p className="rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-outline-variant pt-3 font-body text-body-sm">
            <span className="text-on-surface-variant">Closed shifts: {closedShifts.length}</span>
            <span className="font-semibold text-on-surface">Open shifts: {openShifts.length}</span>
          </div>
        </article>
      </section>
    </WorkspaceLayout>
  );
}

function SummaryCard({ icon, label, value, tone }: { icon: string; label: string; value: string; tone: 'primary' | 'success' | 'warning' | 'error' }) {
  const tones = {
    primary: 'bg-primary-fixed/40 text-primary',
    success: 'bg-success-container text-on-success-container',
    warning: 'bg-warning-container text-on-warning-container',
    error: 'bg-error-container text-on-error-container',
  };
  return (
    <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}><MaterialIcon name={icon} /></span>
      <p className="mt-3 font-body text-body-sm text-on-surface-variant">{label}</p>
      <p className="mt-1 font-display text-headline-md tabular-nums text-on-surface">{value}</p>
    </article>
  );
}

function ShiftSummary({ shift }: { shift: ShiftRecord }) {
  const [staffName, setStaffName] = useState('Staff');
  useEffect(() => {
    void userService.getUser(shift.staffId).then((staff) => setStaffName(staff?.name ?? 'Staff'));
  }, [shift.staffId]);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-low p-3">
      <div>
        <p className="font-body text-label-md text-on-surface">{staffName}</p>
        <p className="mt-1 font-body text-body-sm text-outline">{new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
      </div>
      <div className="text-right">
        <StatusTag status={shift.status === 'open' ? 'started' : 'closed'}>{shift.status === 'open' ? 'Started' : 'Closed'}</StatusTag>
        {shift.differenceMillimes !== undefined && <p className="mt-1 font-body text-label-sm tabular-nums text-on-surface-variant">{t('shift.difference')}: {formatTnd(shift.differenceMillimes / 1000)} DT</p>}
      </div>
    </div>
  );
}

export function OwnerDashboardScreen() {
  return <OwnerDashboardContent />;
}
