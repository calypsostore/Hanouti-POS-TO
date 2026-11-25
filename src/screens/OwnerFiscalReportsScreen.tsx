import { useEffect, useMemo, useState } from 'react';
import { ownerWorkspaceLinks } from '../app/navigation';
import { MaterialIcon } from '../components/MaterialIcon';
import { PageHeader } from '../components/layout';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { formatMetricWithUnit, formatMillimesWithThousands } from '../lib/millimes';
import {
  fiscalPeriodForPreset,
  formatFiscalTimestamp,
  getFiscalReportCounts,
  getFiscalReconciliationStatus,
  getFiscalSnapshotAmount,
  getFiscalSnapshotNotice,
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
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'previous_month', label: 'Previous month' },
  { value: 'this_year', label: 'This year' },
  { value: 'previous_year', label: 'Previous year' },
  { value: 'custom', label: 'Custom range' },
];

function formatSnapshotAmount(transaction: FiscalTransaction, key: 'netAmountMillimes' | 'totalTaxMillimes' | 'totalAmountMillimes'): string {
  const amount = getFiscalSnapshotAmount(transaction, key);
  return amount === undefined ? 'Unavailable' : formatMillimesWithThousands(amount);
}

function formatOptionalMillimes(value: unknown): string {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? formatMillimesWithThousands(value)
    : 'Unavailable';
}

function snapshotRates(transaction: FiscalTransaction): string {
  const rawLines = transaction.snapshot?.lines;
  if (!Array.isArray(rawLines)) return 'Unavailable';
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
  return [...rates].join(', ') || 'Unavailable';
}

function vatRate(line: FiscalVatLine): string {
  if (line.ratePpm !== undefined) {
    return `${(line.ratePpm / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`;
  }
  return line.treatment === 'exempt' ? 'Exempt' : line.treatment.replaceAll('_', ' ');
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
        setError('Could not load store information.');
        return;
      }
      setStoreName(store.name);
      setTimezone(store.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Africa/Tunis');
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load store information.');
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
        setHistoryError(loadError instanceof Error ? loadError.message : 'Could not load saved report history.');
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
      setError('Choose a valid custom start and end date.');
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
      if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load fiscal report.');
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
      setError(saveError instanceof Error ? saveError.message : 'Could not save report history.');
      return;
    }
    setNotice('Fiscal report snapshot saved to history.');
    try {
      setHistory(await listFiscalReportHistory(storeId));
      setHistoryError('');
    } catch (loadError) {
      setHistoryError(loadError instanceof Error ? loadError.message : 'Could not refresh saved report history.');
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
      setError(previewError instanceof Error ? previewError.message : 'Could not preview PDF.');
    }
  };

  const runExport = async (label: string, action: (currentReport: FiscalReport) => void | Promise<void>) => {
    if (!report) return;
    setError('');
    setNotice('');
    try {
      await action(report);
      setNotice(`${label} export prepared. Check your browser downloads.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : `Could not prepare the ${label} export.`);
    }
  };

  const periodLabel = report
    ? `${report.period.startDate} to ${report.period.endDateExclusive} (end exclusive)`
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
    ? 'Unavailable'
    : formatMetricWithUnit(formatMillimesWithThousands(value), 'DT');
  const summaryLabel = (label: string) => report?.summary.missingSnapshotCount
    ? `Snapshot-backed ${label}`
    : label;

  return (
    <WorkspaceLayout title="Fiscal reports" storeName={storeName} links={ownerWorkspaceLinks}>
      <PageHeader
        title="Fiscal Reports & Tax Tracking"
        subtitle="Internal accounting support with immutable transaction snapshots. Not an official Tunisian tax declaration."
      />

      {error && <p role="alert" className="mb-4 rounded-lg bg-error-container p-3 text-on-error-container">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-lg bg-primary-container p-3 text-on-primary-container">{notice}</p>}

      <section className="mb-4 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-label-md">Period
            <select className="mt-1 h-12 rounded-lg bg-surface-container-low px-3" value={preset} onChange={(event) => setPreset(event.target.value as FiscalPreset)}>
              {presetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {preset === 'custom' && (
            <>
              <label className="text-label-md">Start date<input type="date" className="mt-1 h-12 rounded-lg bg-surface-container-low px-3" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
              <label className="text-label-md">End date<input type="date" className="mt-1 h-12 rounded-lg bg-surface-container-low px-3" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
            </>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className="h-11 rounded-lg bg-primary px-3 text-on-primary" onClick={openPreview} disabled={!report}><MaterialIcon name="picture_as_pdf" /> Preview PDF</button>
            <button type="button" className="h-11 rounded-lg border border-outline px-3" onClick={() => void runExport('PDF', downloadFiscalPdf)} disabled={!report}>PDF</button>
            <button type="button" className="h-11 rounded-lg border border-outline px-3" onClick={() => void runExport('Excel', exportFiscalXlsx)} disabled={!report}>Excel</button>
            <button type="button" className="h-11 rounded-lg border border-outline px-3" onClick={() => void runExport('Transactions CSV', (currentReport) => exportFiscalCsv(currentReport, 'transactions'))} disabled={!report}>CSV transactions</button>
            <button type="button" className="h-11 rounded-lg border border-outline px-3" onClick={() => void runExport('VAT CSV', (currentReport) => exportFiscalCsv(currentReport, 'vat'))} disabled={!report}>CSV VAT</button>
            <button type="button" className="h-11 rounded-lg border border-outline px-3" onClick={() => void runExport('Print', printFiscalPdf)} disabled={!report}>Print</button>
            <button type="button" className="h-11 rounded-lg border border-outline px-3" onClick={saveHistory} disabled={!report}>Save snapshot</button>
          </div>
        </div>
        {report && <p className="mt-3 text-body-sm text-on-surface-variant">{periodLabel} · {report.period.timezone} · Currency TND</p>}
      </section>

      {loading ? (
        <p role="status" className="rounded-xl bg-surface-container-lowest p-6">Loading fiscal report…</p>
      ) : report && (
        <>
          <section aria-label="Transaction counts" className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Completed transactions', value: reportCounts?.completed ?? 0 },
              { label: 'Voided transactions', value: reportCounts?.voided ?? 0 },
              { label: 'Pending void transactions', value: reportCounts?.pendingVoid ?? 0 },
              { label: 'Missing fiscal snapshots', value: reportCounts?.missingSnapshots ?? 0 },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl bg-surface-container-lowest p-4 shadow-card">
                <p className="text-label-md text-on-surface-variant">{label}</p>
                <p className="mt-2 font-display text-headline-sm">{value}</p>
              </div>
            ))}
          </section>

          <section aria-label="Fiscal totals" className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: summaryLabel('Gross TTC'), value: summaryAmount(report.summary.grossAmountMillimes) },
              { label: summaryLabel('Net HT'), value: summaryAmount(report.summary.netAmountMillimes) },
              { label: summaryLabel('VAT collected'), value: summaryAmount(report.summary.vatAmountMillimes) },
              { label: summaryLabel('Final payable'), value: summaryAmount(report.summary.payableAmountMillimes) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl bg-surface-container-lowest p-4 shadow-card">
                <p className="text-label-md text-on-surface-variant">{label}</p>
                <p className="mt-2 font-display text-headline-sm">{value}</p>
              </div>
            ))}
          </section>

          {report.summary.missingSnapshotCount > 0 && (
            <p role="status" className="mb-4 rounded-lg bg-tertiary-container p-3 text-on-tertiary-container">
              {getFiscalSnapshotNotice(report)} Missing transactions are excluded from fiscal totals.
            </p>
          )}

          <section className="mb-4 grid gap-4 xl:grid-cols-2">
            <div className="overflow-x-auto rounded-2xl bg-surface-container-lowest p-4 shadow-card">
              <h2 className="mb-3 font-display text-title-lg">VAT breakdown</h2>
              <table className="w-full min-w-[680px] text-left text-body-sm">
                <thead><tr className="border-b border-outline-variant"><th className="p-2">Rate</th><th>Taxable HT</th><th>VAT</th><th>TTC</th><th>Transactions</th></tr></thead>
                <tbody>{report.vatBreakdown.length === 0 ? (
                  <tr><td colSpan={5} className="p-3 text-center text-on-surface-variant">No snapshot-backed VAT breakdown is available for this period.</td></tr>
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
              <h2 className="mb-3 font-display text-title-lg">Payments</h2>
              <div className="grid grid-cols-3 gap-2 text-body-sm">
                <strong>Method</strong><strong>Sales</strong><strong>Collected</strong>
                {(['cash', 'card', 'other', 'tab'] as const).map((method) => (
                  <div className="contents" key={method}>
                    <span className="capitalize">{method}</span>
                    <span>{formatMillimesWithThousands(report.payments.sales[method])} DT</span>
                    <span>{formatMillimesWithThousands(report.payments.collected[method])} DT</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-2 text-body-sm sm:grid-cols-2">
                <p>Voided transactions: <strong>{reportCounts?.voided ?? 0}</strong></p>
                <p>Pending void transactions: <strong>{reportCounts?.pendingVoid ?? 0}</strong></p>
                <p>Voided gross: <strong>{formatMillimesWithThousands(report.adjustments.voidedGrossMillimes)} DT</strong></p>
                <p>Cash movements: <strong>{formatMillimesWithThousands(report.adjustments.cashMovementsNetMillimes)} DT</strong></p>
                <p>Snapshot reconciliation: <strong>{getFiscalReconciliationStatus(report)}</strong></p>
              </div>
              <p className="mt-3 text-body-sm text-on-surface-variant">Refunds and credit notes are unavailable in the existing order data model and are not included.</p>
              <p className="mt-2 text-body-sm text-on-surface-variant">Sales totals and reconciliation include completed orders only. Voided orders are listed separately and excluded.</p>
            </div>
          </section>

          <section className="mb-4 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="font-display text-title-lg">Transaction details</h2>
              {vatFilter.length > 0 && <button type="button" className="rounded-full bg-primary-container px-3 py-2 text-label-md" onClick={() => setVatFilter([])}>Clear VAT filter</button>}
              <input type="search" aria-label="Filter transactions" className="h-11 min-w-48 rounded-lg bg-surface-container-low px-3" placeholder="Filter transactions" value={transactionFilter} onChange={(event) => { setTransactionFilter(event.target.value); setPage(0); }} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-body-sm">
                <thead><tr className="border-b border-outline-variant"><th className="p-2">Order</th><th>Date / time ({timezone})</th><th>Customer</th><th>Staff</th><th>HT (TND)</th><th>VAT rate</th><th>VAT (TND)</th><th>TTC (TND)</th><th>Payment</th><th>Status</th></tr></thead>
                <tbody>{visibleTransactions.length === 0 ? (
                  <tr><td colSpan={10} className="p-4 text-center text-on-surface-variant">
                    {report.transactions.length === 0 ? 'No transactions in this reporting period.' : 'No transactions match the current filters.'}
                  </td></tr>
                ) : visibleTransactions.map((transaction) => (
                  <tr key={transaction.id} className="border-b border-outline-variant last:border-0">
                    <td className="p-2"><button type="button" className="font-medium text-primary underline" onClick={() => setSelectedTransaction(transaction)}>#{transaction.number}</button><div className="max-w-64 truncate text-on-surface-variant">{transaction.items.map((item) => `${item.name} ×${item.quantity}`).join(', ')}</div></td>
                    <td>{transaction.businessDate}<div className="text-on-surface-variant">{formatFiscalTimestamp(transaction.createdAt, timezone)}</div></td>
                    <td>{transaction.customer ?? 'Walk-in'}</td>
                    <td>{transaction.staff ?? 'Unknown'}</td>
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
              <span aria-live="polite">{filteredTransactions.length} transactions · page {page + 1} of {pageCount}</span>
              <div className="flex gap-2">
                <button type="button" className="rounded-lg border border-outline px-3 py-2" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button>
                <button type="button" className="rounded-lg border border-outline px-3 py-2" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 className="mb-3 font-display text-title-lg">Saved report snapshots</h2>
            {historyError ? <p role="alert" className="text-body-sm text-error">{historyError}</p> : history.length === 0 ? <p className="text-body-sm text-on-surface-variant">No saved reports yet.</p> : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {history.map((item) => (
                  <button type="button" key={item.id} className="rounded-xl border border-outline-variant p-3 text-left" onClick={() => setReport(item.snapshot)}>
                    <strong>{item.periodStart} to {item.periodEndExclusive}</strong>
                    <div className="text-body-sm text-on-surface-variant">Generated {formatFiscalTimestamp(item.generatedAt, timezone)} ({timezone})</div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Fiscal report PDF preview">
          <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-2xl bg-surface-container-lowest">
            <div className="flex items-center justify-between p-3"><h2 className="font-display text-title-lg">PDF preview</h2><button type="button" className="rounded-lg border border-outline px-3 py-2" onClick={() => setPreviewUrl('')}>Close</button></div>
            <iframe title="Fiscal report PDF preview" src={previewUrl} className="min-h-0 flex-1 rounded-b-2xl" />
          </div>
        </div>
      )}
      {selectedTransaction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Transaction ${selectedTransaction.number} details`}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface-container-lowest p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-title-lg">Transaction #{selectedTransaction.number}</h2>
              <button type="button" className="rounded-lg border border-outline px-3 py-2" onClick={() => setSelectedTransaction(null)}>Close</button>
            </div>
            <p className="mt-2 text-body-sm text-on-surface-variant">{selectedTransaction.businessDate} · {formatFiscalTimestamp(selectedTransaction.createdAt, timezone)} ({timezone}) · {selectedTransaction.status}{selectedTransaction.voidedAt ? ` · voided ${formatFiscalTimestamp(selectedTransaction.voidedAt, timezone)} (${timezone})` : ''}</p>
            <p className="mt-1 text-body-sm">{selectedTransaction.customer ?? 'Walk-in'} · {selectedTransaction.staff ?? 'Unknown'} · {selectedTransaction.paymentMethod} ({selectedTransaction.paymentStatus})</p>
            {selectedTransaction.voidReason && <p className="mt-2 text-body-sm">Void reason: {selectedTransaction.voidReason}</p>}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[500px] text-left text-body-sm">
                <thead><tr className="border-b border-outline-variant"><th className="p-2">Product</th><th>Qty</th><th>HT (TND)</th><th>VAT rate(s)</th><th>VAT (TND)</th><th>TTC (TND)</th></tr></thead>
                <tbody>{selectedTransaction.items.map((item, index) => {
                  const lineSnapshot = selectedLineSnapshots[index];
                  const rates = new Set((lineSnapshot?.taxes ?? []).map((tax) =>
                    tax.ratePpm === undefined ? tax.treatment ?? 'Unknown' : `${(tax.ratePpm / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`));
                  return (
                    <tr key={`${item.name}-${index}`} className="border-b border-outline-variant last:border-0">
                      <td className="p-2">{item.name}</td><td>{item.quantity}</td>
                      <td>{formatOptionalMillimes(lineSnapshot?.netAmountMillimes)}</td>
                      <td>{[...rates].join(', ') || 'Unavailable'}</td>
                      <td>{formatOptionalMillimes(lineSnapshot?.totalTaxMillimes)}</td>
                      <td>{formatOptionalMillimes(lineSnapshot?.totalAmountMillimes)}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            <div className="mt-4 text-body-sm">
              <p>HT (TND): <strong>{formatSnapshotAmount(selectedTransaction, 'netAmountMillimes')}</strong></p>
              <p>VAT (TND): <strong>{formatSnapshotAmount(selectedTransaction, 'totalTaxMillimes')}</strong></p>
              <p>TTC (TND): <strong>{formatSnapshotAmount(selectedTransaction, 'totalAmountMillimes')}</strong></p>
            </div>
          </div>
        </div>
      )}
    </WorkspaceLayout>
  );
}
