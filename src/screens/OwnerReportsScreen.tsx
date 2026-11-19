import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { t, type TranslationKey } from '../i18n/translations';
import { formatTnd } from '../lib/format';
import { reportService } from '../services/reportService';
import { shiftService } from '../services/shiftService';
import { useAuthStore } from '../stores/authStore';
import { userService } from '../services/userService';
import type { ReportRecord, ShiftRecord, StoreRecord } from '../types/domain';
import { ReportView } from '../components/ReportView';

type DashboardSummary = Awaited<ReturnType<typeof reportService.getDashboard>>;
type Period = 'day' | 'week' | 'month' | 'year';
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
  comps: { count: 0, quantity: 0, totalMillimes: 0, records: [] },
  shiftLines: [], paymentSplit: { cash: 0, card: 0, other: 0, tab: 0 }, totalExpectedCashMillimes: 0,
  totalCountedMillimes: 0, totalDifferenceMillimes: 0, cashSalesMillimes: 0, tabSalesMillimes: 0,
  tabPaymentsReceivedMillimes: 0, cashFloatMillimes: 0, cashOuts: [], customerTabs: [],
  tabsIssuedMillimes: 0, tabsSettledMillimes: 0,
};

function OwnerReportsContent() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [store, setStore] = useState<StoreRecord>();
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [openShifts, setOpenShifts] = useState<ShiftRecord[]>([]);
  const [liveSummary, setLiveSummary] = useState<DashboardSummary>(emptySummary);
  const [reportingSummary, setReportingSummary] = useState<DashboardSummary>(emptySummary);
  const [latestReport, setLatestReport] = useState<ReportRecord | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportRecord | null>(null);
  const [period, setPeriod] = useState<Period>('day');
  const [ownerPin, setOwnerPin] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const date = new Date();
  const businessDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const dayClosed = store?.dayClosedOn === businessDate;
  const zBlocked = openShifts.length > 0;

  useEffect(() => {
    void Promise.all([
      reportService.listReports(storeId),
      shiftService.listOpenShifts(storeId),
      reportService.getDashboard(storeId, period),
      reportService.getCurrentPeriodSummary(storeId),
      userService.getStore(storeId),
    ]).then(([nextReports, nextOpenShifts, nextSummary, nextReportingSummary, nextStore]) => {
      setReports(nextReports);
      setOpenShifts(nextOpenShifts);
      setLiveSummary(nextSummary);
      setReportingSummary(nextReportingSummary);
      setStore(nextStore);
    }).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : t('common.loadFailed')));
  }, [period, storeId]);

  async function refresh(report: ReportRecord, message: string) {
    const [nextReports, nextOpenShifts, nextSummary, nextReportingSummary, nextStore] = await Promise.all([
      reportService.listReports(storeId),
      shiftService.listOpenShifts(storeId),
      reportService.getDashboard(storeId, period),
      reportService.getCurrentPeriodSummary(storeId),
      userService.getStore(storeId),
    ]);
    setReports(nextReports);
    setOpenShifts(nextOpenShifts);
    setLiveSummary(nextSummary);
    setReportingSummary(nextReportingSummary);
    setStore(nextStore);
    setLatestReport(report);
    setNotice(message);
    setError('');
  }

  async function createX() {
    try {
      const report = await reportService.createXReport(storeId, user?.name ?? 'Owner');
      setSelectedReport(report);
      await refresh(report, 'X report created. The day remains open.');
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : 'Unable to create the X report.');
    }
  }

  async function createZ() {
    try {
      const report = await reportService.closeDayWithZReport(storeId, user?.name ?? 'Owner', dayClosed ? ownerPin : undefined);
      setOwnerPin('');
      setSelectedReport(report);
      await refresh(report, t('reports.closed'));
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : 'Unable to close the business day.');
    }
  }

  return (
    <WorkspaceLayout title={t('reports.title')} storeName={store?.name} links={ownerWorkspaceLinks}>
      <header className="mb-4">
        <h1 className="font-display text-headline-lg text-on-surface">{t('reports.title')}</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">X reports are live snapshots. Z reports close the current reporting period.</p>
      </header>

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

      <section className="grid gap-3 md:grid-cols-2">
        <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <div className="mb-3 flex items-center gap-2"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-fixed text-primary"><MaterialIcon name="visibility" /></span><div><h2 className="font-display text-headline-sm">{t('reports.xReport')}</h2><p className="font-body text-body-sm text-outline">{t('reports.xDescription')}</p></div></div>
          <Summary sales={reportingSummary.salesCollectedMillimes} orders={reportingSummary.orderCount} />
          <Button onClick={() => { void createX(); }} className="mt-4 w-full"><MaterialIcon name="summarize" />{t('reports.xReport')}</Button>
        </article>
        <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <div className="mb-3 flex items-center gap-2"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning-container text-on-warning-container"><MaterialIcon name="lock" /></span><div><h2 className="font-display text-headline-sm">{t('reports.zReport')}</h2><p className="font-body text-body-sm text-outline">{t('reports.zDescription')}</p></div></div>
          <Summary sales={reportingSummary.salesCollectedMillimes} orders={reportingSummary.orderCount} />
          {zBlocked && <p className="mt-3 rounded-lg bg-warning-container p-2.5 font-body text-body-sm text-on-warning-container">{t('reports.openShiftsBlock')} <a href="/owner/shifts" className="font-semibold underline">Review or force-close shifts</a></p>}
          {dayClosed && (
            <label className="mt-3 block font-body text-label-md text-on-surface">
              Owner PIN required to create another Z report today
              <input
                required
                type="password"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                value={ownerPin}
                onChange={(event) => setOwnerPin(event.target.value)}
                placeholder="••••"
                className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 tracking-[0.5em] outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
          )}
          <Button onClick={() => { void createZ(); }} disabled={zBlocked} variant="danger" className="mt-4 w-full"><MaterialIcon name="lock" />{dayClosed ? 'Create another Z report' : t('reports.zReport')}</Button>
        </article>
      </section>

      {latestReport && (
        <section className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-primary-fixed/40 p-4 text-primary">
          <div><p className="font-body text-label-md">{latestReport.type} report • {new Date(latestReport.createdAt).toLocaleString()}</p><p className="mt-1 font-body text-body-sm">{formatTnd((latestReport.salesCollectedMillimes ?? latestReport.salesMillimes) / 1000)} DT • {latestReport.orderCount} orders</p></div>
          <StatusTag status={latestReport.type === 'Z' ? 'closed' : 'open'}>{latestReport.type}</StatusTag>
        </section>
      )}
      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mt-4 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}

      <section className="mt-6">
        <h2 className="mb-3 font-display text-headline-md text-on-surface">Report history</h2>
        <div className="flex flex-col gap-2">
          {reports.map((report) => (
            <button type="button" key={report.id} onClick={() => setSelectedReport(report)} className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-lowest p-4 text-left shadow-card">
              <div><p className="font-body text-label-md text-on-surface">{report.type} report • {report.businessDate}</p><p className="mt-1 font-body text-body-sm text-outline">{new Date(report.createdAt).toLocaleString()} • {report.orderCount} orders • Sales {formatTnd((report.salesCollectedMillimes ?? report.salesMillimes) / 1000)} DT • Expenses {formatTnd((report.expensesMillimes ?? 0) / 1000)} DT • Net {formatTnd((report.netProfitMillimes ?? 0) / 1000)} DT</p></div>
              <span className="flex items-center gap-2"><StatusTag status={report.type === 'Z' ? 'closed' : 'open'}>{report.type}</StatusTag><MaterialIcon name="open_in_new" /></span>
            </button>
          ))}
          {reports.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
        </div>
      </section>
      {selectedReport && <ReportView report={selectedReport} storeName={store?.name ?? ''} onClose={() => setSelectedReport(null)} />}
    </WorkspaceLayout>
  );
}

function Summary({ sales, orders }: { sales: number; orders: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-container-low p-3">
      <div><p className="font-body text-label-sm text-outline">{t('finance.sales')}</p><p className="font-display text-headline-sm tabular-nums text-primary">{formatTnd(sales / 1000)} DT</p></div>
      <div><p className="font-body text-label-sm text-outline">{t('owner.orderCount')}</p><p className="font-display text-headline-sm tabular-nums text-on-surface">{orders}</p></div>
    </div>
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

export function OwnerReportsScreen() {
  return <OwnerReportsContent />;
}
