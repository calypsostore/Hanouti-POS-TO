import { useState } from 'react';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { t } from '../i18n/translations';
import { formatTnd } from '../lib/format';
import { reportService } from '../services/reportService';
import { shiftService } from '../services/shiftService';
import { useAuthStore } from '../stores/authStore';
import { userService } from '../services/userService';
import type { ReportRecord } from '../types/domain';

function OwnerReportsContent() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const store = userService.getStore(storeId);
  const [reports, setReports] = useState(() => reportService.listReports(storeId));
  const [latestReport, setLatestReport] = useState<ReportRecord | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const openShifts = shiftService.listOpenShifts(storeId);
  const date = new Date();
  const businessDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const dayClosed = store?.dayClosedOn === businessDate;
  const zBlocked = openShifts.length > 0 || dayClosed;

  function refresh(report: ReportRecord, message: string) {
    setReports(reportService.listReports(storeId));
    setLatestReport(report);
    setNotice(message);
    setError('');
  }

  function createX() {
    try {
      refresh(reportService.createXReport(storeId), 'X report created. The day remains open.');
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : 'Unable to create the X report.');
    }
  }

  function createZ() {
    try {
      refresh(reportService.closeDayWithZReport(storeId), t('reports.closed'));
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : 'Unable to close the business day.');
    }
  }

  const liveSummary = reportService.getDashboard(storeId, 'day');
  return (
    <WorkspaceLayout title={t('reports.title')} storeName={store?.name} links={ownerWorkspaceLinks}>
      <header className="mb-4">
        <h1 className="font-display text-headline-lg text-on-surface">{t('reports.title')}</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">X reports are live snapshots. Z reports close the business day.</p>
      </header>

      <section className="grid gap-3 md:grid-cols-2">
        <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <div className="mb-3 flex items-center gap-2"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-fixed text-primary"><MaterialIcon name="visibility" /></span><div><h2 className="font-display text-headline-sm">{t('reports.xReport')}</h2><p className="font-body text-body-sm text-outline">{t('reports.xDescription')}</p></div></div>
          <Summary sales={liveSummary.salesMillimes} orders={liveSummary.orderCount} />
          <Button onClick={createX} className="mt-4 w-full"><MaterialIcon name="summarize" />{t('reports.xReport')}</Button>
        </article>
        <article className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <div className="mb-3 flex items-center gap-2"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning-container text-on-warning-container"><MaterialIcon name="lock" /></span><div><h2 className="font-display text-headline-sm">{t('reports.zReport')}</h2><p className="font-body text-body-sm text-outline">{t('reports.zDescription')}</p></div></div>
          <Summary sales={liveSummary.salesMillimes} orders={liveSummary.orderCount} />
          {zBlocked && <p className="mt-3 rounded-lg bg-warning-container p-2.5 font-body text-body-sm text-on-warning-container">{dayClosed ? 'This business day is already closed.' : t('reports.openShiftsBlock')}</p>}
          <Button onClick={createZ} disabled={zBlocked} variant="danger" className="mt-4 w-full"><MaterialIcon name="lock" />{dayClosed ? 'Day closed' : t('reports.zReport')}</Button>
        </article>
      </section>

      {latestReport && (
        <section className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-primary-fixed/40 p-4 text-primary">
          <div><p className="font-body text-label-md">{latestReport.type} report • {new Date(latestReport.createdAt).toLocaleString()}</p><p className="mt-1 font-body text-body-sm">{formatTnd(latestReport.salesMillimes / 1000)} DT • {latestReport.orderCount} orders</p></div>
          <StatusTag status={latestReport.type === 'Z' ? 'closed' : 'open'}>{latestReport.type}</StatusTag>
        </section>
      )}
      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mt-4 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}

      <section className="mt-6">
        <h2 className="mb-3 font-display text-headline-md text-on-surface">Report history</h2>
        <div className="flex flex-col gap-2">
          {reports.map((report) => (
            <article key={report.id} className="flex items-center justify-between rounded-xl bg-surface-container-lowest p-4 shadow-card">
              <div><p className="font-body text-label-md text-on-surface">{report.type} report • {report.businessDate}</p><p className="mt-1 font-body text-body-sm text-outline">{new Date(report.createdAt).toLocaleString()} • {report.orderCount} orders • {formatTnd(report.salesMillimes / 1000)} DT</p></div>
              <StatusTag status={report.type === 'Z' ? 'closed' : 'open'}>{report.type}</StatusTag>
            </article>
          ))}
          {reports.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
        </div>
      </section>
    </WorkspaceLayout>
  );
}

function Summary({ sales, orders }: { sales: number; orders: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-container-low p-3">
      <div><p className="font-body text-label-sm text-outline">{t('owner.sales')}</p><p className="font-display text-headline-sm tabular-nums text-primary">{formatTnd(sales / 1000)} DT</p></div>
      <div><p className="font-body text-label-sm text-outline">{t('owner.orderCount')}</p><p className="font-display text-headline-sm tabular-nums text-on-surface">{orders}</p></div>
    </div>
  );
}

export function OwnerReportsScreen() {
  return <OwnerReportsContent />;
}
