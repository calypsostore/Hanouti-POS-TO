import { useEffect, useMemo, useState } from 'react';
import { ownerWorkspaceLinks } from '../app/navigation';
import { MaterialIcon } from '../components/MaterialIcon';
import { PageHeader } from '../components/layout';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { localizeErrorMessage, t } from '../i18n';
import { formatMetricWithUnit, formatMillimesWithThousands } from '../lib/millimes';
import {
  fiscalPeriodForPreset,
  formatFiscalTimestamp,
  getFiscalReportCounts,
  getFiscalSnapshotAmount,
  getFiscalReport,
  hasSnapshotBackedFiscalAmounts,
  listFiscalReportHistory,
  saveFiscalReportHistory,
  type FiscalPreset,
  type FiscalReport,
  type FiscalReportHistoryRecord,
  type FiscalTransaction,
  type FiscalVatLine,
} from '../services/fiscal/fiscalReportService';
import {
  downloadFiscalPdf,
  exportFiscalCsv,
  exportFiscalXlsx,
  previewFiscalPdf,
  printFiscalPdf,
} from '../services/fiscal/fiscalReportExport';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';

const presetOptions: Array<{ value: FiscalPreset; label: string }> = [
  { value: 'today', label: t('fiscalReports.preset.today') },
  { value: 'yesterday', label: t('fiscalReports.preset.yesterday') },
  { value: 'this_week', label: t('fiscalReports.preset.thisWeek') },
  { value: 'this_month', label: t('fiscalReports.preset.thisMonth') },
  { value: 'previous_month', label: t('fiscalReports.preset.previousMonth') },
  { value: 'this_year', label: t('fiscalReports.preset.thisYear') },
  { value: 'previous_year', label: t('fiscalReports.preset.previousYear') },
  { value: 'custom', label: t('fiscalReports.preset.custom') },
];

function formatSnapshotAmount(transaction: FiscalTransaction, key: 'netAmountMillimes' | 'totalTaxMillimes' | 'totalAmountMillimes'): string {
  const amount = getFiscalSnapshotAmount(transaction, key);
  return amount === undefined ? t('fiscal.common.unavailable') : formatMillimesWithThousands(amount);
}

function formatOptionalMillimes(value: unknown): string {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? formatMillimesWithThousands(value)
    : t('fiscal.common.unavailable');
}

function snapshotRates(transaction: FiscalTransaction): string {
  const rawLines = transaction.snapshot?.lines;
  if (!Array.isArray(rawLines)) return t('fiscal.common.unavailable');
  const rates = new Set<string>();
  for (const rawLine of rawLines) {
    if (!rawLine || typeof rawLine !== 'object') continue;
    const taxes = (rawLine as { taxes?: unknown }).taxes;
    if (!Array.isArray(taxes)) continue;
    for (const rawTax of taxes) {
      if (!rawTax || typeof rawTax !== 'object') continue;
      const tax = rawTax as { ratePpm?: unknown; treatment?: unknown };
      if (typeof tax.ratePpm === 'number' && Number.isSafeInteger(tax.ratePpm)) {
        rates.add(`${(tax.ratePpm / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`);
      } else if (typeof tax.treatment === 'string') {
        rates.add(tax.treatment.replaceAll('_', ' '));
      }
    }
  }
  return [...rates].join(', ') || t('fiscal.common.unavailable');
}

function vatRate(line: FiscalVatLine): string {
  if (line.ratePpm !== undefined) {
    return `${(line.ratePpm / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`;
  }
  if (line.treatment === 'exempt') return t('fiscal.treatment.exempt');
  const treatmentKey: Record<string, string> = {
    taxable: 'fiscal.treatment.taxable',
    outside_scope: 'fiscal.treatment.outsideScope',
    suspended: 'fiscal.treatment.suspended',
    special: 'fiscal.treatment.special',
  };
  return treatmentKey[line.treatment] ? t(treatmentKey[line.treatment] as never) : line.treatment.replaceAll('_', ' ');
}

function fiscalSnapshotNotice(report: FiscalReport): string {
  const missingCount = report.summary.missingSnapshotCount;
  return missingCount === 0
    ? t('fiscalReports.snapshotNoticeNone')
    : t('fiscalReports.snapshotNoticeMissing', { count: missingCount });
}

function reconciliationStatus(report: FiscalReport): string {
  const snapshotOnly = report.summary.missingSnapshotCount > 0;
  if (snapshotOnly && !hasSnapshotBackedFiscalAmounts(report)) return t('fiscalReports.reconciliationNotVerifiable');
  const result = t(report.summary.reconciliationValid ? 'fiscalReports.reconciliationPass' : 'fiscalReports.reconciliationFail');
  return snapshotOnly ? t('fiscalReports.reconciliationSnapshotOnly', { result }) : result;
}

function transactionCountLabel(count: number, page: number, pageCount: number): string {
  return t('fiscalReports.pagination', { count, page, pageCount });
}

function fiscalTimestamp(value: string, timezone: string): string {
  const formatted = formatFiscalTimestamp(value, timezone);
  return formatted === 'Unavailable' ? t('fiscal.common.unavailable') : formatted;
}

function snapshotLinesForItems(transaction: FiscalTransaction) {
  const lines = transaction.snapshot?.lines;
  if (!Array.isArray(lines)) return transaction.items.map(() => undefined);
  const usedLineIndexes = new Set<number>();
  return transaction.items.map((item) => {
    if (!item.itemId) return undefined;
    const lineIndex = lines.findIndex((rawLine, index) => {
      if (usedLineIndexes.has(index) || !rawLine || typeof rawLine !== 'object') return false;
      const line = rawLine as { itemId?: unknown; quantity?: unknown; unitAmountMillimes?: unknown };
      return line.itemId === item.itemId
        && line.quantity === item.quantity
        && line.unitAmountMillimes === item.unitPriceMillimes;
    });
    if (lineIndex < 0) return undefined;
    usedLineIndexes.add(lineIndex);
    return lines[lineIndex] as { netAmountMillimes?: number; totalTaxMillimes?: number; totalAmountMillimes?: number; taxes?: Array<{ ratePpm?: number; treatment?: string }> };
  });
}

export function OwnerFiscalReportsScreen() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [storeName, setStoreName] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Tunis');
  const [preset, setPreset] = useState<FiscalPreset>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [report, setReport] = useState<FiscalReport | null>(null);
  const [history, setHistory] = useState<FiscalReportHistoryRecord[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [vatFilter, setVatFilter] = useState<string[]>([]);
  const [transactionFilter, setTransactionFilter] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [selectedTransaction, setSelectedTransaction] = useState<FiscalTransaction | null>(null);

  useEffect(() => {
    if (!storeId) return;
    let active = true;
    void userService.getStore(storeId).then((store) => {
      if (!active) return;
      if (!store) {
        setError(t('fiscalReports.error.storeInformation'));
        return;
      }
      setStoreName(store.name);
      setTimezone(store.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Africa/Tunis');
    }).catch((loadError) => {
      if (active) setError(localizeErrorMessage(loadError, t('fiscalReports.error.storeInformation')));
    });
    return () => { active = false; };
  }, [storeId]);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (!storeId) return;
    let active = true;
    setHistoryError('');
    void listFiscalReportHistory(storeId).then((records) => {
      if (active) setHistory(records);
    }).catch((loadError) => {
      if (active) {
        setHistory([]);
        setHistoryError(localizeErrorMessage(loadError, t('fiscalReports.error.loadHistory')));
      }
    });
    return () => { active = false; };
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    const period = fiscalPeriodForPreset(preset, timezone, customStart, customEnd);
    if (!period) {
      setReport(null);
      setSelectedTransaction(null);
      setError(t('fiscalReports.error.invalidDateRange'));
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    setNotice('');
    setReport(null);
    setSelectedTransaction(null);
    setPreviewUrl('');
    setTransactionFilter('');
    setVatFilter([]);
    setPage(0);
    void getFiscalReport(storeId, period.start, period.endExclusive, timezone).then((next) => {
      if (active) setReport(next);
    }).catch((loadError) => {
      if (active) setError(localizeErrorMessage(loadError, t('fiscalReports.error.loadReport')));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [storeId, timezone, preset, customStart, customEnd]);

  const filteredTransactions = useMemo(() => {
    if (!report) return [];
    const query = transactionFilter.trim().toLowerCase();
    return report.transactions.filter((transaction) => {
      if (vatFilter.length > 0 && !vatFilter.includes(transaction.id)) return false;
      if (!query) return true;
      return [
        String(transaction.number),
        transaction.customer,
        transaction.staff,
        transaction.paymentMethod,
        transaction.status,
        ...transaction.items.map((item) => item.name),
      ].some((value) => value?.toLowerCase().includes(query));
    });
  }, [report, transactionFilter, vatFilter]);

  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(filteredTransactions.length / pageSize));
  const visibleTransactions = filteredTransactions.slice(page * pageSize, (page + 1) * pageSize);

  const saveHistory = async () => {
    if (!report) return;
    setNotice('');
    setError('');
    try {
      await saveFiscalReportHistory(storeId, report);
    } catch (saveError) {
      setError(localizeErrorMessage(saveError, t('fiscalReports.error.saveHistory')));
      return;
    }
    setNotice(t('fiscalReports.notice.savedHistory'));
    try {
      setHistory(await listFiscalReportHistory(storeId));
      setHistoryError('');
    } catch (loadError) {
      setHistoryError(localizeErrorMessage(loadError, t('fiscalReports.error.refreshHistory')));
    }
  };

  const openVatFilter = (line: FiscalVatLine) => {
    setVatFilter(line.transactionIds);
    setPage(0);
  };

  const openPreview = async () => {
    if (!report) return;
    setError('');
    setNotice('');
    setPreviewUrl('');
    try {
      setPreviewUrl(await previewFiscalPdf(report));
    } catch (previewError) {
      setError(localizeErrorMessage(previewError, t('fiscalReports.error.previewPdf')));
    }
  };

  const runExport = async (label: string, action: (currentReport: FiscalReport) => void | Promise<void>) => {
    if (!report) return;
    setError('');
    setNotice('');
    try {
      await action(report);
      setNotice(t('fiscalReports.notice.exportReady', { label }));
    } catch (exportError) {
      setError(localizeErrorMessage(exportError, t('fiscalReports.error.prepareExport', { label })));
    }
  };

  const periodLabel = report
    ? t('fiscalReports.periodRange', { start: report.period.startDate, end: report.period.endDateExclusive })
    : '';
  const reportCounts = report ? getFiscalReportCounts(report) : null;
  const selectedLineSnapshots = useMemo(
    () => selectedTransaction ? snapshotLinesForItems(selectedTransaction) : [],
    [selectedTransaction],
  );
  const fiscalTotalsUnavailable = report !== null
    && report.summary.missingSnapshotCount > 0
    && !hasSnapshotBackedFiscalAmounts(report);
  const summaryAmount = (value: number) => fiscalTotalsUnavailable
    ? t('fiscal.common.unavailable')
    : formatMetricWithUnit(formatMillimesWithThousands(value), 'DT');
  const summaryLabel = (label: string) => report?.summary.missingSnapshotCount
    ? t('fiscalReports.snapshotBacked', { label })
    : label;

  return (
    <WorkspaceLayout title={t('fiscalReports.title')} storeName={storeName} links={ownerWorkspaceLinks}>
      <PageHeader
        title={t('fiscalReports.title')}
        subtitle={t('fiscalReports.subtitle')}
      />

      {error && <p role="alert" className="mb-4 rounded-lg bg-error-container p-3 text-on-error-container">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-lg bg-primary-container p-3 text-on-primary-container">{notice}</p>}

      <section className="mb-4 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-label-md">{t('fiscalReports.period')}
            <select className="mt-1 h-12 rounded-lg bg-surface-container-low px-3" value={preset} onChange={(event) => setPreset(event.target.value as FiscalPreset)}>
              {presetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {preset === 'custom' && (
            <>
              <label className="text-label-md">{t('fiscalReports.startDate')}<input type="date" className="mt-1 h-12 rounded-lg bg-surface-container-low px-3" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
              <label className="text-label-md">{t('fiscalReports.endDate')}<input type="date" className="mt-1 h-12 rounded-lg bg-surface-container-low px-3" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
            </>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" aria-label={t('fiscalReports.previewPdf')} className="h-11 rounded-lg bg-primary px-3 text-on-primary" onClick={openPreview} disabled={!report}><MaterialIcon name="picture_as_pdf" /> {t('fiscalReports.previewPdf')}</button>
            <button type="button" className="h-11 rounded-lg border border-outline px-3" onClick={() => void runExport(t('fiscalReports.export.pdf'), downloadFiscalPdf)} disabled={!report}>{t('fiscalReports.export.pdf')}</button>
            <button type="button" className="h-11 rounded-lg border border-outline px-3" onClick={() => void runExport(t('fiscalReports.export.xlsx'), exportFiscalXlsx)} disabled={!report}>{t('fiscalReports.export.xlsx')}</button>
            <button type="button" className="h-11 rounded-lg border border-outline px-3" onClick={() => void runExport(t('fiscalReports.export.transactionsCsv'), (currentReport) => exportFiscalCsv(currentReport, 'transactions'))} disabled={!report}>{t('fiscalReports.export.transactionsCsv')}</button>
            <button type="button" className="h-11 rounded-lg border border-outline px-3" onClick={() => void runExport(t('fiscalReports.export.vatCsv'), (currentReport) => exportFiscalCsv(currentReport, 'vat'))} disabled={!report}>{t('fiscalReports.export.vatCsv')}</button>
            <button type="button" className="h-11 rounded-lg border border-outline px-3" onClick={() => void runExport(t('fiscalReports.export.print'), printFiscalPdf)} disabled={!report}>{t('fiscalReports.export.print')}</button>
            <button type="button" className="h-11 rounded-lg border border-outline px-3" onClick={saveHistory} disabled={!report}>{t('fiscalReports.saveSnapshot')}</button>
          </div>
        </div>
        {report && <p className="mt-3 text-body-sm text-on-surface-variant">{periodLabel} · {report.period.timezone} · {t('fiscalReports.currency')}: TND</p>}
      </section>

      {loading ? (
        <p role="status" className="rounded-xl bg-surface-container-lowest p-6">{t('fiscalReports.loading')}</p>
      ) : report && (
        <>
          <section aria-label={t('fiscalReports.transactionCounts')} className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: t('fiscalReports.completedTransactions'), value: reportCounts?.completed ?? 0 },
              { label: t('fiscalReports.voidedTransactions'), value: reportCounts?.voided ?? 0 },
              { label: t('fiscalReports.pendingVoidTransactions'), value: reportCounts?.pendingVoid ?? 0 },
              { label: t('fiscalReports.missingSnapshots'), value: reportCounts?.missingSnapshots ?? 0 },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl bg-surface-container-lowest p-4 shadow-card">
                <p className="text-label-md text-on-surface-variant">{label}</p>
                <p className="mt-2 font-display text-headline-sm">{value}</p>
              </div>
            ))}
          </section>

          <section aria-label={t('fiscalReports.fiscalTotals')} className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: summaryLabel(t('fiscalReports.grossTtc')), value: summaryAmount(report.summary.grossAmountMillimes) },
              { label: summaryLabel(t('fiscalReports.netHt')), value: summaryAmount(report.summary.netAmountMillimes) },
              { label: summaryLabel(t('fiscalReports.vatCollected')), value: summaryAmount(report.summary.vatAmountMillimes) },
              { label: summaryLabel(t('fiscalReports.finalPayable')), value: summaryAmount(report.summary.payableAmountMillimes) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl bg-surface-container-lowest p-4 shadow-card">
                <p className="text-label-md text-on-surface-variant">{label}</p>
                <p className="mt-2 font-display text-headline-sm">{value}</p>
              </div>
            ))}
          </section>

          {report.summary.missingSnapshotCount > 0 && (
            <p role="status" className="mb-4 rounded-lg bg-tertiary-container p-3 text-on-tertiary-container">
              {fiscalSnapshotNotice(report)} {t('fiscalReports.missingExcluded')}
            </p>
          )}

          <section className="mb-4 grid gap-4 xl:grid-cols-2">
            <div className="overflow-x-auto rounded-2xl bg-surface-container-lowest p-4 shadow-card">
              <h2 className="mb-3 font-display text-title-lg">{t('fiscalReports.vatBreakdown')}</h2>
              <table className="w-full min-w-[680px] text-left text-body-sm">
                <thead><tr className="border-b border-outline-variant"><th className="p-2">{t('fiscalReports.rate')}</th><th>{t('fiscalReports.taxableHt')}</th><th>{t('fiscalReports.vat')}</th><th>{t('fiscalReports.grossTtc')}</th><th>{t('fiscalReports.transactions')}</th></tr></thead>
                <tbody>{report.vatBreakdown.length === 0 ? (
                  <tr><td colSpan={5} className="p-3 text-center text-on-surface-variant">{t('fiscalReports.noVatBreakdown')}</td></tr>
                ) : report.vatBreakdown.map((line) => (
                  <tr key={`${line.taxType}-${line.treatment}-${line.ruleId}-${line.ruleVersion}`} className="border-b border-outline-variant last:border-0">
                    <td className="p-2"><button type="button" className="font-medium text-primary underline" onClick={() => openVatFilter(line)}>{vatRate(line)} · {line.treatment}</button></td>
                    <td>{formatMillimesWithThousands(line.taxableHTMillimes)} DT</td>
                    <td>{formatMillimesWithThousands(line.vatMillimes)} DT</td>
                    <td>{formatMillimesWithThousands(line.ttcMillimes)} DT</td>
                    <td>{line.transactionCount}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
              <h2 className="mb-3 font-display text-title-lg">{t('fiscalReports.payments')}</h2>
              <div className="grid grid-cols-3 gap-2 text-body-sm">
                <strong>{t('fiscalReports.method')}</strong><strong>{t('fiscalReports.sales')}</strong><strong>{t('fiscalReports.collected')}</strong>
                {(['cash', 'card', 'other', 'tab'] as const).map((method) => (
                  <div className="contents" key={method}>
                    <span className="capitalize">{t(`fiscalReports.payment.${method}` as never)}</span>
                    <span>{formatMillimesWithThousands(report.payments.sales[method])} DT</span>
                    <span>{formatMillimesWithThousands(report.payments.collected[method])} DT</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-2 text-body-sm sm:grid-cols-2">
                <p>{t('fiscalReports.voidedTransactions')}: <strong>{reportCounts?.voided ?? 0}</strong></p>
                <p>{t('fiscalReports.pendingVoidTransactions')}: <strong>{reportCounts?.pendingVoid ?? 0}</strong></p>
                <p>{t('fiscalReports.voidedGross')}: <strong>{formatMillimesWithThousands(report.adjustments.voidedGrossMillimes)} DT</strong></p>
                <p>{t('fiscalReports.cashMovements')}: <strong>{formatMillimesWithThousands(report.adjustments.cashMovementsNetMillimes)} DT</strong></p>
                <p>{t('fiscalReports.snapshotReconciliation')}: <strong>{reconciliationStatus(report)}</strong></p>
              </div>
              <p className="mt-3 text-body-sm text-on-surface-variant">{t('fiscalReports.refundsUnavailable')}</p>
              <p className="mt-2 text-body-sm text-on-surface-variant">{t('fiscalReports.voidedExcluded')}</p>
            </div>
          </section>

          <section className="mb-4 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="font-display text-title-lg">{t('fiscalReports.transactionDetails')}</h2>
              {vatFilter.length > 0 && <button type="button" className="rounded-full bg-primary-container px-3 py-2 text-label-md" onClick={() => setVatFilter([])}>{t('fiscalReports.clearVatFilter')}</button>}
              <input type="search" aria-label={t('fiscalReports.filterTransactions')} className="h-11 min-w-48 rounded-lg bg-surface-container-low px-3" placeholder={t('fiscalReports.filterTransactions')} value={transactionFilter} onChange={(event) => { setTransactionFilter(event.target.value); setPage(0); }} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-body-sm">
                <thead><tr className="border-b border-outline-variant"><th className="p-2">{t('fiscalReports.order')}</th><th>{t('fiscalReports.dateTime')} ({timezone})</th><th>{t('fiscalReports.customer')}</th><th>{t('fiscalReports.staff')}</th><th>{t('fiscalReports.netHtTnd')}</th><th>{t('fiscalReports.vatRate')}</th><th>{t('fiscalReports.vatTnd')}</th><th>{t('fiscalReports.grossTtcTnd')}</th><th>{t('fiscalReports.payment')}</th><th>{t('fiscalReports.status')}</th></tr></thead>
                <tbody>{visibleTransactions.length === 0 ? (
                  <tr><td colSpan={10} className="p-4 text-center text-on-surface-variant">
                    {report.transactions.length === 0 ? t('fiscalReports.noTransactionsPeriod') : t('fiscalReports.noTransactionsMatch')}
                  </td></tr>
                ) : visibleTransactions.map((transaction) => (
                  <tr key={transaction.id} className="border-b border-outline-variant last:border-0">
                    <td className="p-2"><button type="button" className="font-medium text-primary underline" onClick={() => setSelectedTransaction(transaction)}>#{transaction.number}</button><div className="max-w-64 truncate text-on-surface-variant">{transaction.items.map((item) => `${item.name} ×${item.quantity}`).join(', ')}</div></td>
                    <td>{transaction.businessDate}<div className="text-on-surface-variant">{fiscalTimestamp(transaction.createdAt, timezone)}</div></td>
                    <td>{transaction.customer ?? t('fiscal.common.walkIn')}</td>
                    <td>{transaction.staff ?? t('fiscal.common.unknown')}</td>
                    <td>{formatSnapshotAmount(transaction, 'netAmountMillimes')}</td>
                    <td>{snapshotRates(transaction)}</td>
                    <td>{formatSnapshotAmount(transaction, 'totalTaxMillimes')}</td>
                    <td>{formatSnapshotAmount(transaction, 'totalAmountMillimes')}</td>
                    <td>{transaction.paymentMethod}<div className="text-on-surface-variant">{transaction.paymentStatus}</div></td>
                    <td>{transaction.status}{transaction.voidReason && <div className="text-on-surface-variant">{transaction.voidReason}</div>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-body-sm">
              <span aria-live="polite">{transactionCountLabel(filteredTransactions.length, page + 1, pageCount)}</span>
              <div className="flex gap-2">
                <button type="button" className="rounded-lg border border-outline px-3 py-2" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>{t('fiscalReports.previous')}</button>
                <button type="button" className="rounded-lg border border-outline px-3 py-2" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>{t('fiscalReports.next')}</button>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 className="mb-3 font-display text-title-lg">{t('fiscalReports.savedSnapshots')}</h2>
            {historyError ? <p role="alert" className="text-body-sm text-error">{historyError}</p> : history.length === 0 ? <p className="text-body-sm text-on-surface-variant">{t('fiscalReports.noSavedReports')}</p> : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {history.map((item) => (
                  <button type="button" key={item.id} className="rounded-xl border border-outline-variant p-3 text-left" onClick={() => setReport(item.snapshot)}>
                    <strong>{t('fiscalReports.periodRangeExclusiveShort', { start: item.periodStart, end: item.periodEndExclusive })}</strong>
                    <div className="text-body-sm text-on-surface-variant">{t('fiscalReports.generated')} {fiscalTimestamp(item.generatedAt, timezone)} ({timezone})</div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={t('fiscalReports.pdfPreview')}>
          <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-2xl bg-surface-container-lowest">
            <div className="flex items-center justify-between p-3"><h2 className="font-display text-title-lg">{t('fiscalReports.pdfPreview')}</h2><button type="button" className="rounded-lg border border-outline px-3 py-2" onClick={() => setPreviewUrl('')}>{t('fiscal.action.close')}</button></div>
            <iframe title={t('fiscalReports.pdfPreview')} src={previewUrl} className="min-h-0 flex-1 rounded-b-2xl" />
          </div>
        </div>
      )}
      {selectedTransaction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={t('fiscalReports.transactionDialogLabel', { number: selectedTransaction.number })}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface-container-lowest p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-title-lg">{t('fiscalReports.transactionNumber', { number: selectedTransaction.number })}</h2>
              <button type="button" className="rounded-lg border border-outline px-3 py-2" onClick={() => setSelectedTransaction(null)}>{t('fiscal.action.close')}</button>
            </div>
            <p className="mt-2 text-body-sm text-on-surface-variant">{selectedTransaction.businessDate} · {fiscalTimestamp(selectedTransaction.createdAt, timezone)} ({timezone}) · {selectedTransaction.status}{selectedTransaction.voidedAt ? ` · ${t('fiscalReports.voidedAt')} ${fiscalTimestamp(selectedTransaction.voidedAt, timezone)} (${timezone})` : ''}</p>
            <p className="mt-1 text-body-sm">{selectedTransaction.customer ?? t('fiscal.common.walkIn')} · {selectedTransaction.staff ?? t('fiscal.common.unknown')} · {selectedTransaction.paymentMethod} ({selectedTransaction.paymentStatus})</p>
            {selectedTransaction.voidReason && <p className="mt-2 text-body-sm">{t('fiscalReports.voidReason')}: {selectedTransaction.voidReason}</p>}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[500px] text-left text-body-sm">
                <thead><tr className="border-b border-outline-variant"><th className="p-2">{t('fiscalReports.product')}</th><th>{t('fiscalReports.quantity')}</th><th>{t('fiscalReports.netHtTnd')}</th><th>{t('fiscalReports.vatRates')}</th><th>{t('fiscalReports.vatTnd')}</th><th>{t('fiscalReports.grossTtcTnd')}</th></tr></thead>
                <tbody>{selectedTransaction.items.map((item, index) => {
                  const lineSnapshot = selectedLineSnapshots[index];
                  const rates = new Set((lineSnapshot?.taxes ?? []).map((tax) =>
                    tax.ratePpm === undefined ? tax.treatment ?? t('fiscal.common.unknown') : `${(tax.ratePpm / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`));
                  return (
                    <tr key={`${item.name}-${index}`} className="border-b border-outline-variant last:border-0">
                      <td className="p-2">{item.name}</td><td>{item.quantity}</td>
                      <td>{formatOptionalMillimes(lineSnapshot?.netAmountMillimes)}</td>
                      <td>{[...rates].join(', ') || t('fiscal.common.unavailable')}</td>
                      <td>{formatOptionalMillimes(lineSnapshot?.totalTaxMillimes)}</td>
                      <td>{formatOptionalMillimes(lineSnapshot?.totalAmountMillimes)}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            <div className="mt-4 text-body-sm">
              <p>{t('fiscalReports.netHtTnd')}: <strong>{formatSnapshotAmount(selectedTransaction, 'netAmountMillimes')}</strong></p>
              <p>{t('fiscalReports.vatTnd')}: <strong>{formatSnapshotAmount(selectedTransaction, 'totalTaxMillimes')}</strong></p>
              <p>{t('fiscalReports.grossTtcTnd')}: <strong>{formatSnapshotAmount(selectedTransaction, 'totalAmountMillimes')}</strong></p>
            </div>
          </div>
        </div>
      )}
    </WorkspaceLayout>
  );
}
