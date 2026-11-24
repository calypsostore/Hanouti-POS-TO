import { lazy, Suspense, useEffect, useState } from 'react';
import { MaterialIcon } from '../components/MaterialIcon';
import { ListSkeleton } from '../components/ListSkeleton';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { PageHeader, SplitView } from '../components/layout';
import { t, type TranslationKey } from '../i18n/translations';
import { formatTnd } from '../lib/format';
import { reportService } from '../services/reportService';
import { useAuthStore } from '../stores/authStore';
import { userService } from '../services/userService';
import type { ReportRecord, StoreRecord } from '../types/domain';
import { ReportView } from '../components/ReportView';
import { useFocusRefreshKey } from '../lib/useFocusRefreshKey';

type DashboardSummary = Awaited<ReturnType<typeof reportService.getDashboard>>;
type InsightsData = Awaited<ReturnType<typeof reportService.getInsights>>;
type Period = 'day' | 'week' | 'month' | 'year';
type InsightRange = 'today' | 'yesterday' | 'last7' | 'last30' | 'month' | 'custom';
const ReportSalesByDayChart = lazy(() => import('../components/PerformanceCharts').then((module) => ({ default: module.ReportSalesByDayChart })));
const ReportSalesByHourChart = lazy(() => import('../components/PerformanceCharts').then((module) => ({ default: module.ReportSalesByHourChart })));
const periodLabels: Record<Period, TranslationKey> = {
  day: 'owner.today',
  week: 'owner.week',
  month: 'owner.month',
  year: 'owner.year',
};
const emptySummary: DashboardSummary = {
  salesMillimes: 0, orderCount: 0, cashDifferenceMillimes: 0, topItems: {}, shifts: [],
  salesCollectedMillimes: 0, expensesMillimes: 0, netProfitMillimes: 0, receivableMillimes: 0,
  tabsOutstandingMillimes: 0, salesByCategory: [], itemsSold: [], voids: { count: 0, totalMillimes: 0, orders: [] },
  pendingVoids: { count: 0, totalMillimes: 0, orders: [] },
  voidAdjustments: [], expenseDetails: [],
  comps: { count: 0, quantity: 0, totalMillimes: 0, records: [] },
  shiftLines: [], paymentSplit: { cash: 0, card: 0, other: 0, tab: 0 }, totalExpectedCashMillimes: 0,
  totalCountedMillimes: 0, totalDifferenceMillimes: 0, cashSalesMillimes: 0, tabSalesMillimes: 0,
  tabPaymentsReceivedMillimes: 0, cashFloatMillimes: 0, expectedCashExFloatMillimes: 0,
  nonCashTabPaymentsMillimes: 0, cashOuts: [], customerTabs: [],
  cardTabPaymentsMillimes: 0, otherTabPaymentsMillimes: 0,
  firstTicketNumber: undefined, lastTicketNumber: undefined, cashInMillimes: 0, cashOutMillimes: 0,
  cashRefundsMillimes: 0,
  ambiguousTabReversalIds: [],
  unresolvedTabReversals: [],
  cashMovements: [], employeeBreakdown: [],
  tabsIssuedMillimes: 0, tabsSettledMillimes: 0,
  salesByDay: [], salesByHour: [], salesTodayMillimes: 0, salesLastWeekMillimes: 0, recentOrders: [],
};

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDateKey(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function shiftDateKey(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKeyInTimezone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function startOfDateKeyInTimezone(dateKeyValue: string, timeZone: string): number {
  const [year, month, day] = dateKeyValue.split('-').map(Number);
  const targetMidnight = Date.UTC(year, month - 1, day);
  let timestamp = targetMidnight;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const represented = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    const correction = targetMidnight - represented;
    timestamp += correction;
    if (correction === 0) break;
  }
  return timestamp;
}

function getInsightRange(
  range: InsightRange,
  customFrom: string,
  customTo: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): { from: number; to: number } | null {
  const today = dateKeyInTimezone(new Date(), timeZone);
  let from = today;
  let to = today;
  if (range === 'yesterday') from = to = shiftDateKey(today, -1);
  if (range === 'last7') from = shiftDateKey(today, -6);
  if (range === 'last30') from = shiftDateKey(today, -29);
  if (range === 'month') from = `${today.slice(0, 7)}-01`;
  if (range === 'custom') {
    if (!validDateKey(customFrom) || !validDateKey(customTo) || customFrom > customTo) return null;
    from = customFrom;
    to = customTo;
  }
  return {
    from: startOfDateKeyInTimezone(from, timeZone),
    to: startOfDateKeyInTimezone(shiftDateKey(to, 1), timeZone),
  };
}

function OwnerReportsContent() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const refreshKey = useFocusRefreshKey();
  const routeParams = new URLSearchParams(window.location.search);
  const routeFrom = routeParams.get('from');
  const routeTo = routeParams.get('to');
  const routeReportId = routeParams.get('reportId');
  const hasRouteRange = validDateKey(routeFrom) && validDateKey(routeTo) && routeFrom <= routeTo;
  const [store, setStore] = useState<StoreRecord>();
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveSummary, setLiveSummary] = useState<DashboardSummary>(emptySummary);
  const [selectedReport, setSelectedReport] = useState<ReportRecord | null>(null);
  const [period, setPeriod] = useState<Period>('day');
  const [insightRangeType, setInsightRangeType] = useState<InsightRange>(hasRouteRange ? 'custom' : 'today');
  const [customFrom, setCustomFrom] = useState(() => hasRouteRange ? routeFrom ?? dateKey(new Date()) : dateKey(new Date()));
  const [customTo, setCustomTo] = useState(() => hasRouteRange ? routeTo ?? dateKey(new Date()) : dateKey(new Date()));
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [insightsError, setInsightsError] = useState('');
  const [error, setError] = useState('');
  const insightRange = getInsightRange(insightRangeType, customFrom, customTo, store?.timezone);
  const insightFrom = insightRange?.from;
  const insightTo = insightRange?.to;

  useEffect(() => {
    if (!routeReportId) return;
    const report = reports.find((candidate) => candidate.id === routeReportId);
    if (report) setSelectedReport(report);
  }, [reports, routeReportId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    if (insightFrom === undefined || insightTo === undefined) {
      setInsights(null);
      setInsightsError('Choose an end date on or after the start date.');
    } else {
      setInsightsError('');
    }
    void Promise.all([
      reportService.listReports(storeId),
      reportService.getDashboard(storeId, period),
      reportService.getCurrentPeriodSummary(storeId),
      userService.getStore(storeId),
      insightFrom !== undefined && insightTo !== undefined
        ? reportService.getInsights(storeId, insightFrom, insightTo)
        : Promise.resolve(null),
    ]).then(([nextReports, nextSummary, _nextReportingSummary, nextStore, nextInsights]) => {
      if (!active) return;
      setReports(nextReports);
      setLiveSummary(nextSummary);
      setStore(nextStore);
      setInsights(nextInsights);
    }).catch((loadError: unknown) => {
      console.error('Unable to load reports.', loadError);
      if (active) setError(t('common.loadFailed'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [customFrom, customTo, insightFrom, insightTo, insightRangeType, period, refreshKey, storeId]);

  return (
    <WorkspaceLayout title={t('reports.title')} storeName={store?.name} links={ownerWorkspaceLinks}>
      <PageHeader title={t('reports.title')} subtitle="X reports are live snapshots. Z reports close the current reporting period." />

      <section className="mb-4 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-headline-md text-on-surface">Financial summary</h2>
          <div className="flex gap-1 rounded-xl bg-surface-container-high p-1">
            {(['day', 'week', 'month', 'year'] as Period[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
                className={`min-h-10 rounded-lg px-3 font-body text-label-sm ${period === value ? 'bg-primary text-on-primary shadow-card' : 'text-on-surface-variant'}`}
              >
                {t(periodLabels[value])}
              </button>
            ))}
          </div>
        </div>
        <FinanceSummary summary={liveSummary} />
        <p className="mt-3 font-body text-body-xs text-on-surface-variant">{t('finance.salesHelp')} {t('finance.receivableHelp')}</p>
      </section>

      <section aria-labelledby="insights-title" className="mb-6 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
        <div className="mb-4">
          <h2 id="insights-title" className="font-display text-headline-md text-on-surface">Insights</h2>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">Explore sales, staff performance, and profitability.</p>
        </div>
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-surface-container-high p-1">
          {([
            ['today', 'Today'],
            ['yesterday', 'Yesterday'],
            ['last7', 'Last 7 days'],
            ['last30', 'Last 30 days'],
            ['month', 'Month'],
            ['custom', 'Custom'],
          ] as [InsightRange, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={insightRangeType === value}
              onClick={() => setInsightRangeType(value)}
              className={`min-h-10 rounded-lg px-3 font-body text-label-sm ${insightRangeType === value ? 'bg-primary text-on-primary shadow-card' : 'text-on-surface-variant'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {insightRangeType === 'custom' && (
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <label className="font-body text-label-md text-on-surface">From
              <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
            </label>
            <label className="font-body text-label-md text-on-surface">To
              <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
            </label>
          </div>
        )}
        {insightsError && <p role="alert" className="mb-4 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{insightsError}</p>}
        {insights && (
          <div className="flex flex-col gap-3">
            <article className="rounded-xl bg-surface-container-low p-3">
              <h3 className="font-display text-title-md text-on-surface">Sales by day</h3>
              <div className="mt-3 h-56 min-w-0">
                <Suspense fallback={<div className="h-full" aria-hidden="true" />}>
                  <ReportSalesByDayChart data={insights.salesByDay.map((day) => ({
                    ...day,
                    label: new Date(`${day.date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }),
                    sales: day.salesMillimes / 1000,
                  }))} />
                </Suspense>
              </div>
            </article>

            <div className="grid gap-3 lg:grid-cols-2">
              <article className="min-w-0 rounded-xl bg-surface-container-low p-3">
                <h3 className="font-display text-title-md text-on-surface">Sales by hour</h3>
                <div className="mt-3 h-56">
                  <Suspense fallback={<div className="h-full" aria-hidden="true" />}>
                    <ReportSalesByHourChart data={insights.salesByHour.map((hour) => ({
                      hour: hour.hour,
                      sales: hour.salesMillimes / 1000,
                    }))} />
                  </Suspense>
                </div>
              </article>
              <RankedSales title="Sales by staff" items={insights.salesByStaff.map((member) => ({ name: member.name, salesMillimes: member.salesMillimes }))} />
            </div>

            <RankedSales title="Sales by category" items={insights.salesByCategory.map((category) => ({ name: category.name, salesMillimes: category.totalMillimes }))} />

            <article className="rounded-xl bg-surface-container-low p-3">
              <h3 className="mb-3 font-display text-title-md text-on-surface">Staff performance</h3>
              <div className="flex flex-col gap-2 sm:hidden">
                {loading ? <ListSkeleton rows={2} label="Loading staff performance" /> : insights.staffPerformance.map((member) => (
                  <StaffPerformanceCard key={member.staffId} member={member} />
                ))}
                {!loading && !error && insights.staffPerformance.length === 0 && <p className="rounded-lg bg-surface-container-lowest p-3 font-body text-body-sm text-outline">{t('common.noData')}</p>}
              </div>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[680px] text-left font-body text-body-sm">
                  <thead><tr className="border-b border-outline-variant text-label-sm text-on-surface-variant">
                    <th className="px-2 py-2">Staff</th><th className="px-2 py-2">Orders</th><th className="px-2 py-2">Sales</th><th className="px-2 py-2">Average order</th><th className="px-2 py-2">Voids</th><th className="px-2 py-2">Comps</th><th className="px-2 py-2">Cash difference</th>
                  </tr></thead>
                  <tbody>{insights.staffPerformance.map((member) => (
                    <tr key={member.staffId} className="border-b border-outline-variant/50 last:border-0">
                      <td className="px-2 py-3 font-medium text-on-surface">{member.name}</td><td className="px-2 py-3 tabular-nums">{member.orders}</td><td className="px-2 py-3 tabular-nums">{formatTnd(member.salesMillimes / 1000)} DT</td><td className="px-2 py-3 tabular-nums">{formatTnd(member.averageOrderMillimes / 1000)} DT</td><td className="px-2 py-3 tabular-nums">{member.voids}</td><td className="px-2 py-3 tabular-nums">{formatTnd(member.compsMillimes / 1000)} DT</td><td className="px-2 py-3 tabular-nums">{formatSignedTnd(member.cashDifferenceMillimes)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {insights.staffPerformance.length === 0 && <p className="py-3 font-body text-body-sm text-outline">{t('common.noData')}</p>}
              </div>
            </article>

            <div className="grid gap-3 sm:grid-cols-2">
              <article className="rounded-xl bg-surface-container-low p-3">
                <h3 className="font-display text-title-md text-on-surface">Today vs same weekday last week</h3>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <ComparisonValue label="Today" sales={insights.dayComparison.today.salesMillimes} orders={insights.dayComparison.today.orderCount} />
                  <ComparisonValue label="Last week" sales={insights.dayComparison.lastWeek.salesMillimes} orders={insights.dayComparison.lastWeek.orderCount} />
                </div>
              </article>
              <div className="grid grid-cols-2 gap-2">
                <InsightMetric label="Waste and comps" value={insights.compsMillimes} />
                <InsightMetric label="Expenses" value={insights.expensesMillimes} />
                <InsightMetric label="Net profit" value={insights.netProfitMillimes} emphasized />
                <InsightMetric label="Sales collected" value={insights.salesCollectedMillimes} />
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <h2 className="font-display text-headline-sm">X / Z reports moved to Shifts</h2>
          <p className="mt-2 font-body text-body-sm text-outline">Create live X reports, count and close the day with Z, and browse the daily archive.</p>
          <a href="/owner/shifts" className="mt-4 inline-flex h-11 items-center rounded-xl bg-primary px-4 font-body text-label-lg text-on-primary">Open Shift reports</a>
        </article>
      </section>

      {error && <p role="alert" className="mt-4 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}

      <SplitView className="reports-split-view mt-6" list={
        <section>
          <h2 className="mb-3 font-display text-headline-md text-on-surface">Report history</h2>
          <div className="flex flex-col gap-2">
            {loading ? <ListSkeleton label="Loading report history" /> : reports.map((report) => (
              <button type="button" key={report.id} aria-pressed={selectedReport?.id === report.id} onClick={() => setSelectedReport(report)} className={`flex items-center justify-between gap-3 rounded-xl p-4 text-left shadow-card ${selectedReport?.id === report.id ? 'bg-primary-fixed/50' : 'bg-surface-container-lowest'}`}>
                <div><p className="font-body text-label-md text-on-surface">{report.type} report • {report.businessDate}</p><p className="mt-1 font-body text-body-sm text-outline">{new Date(report.createdAt).toLocaleString()} • {report.orderCount} orders • Sales {formatTnd((report.salesCollectedMillimes ?? report.salesMillimes) / 1000)} DT • Expenses {formatTnd((report.expensesMillimes ?? 0) / 1000)} DT • Net {formatTnd((report.netProfitMillimes ?? 0) / 1000)} DT</p></div>
                <span className="flex items-center gap-2"><StatusTag status={report.type === 'Z' ? 'closed' : 'open'}>{report.type}</StatusTag><MaterialIcon name="open_in_new" /></span>
              </button>
            ))}
            {!loading && !error && reports.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
          </div>
        </section>
      } detail={
        selectedReport
          ? <ReportView inline report={selectedReport} store={store} settings={store?.settings} storeName={store?.name ?? ''} onClose={() => setSelectedReport(null)} />
          : <p className="rounded-xl bg-surface-container-lowest p-6 font-body text-body-sm text-on-surface-variant">Select a report to preview it here.</p>
      } />
      {selectedReport && <div className="reports-mobile-preview"><ReportView report={selectedReport} store={store} settings={store?.settings} storeName={store?.name ?? ''} onClose={() => setSelectedReport(null)} /></div>}
    </WorkspaceLayout>
  );
}


function FinanceSummary({ summary }: { summary: DashboardSummary }) {
  const values = [
    { label: t('finance.sales'), value: summary.salesCollectedMillimes, tone: 'text-primary' },
    { label: t('finance.expenses'), value: summary.expensesMillimes, tone: 'text-error-dark' },
    { label: t('finance.netProfit'), value: summary.netProfitMillimes, tone: summary.netProfitMillimes < 0 ? 'text-error-dark' : 'text-success-dark' },
    { label: t('finance.receivable'), value: summary.receivableMillimes, tone: 'text-on-surface' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 tablet:grid-cols-4">
      {values.map((item) => (
        <article key={item.label} className="rounded-xl bg-surface-container-low p-3">
          <p className="font-body text-label-sm text-on-surface-variant">{item.label}</p>
          <p className={`mt-1 font-display text-title-md tabular-nums ${item.tone}`}>{formatTnd(item.value / 1000)} DT</p>
        </article>
      ))}
    </div>
  );
}

function formatSignedTnd(amountMillimes: number): string {
  const sign = amountMillimes > 0 ? '+' : amountMillimes < 0 ? '-' : '';
  return `${sign}${formatTnd(Math.abs(amountMillimes) / 1000)} DT`;
}

function RankedSales({ title, items }: { title: string; items: { name: string; salesMillimes: number }[] }) {
  const maxSales = Math.max(0, ...items.map((item) => item.salesMillimes));
  return (
    <article className="rounded-xl bg-surface-container-low p-3">
      <h3 className="mb-3 font-display text-title-md text-on-surface">{title}</h3>
      {items.length ? (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.name} className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="truncate font-body text-label-md text-on-surface">{item.name}</span>
                <span className="shrink-0 font-body text-label-sm tabular-nums text-on-surface-variant">{formatTnd(item.salesMillimes / 1000)} DT</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-container-high">
                <div className="h-full rounded-full bg-primary" style={{ width: `${maxSales ? item.salesMillimes / maxSales * 100 : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="rounded-lg bg-surface-container-lowest p-3 font-body text-body-sm text-outline">{t('common.noData')}</p>}
    </article>
  );
}

function StaffPerformanceCard({ member }: { member: InsightsData['staffPerformance'][number] }) {
  const metrics = [
    { label: 'Orders', value: member.orders.toLocaleString() },
    { label: 'Average order', value: `${formatTnd(member.averageOrderMillimes / 1000)} DT` },
    { label: 'Voids', value: member.voids.toLocaleString() },
    { label: 'Comps', value: `${formatTnd(member.compsMillimes / 1000)} DT` },
    { label: 'Cash difference', value: formatSignedTnd(member.cashDifferenceMillimes) },
  ];
  return (
    <article className="rounded-lg bg-surface-container-lowest p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="truncate font-body text-label-lg text-on-surface">{member.name}</h4>
        <strong className="shrink-0 font-display text-title-md tabular-nums text-primary">{formatTnd(member.salesMillimes / 1000)} DT</strong>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt className="font-body text-label-sm text-outline">{metric.label}</dt>
            <dd className="font-body text-body-sm tabular-nums text-on-surface">{metric.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function ComparisonValue({ label, sales, orders }: { label: string; sales: number; orders: number }) {
  return (
    <div className="rounded-lg bg-surface-container-lowest p-3">
      <p className="font-body text-label-sm text-outline">{label}</p>
      <p className="mt-1 font-display text-title-md tabular-nums text-primary">{formatTnd(sales / 1000)} DT</p>
      <p className="mt-1 font-body text-body-sm text-on-surface-variant">{orders} orders</p>
    </div>
  );
}

function InsightMetric({ label, value, emphasized = false }: { label: string; value: number; emphasized?: boolean }) {
  return (
    <article className="rounded-xl bg-surface-container-low p-3">
      <p className="font-body text-label-sm text-on-surface-variant">{label}</p>
      <p className={`mt-1 break-words font-display text-title-md tabular-nums ${emphasized ? value < 0 ? 'text-error-dark' : 'text-success-dark' : 'text-on-surface'}`}>
        {formatTnd(value / 1000)} DT
      </p>
    </article>
  );
}

export function OwnerReportsScreen() {
  return <OwnerReportsContent />;
}
