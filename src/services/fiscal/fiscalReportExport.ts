import {
  formatFiscalTimestamp,
  getFiscalReportCounts,
  getFiscalSnapshotAmount,
  hasSnapshotBackedFiscalAmounts,
  type FiscalReport,
  type FiscalTransaction,
  type FiscalVatLine,
} from './fiscalReportService';
import { t } from '../../i18n';
import { formatMillimesWithThousands } from '../../lib/millimes';

const unavailable = () => t('fiscal.common.unavailable');

function taxTreatmentLabel(treatment: string): string {
  const keys: Record<string, string> = {
    taxable: 'fiscal.treatment.taxable',
    exempt: 'fiscal.treatment.exempt',
    outside_scope: 'fiscal.treatment.outsideScope',
    suspended: 'fiscal.treatment.suspended',
    special: 'fiscal.treatment.special',
  };
  return keys[treatment] ? t(keys[treatment] as never) : treatment.replaceAll('_', ' ');
}

function taxTypeLabel(taxType: string): string {
  const keys: Record<string, string> = {
    vat: 'fiscal.taxType.vat',
    consumption: 'fiscal.taxType.consumption',
    other: 'fiscal.taxType.other',
  };
  return keys[taxType] ? t(keys[taxType] as never) : taxType;
}

function snapshotNotice(report: FiscalReport): string {
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

function reportTimestamp(value: string, timezone: string): string {
  const formatted = formatFiscalTimestamp(value, timezone);
  return formatted === 'Unavailable' ? unavailable() : formatted;
}

export function formatFiscalMillimes(value: number): string {
  if (!Number.isSafeInteger(value)) return unavailable();
  return formatMillimesWithThousands(value);
}

function formatFiscalCsvMillimes(value: number): string {
  if (!Number.isSafeInteger(value)) return unavailable();
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 1000)}.${String(absolute % 1000).padStart(3, '0')}`;
}

function vatRate(line: FiscalVatLine): string {
  if (line.ratePpm === undefined) return taxTreatmentLabel(line.treatment);
  return `${(line.ratePpm / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

function reportAmount(report: FiscalReport, value: number): string {
  if (report.summary.missingSnapshotCount > 0 && !hasSnapshotBackedFiscalAmounts(report)) return unavailable();
  return formatFiscalMillimes(value);
}

function reportAmountTnd(report: FiscalReport, value: number): number | string {
  if (report.summary.missingSnapshotCount > 0 && !hasSnapshotBackedFiscalAmounts(report)) return unavailable();
  return Number.isSafeInteger(value) ? value / 1000 : unavailable();
}

function reportAmountCsv(report: FiscalReport, value: number): string {
  if (report.summary.missingSnapshotCount > 0 && !hasSnapshotBackedFiscalAmounts(report)) return unavailable();
  return formatFiscalCsvMillimes(value);
}

function reportAmountLabel(report: FiscalReport, label: string): string {
  return report.summary.missingSnapshotCount > 0 ? t('fiscalReports.snapshotBacked', { label }) : label;
}

function reportAmountText(report: FiscalReport, value: number): string {
  const amount = reportAmount(report, value);
  return amount === unavailable() ? amount : `${amount} TND`;
}

function transactionAmountTnd(report: FiscalReport, transaction: FiscalTransaction, key: 'netAmountMillimes' | 'totalTaxMillimes' | 'totalAmountMillimes'): number | string {
  const amount = getFiscalSnapshotAmount(transaction, key);
  return amount === undefined ? unavailable() : reportAmountTnd(report, amount);
}

function transactionCsvAmount(transaction: FiscalTransaction, key: 'netAmountMillimes' | 'totalTaxMillimes' | 'totalAmountMillimes'): string {
  const amount = getFiscalSnapshotAmount(transaction, key);
  return amount === undefined ? unavailable() : formatFiscalCsvMillimes(amount);
}

function fiscalReportMetadataRows(report: FiscalReport, period: string): string[][] {
  const counts = getFiscalReportCounts(report);
  return [
    [t('fiscalExport.store'), report.store.name, t('fiscalReports.period'), period],
    [t('fiscalReports.completedTransactions'), String(counts.completed), t('fiscalReports.voidedTransactions'), String(counts.voided)],
    [t('fiscalReports.pendingVoidTransactions'), String(counts.pendingVoid), t('fiscalExport.missingSnapshots'), String(counts.missingSnapshots)],
    [reportAmountLabel(report, t('fiscalReports.grossTtcTnd')), reportAmountCsv(report, report.summary.grossAmountMillimes)],
    [reportAmountLabel(report, t('fiscalReports.netHtTnd')), reportAmountCsv(report, report.summary.netAmountMillimes)],
    [reportAmountLabel(report, t('fiscalReports.vatTnd')), reportAmountCsv(report, report.summary.vatAmountMillimes)],
    [reportAmountLabel(report, t('fiscalReports.finalPayableTnd')), reportAmountCsv(report, report.summary.payableAmountMillimes)],
    [t('fiscalExport.snapshotReconciliation'), reconciliationStatus(report)],
    [t('fiscalExport.reconciliationBasis'), t('fiscalExport.reconciliationBasisValue')],
    [t('fiscalExport.snapshotNotice'), snapshotNotice(report)],
    [t('fiscalExport.refundsCredits'), t('fiscalExport.refundsUnavailable')],
  ];
}

function snapshotRates(transaction: FiscalTransaction): string {
  const rawLines = transaction.snapshot?.lines;
  if (!Array.isArray(rawLines)) return unavailable();
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
        rates.add(taxTreatmentLabel(tax.treatment));
      }
    }
  }
  return [...rates].join(', ') || unavailable();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",;\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function createFiscalCsv(report: FiscalReport, kind: 'transactions' | 'vat'): string {
  const period = t('fiscalReports.periodRangeExclusive', { start: report.period.startDate, end: report.period.endDateExclusive, timezone: report.period.timezone });
  const metadataRows = fiscalReportMetadataRows(report, period);
  let rows: string[][];
  if (kind === 'transactions') {
    rows = [
      ...metadataRows,
      [],
      [t('fiscalReports.order'), t('fiscalExport.businessDateStoreTimezone'), t('fiscalExport.timestampIso'), t('fiscalReports.customer'), t('fiscalReports.staff'), t('fiscalReports.items'), t('fiscalReports.netHtTnd'), t('fiscalReports.vatRate'), t('fiscalReports.vatTnd'), t('fiscalReports.grossTtcTnd'), t('fiscalReports.payment'), t('fiscalExport.paymentStatus'), t('fiscalReports.status'), t('fiscalReports.voidReason')],
      ...report.transactions.map((transaction) => [
        String(transaction.number),
        transaction.businessDate,
        transaction.createdAt,
        transaction.customer ?? '',
        transaction.staff ?? '',
        transaction.items.map((item) => `${item.name} x${item.quantity}`).join(' | '),
        transactionCsvAmount(transaction, 'netAmountMillimes'),
        transaction.snapshot ? snapshotRates(transaction) : unavailable(),
        transactionCsvAmount(transaction, 'totalTaxMillimes'),
        transactionCsvAmount(transaction, 'totalAmountMillimes'),
        transaction.paymentMethod,
        transaction.paymentStatus,
        transaction.status,
        transaction.voidReason ?? '',
      ]),
    ];
  } else {
    rows = [
      ...metadataRows,
      [t('fiscalExport.vatBreakdownAvailability'), report.vatBreakdown.length === 0
        ? t('fiscalReports.noVatBreakdown')
        : t('fiscalExport.vatBreakdownAvailable')],
      [],
      [t('fiscalExport.rateTreatment'), t('fiscal.profile.taxType'), 'Taxable HT TND', 'VAT TND', 'TTC TND', t('fiscalReports.transactionCount')],
      ...report.vatBreakdown.map((line) => [
        vatRate(line),
        taxTypeLabel(line.taxType),
        formatFiscalCsvMillimes(line.taxableHTMillimes),
        formatFiscalCsvMillimes(line.vatMillimes),
        formatFiscalCsvMillimes(line.ttcMillimes),
        String(line.transactionCount),
      ]),
    ];
  }
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function exportFiscalCsv(report: FiscalReport, kind: 'transactions' | 'vat'): void {
  const csv = createFiscalCsv(report, kind);
  const fileKind = kind === 'transactions' ? t('fiscalReports.export.transactionsCsvFile') : t('fiscalReports.export.vatCsvFile');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${fileKind}-${report.period.startDate}-${report.period.endDateExclusive}.csv`);
}

export async function createFiscalWorkbook(report: FiscalReport) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const counts = getFiscalReportCounts(report);
  const period = t('fiscalReports.periodRangeExclusiveShort', { start: report.period.startDate, end: report.period.endDateExclusive });
  const summaryRows = [
    [t('fiscalExport.workbookTitle')],
    [snapshotNotice(report)],
    [t('fiscalExport.store'), report.store.name],
    [t('fiscalExport.legalName'), report.profile?.legalName ?? report.store.name],
    [t('fiscalExport.taxIdentifier'), report.profile?.taxId ?? report.store.taxId ?? t('fiscal.common.notConfigured')],
    [t('fiscalExport.reportingPeriod'), period],
    [t('fiscalExport.timezone'), report.period.timezone],
    [t('fiscalExport.generatedAt'), report.generatedAt],
    [t('fiscalExport.currency'), 'TND'],
    [],
    [t('fiscalReports.completedTransactions'), counts.completed],
    [t('fiscalReports.voidedTransactions'), counts.voided],
    [t('fiscalReports.pendingVoidTransactions'), counts.pendingVoid],
    [t('fiscalExport.missingSnapshots'), counts.missingSnapshots],
    [reportAmountLabel(report, t('fiscalReports.grossTtcTnd')), reportAmountTnd(report, report.summary.grossAmountMillimes)],
    [reportAmountLabel(report, t('fiscalReports.netHtTnd')), reportAmountTnd(report, report.summary.netAmountMillimes)],
    [reportAmountLabel(report, t('fiscalReports.vatTnd')), reportAmountTnd(report, report.summary.vatAmountMillimes)],
    [reportAmountLabel(report, t('fiscalReports.finalPayableTnd')), reportAmountTnd(report, report.summary.payableAmountMillimes)],
    [t('fiscalExport.snapshotReconciliation'), reconciliationStatus(report)],
    [t('fiscalExport.reconciliationBasis'), t('fiscalExport.reconciliationBasisValue')],
    [t('fiscalExport.refundsCredits'), t('fiscalExport.refundsUnavailable')],
    [],
    [t('fiscalReports.payment'), t('fiscalReports.salesTnd'), t('fiscalReports.collectedTnd')],
    [t('fiscalReports.payment.cash'), report.payments.sales.cash / 1000, report.payments.collected.cash / 1000],
    [t('fiscalReports.payment.card'), report.payments.sales.card / 1000, report.payments.collected.card / 1000],
    [t('fiscalReports.payment.other'), report.payments.sales.other / 1000, report.payments.collected.other / 1000],
    [t('fiscalReports.payment.tab'), report.payments.sales.tab / 1000, report.payments.collected.tab / 1000],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } }];
  summarySheet['!rows'] = [];
  summarySheet['!rows'][1] = { hpt: 36 };
  const summarySheetName = t('fiscalExport.sheet.summary');
  const vatSheetName = t('fiscalExport.sheet.vatBreakdown');
  const transactionSheetName = t('fiscalExport.sheet.transactions');
  const adjustmentsSheetName = t('fiscalExport.sheet.adjustments');
  XLSX.utils.book_append_sheet(workbook, summarySheet, summarySheetName);

  const vatRows = [
    [t('fiscalReports.vatRate'), t('fiscal.profile.taxType'), t('fiscal.classification.treatment'), t('fiscalExport.taxableHtTnd'), t('fiscalReports.vatTnd'), t('fiscalReports.grossTtcTnd'), t('fiscalReports.transactions')],
    ...report.vatBreakdown.map((line) => [
      vatRate(line), taxTypeLabel(line.taxType), taxTreatmentLabel(line.treatment),
      line.taxableHTMillimes / 1000, line.vatMillimes / 1000, line.ttcMillimes / 1000, line.transactionCount,
    ]),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(vatRows), vatSheetName);

  const transactionRows = [
    [t('fiscalReports.order'), t('fiscalExport.businessDateStoreTimezone'), t('fiscalExport.timestampIso'), t('fiscalReports.customer'), t('fiscalReports.staff'), t('fiscalReports.items'), t('fiscalReports.netHtTnd'), t('fiscalReports.vatRates'), t('fiscalReports.vatTnd'), t('fiscalReports.grossTtcTnd'), t('fiscalReports.payment'), t('fiscalReports.status')],
    ...report.transactions.map((transaction) => {
      const amounts = transaction.snapshot
        ? [
            transactionAmountTnd(report, transaction, 'netAmountMillimes'),
            snapshotRates(transaction),
            transactionAmountTnd(report, transaction, 'totalTaxMillimes'),
            transactionAmountTnd(report, transaction, 'totalAmountMillimes'),
          ]
        : [unavailable(), unavailable(), unavailable(), unavailable()];
      return [
        transaction.number, transaction.businessDate, transaction.createdAt, transaction.customer ?? '', transaction.staff ?? '',
        transaction.items.map((item) => `${item.name} x${item.quantity}`).join(' | '),
        amounts[0], amounts[1], amounts[2], amounts[3],
        transaction.paymentMethod, transaction.status,
      ];
    }),
  ];
  const transactionSheet = XLSX.utils.aoa_to_sheet(transactionRows);
  XLSX.utils.book_append_sheet(workbook, transactionSheet, transactionSheetName);

  const adjustmentRows = [
    [t('fiscalExport.adjustment'), t('fiscalExport.reference'), t('fiscalExport.amountTnd'), t('fiscalExport.timestamp'), t('fiscalExport.detail')],
    ...report.adjustments.voidAdjustments.map((row) => [
      t('fiscalExport.voidAdjustment'),
      String(row.orderNumber ?? row.orderId ?? ''),
      typeof row.amountMillimes === 'number' && Number.isSafeInteger(row.amountMillimes) ? row.amountMillimes / 1000 : unavailable(),
      String(row.createdAt ?? ''),
      '',
    ]),
    ...report.adjustments.cashMovements.map((row) => [
      t('fiscalExport.cashMovement', { kind: String(row.kind ?? '') }),
      String(row.reason ?? ''),
      typeof row.amountMillimes === 'number' && Number.isSafeInteger(row.amountMillimes)
        ? (row.kind === 'out' ? -row.amountMillimes : row.amountMillimes) / 1000
        : unavailable(),
      String(row.createdAt ?? ''),
      String(row.note ?? ''),
    ]),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(adjustmentRows), adjustmentsSheetName);

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    for (const [address, cell] of Object.entries(sheet)) {
      if (!address.startsWith('!') && cell && typeof cell === 'object' && typeof cell.v === 'number') {
        const { r, c } = XLSX.utils.decode_cell(address);
        const monetaryCell = sheetName === summarySheetName
          ? (c === 1 && r >= 14 && r <= 17)
            || (c === 1 || c === 2) && r >= 23
          : sheetName === vatSheetName
            ? c >= 3 && c <= 5 && r > 0
            : sheetName === transactionSheetName
              ? [6, 8, 9].includes(c) && r > 0
              : sheetName === adjustmentsSheetName && c === 2 && r > 0;
        if (monetaryCell) {
          cell.z = '#,##0.000 "TND"';
        }
      }
    }
    const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1');
    const widths: Array<{ wch: number }> = [];
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      let width = 10;
      for (let row = range.s.r; row <= range.e.r; row += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell?.v !== undefined) width = Math.max(width, Math.min(String(cell.v).length + 2, 48));
      }
      widths.push({ wch: width });
    }
    sheet['!cols'] = widths;
  }
  return workbook;
}

export async function exportFiscalXlsx(report: FiscalReport): Promise<void> {
  const XLSX = await import('xlsx');
  const workbook = await createFiscalWorkbook(report);
  const contents = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([contents], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, `${t('fiscalReports.export.xlsxFile')}-${report.period.startDate}-${report.period.endDateExclusive}.xlsx`);
}

export async function createFiscalPdfBlob(report: FiscalReport): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text(t('fiscalReports.title'), 14, 16);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  let y = 24;
  const line = (text: string) => {
    const lines = pdf.splitTextToSize(text, 182) as string[];
    for (const item of lines) {
      if (y > 278) { pdf.addPage(); y = 14; }
      pdf.text(item, 14, y);
      y += 5;
    }
  };
  line(`${t('fiscalExport.store')}: ${report.profile?.tradingName ?? report.profile?.legalName ?? report.store.name}`);
  line(t('fiscalExport.addressPhone', {
    address: report.store.address ?? t('fiscal.common.notConfigured'),
    phone: report.store.phone ?? t('fiscal.common.notConfigured'),
  }));
  line(`${t('fiscalExport.taxIdentifier')}: ${report.profile?.taxId ?? report.store.taxId ?? t('fiscal.common.notConfigured')}`);
  line(`${t('fiscalReports.period')}: ${t('fiscalReports.periodRangeExclusive', { start: report.period.startDate, end: report.period.endDateExclusive, timezone: report.period.timezone })}`);
  line(`${t('fiscalExport.generatedAt')}: ${report.generatedAt}`);
  line(`${t('fiscalExport.currency')}: TND`);
  line(t('fiscalExport.pdfDisclaimer'));
  if (report.summary.missingSnapshotCount > 0) {
    const warning = pdf.splitTextToSize(snapshotNotice(report), 174) as string[];
    const warningHeight = warning.length * 5 + 6;
    if (y + warningHeight > 278) { pdf.addPage(); y = 14; }
    pdf.setDrawColor(180, 83, 9);
    pdf.setFillColor(255, 247, 237);
    pdf.roundedRect(12, y - 4, 186, warningHeight, 2, 2, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(124, 45, 18);
    for (const item of warning) {
      pdf.text(item, 16, y);
      y += 5;
    }
    pdf.setTextColor(0, 0, 0);
    pdf.setFont('helvetica', 'normal');
    y += 5;
  } else {
    line(snapshotNotice(report));
  }
  const counts = getFiscalReportCounts(report);
  y += 3;
  line(`${t('fiscalReports.completedTransactions')}: ${counts.completed}`);
  line(`${t('fiscalReports.voidedTransactions')}: ${counts.voided}`);
  line(`${t('fiscalReports.pendingVoidTransactions')}: ${counts.pendingVoid}`);
  line(`${t('fiscalExport.missingSnapshots')}: ${counts.missingSnapshots}`);
  line(`${reportAmountLabel(report, t('fiscalReports.grossTtc'))}: ${reportAmountText(report, report.summary.grossAmountMillimes)}`);
  line(`${reportAmountLabel(report, t('fiscalReports.netHt'))}: ${reportAmountText(report, report.summary.netAmountMillimes)}`);
  line(`${reportAmountLabel(report, t('fiscalReports.vat'))}: ${reportAmountText(report, report.summary.vatAmountMillimes)}`);
  line(`${reportAmountLabel(report, t('fiscalReports.finalPayable'))}: ${reportAmountText(report, report.summary.payableAmountMillimes)}`);
  y += 3;
  line(t('fiscalReports.vatBreakdown'));
  if (report.vatBreakdown.length === 0) {
    line(t('fiscalReports.noVatBreakdownStored'));
  } else {
    for (const vat of report.vatBreakdown) {
      line(t('fiscalExport.vatLine', {
        rate: vatRate(vat),
        ht: formatFiscalMillimes(vat.taxableHTMillimes),
        vat: formatFiscalMillimes(vat.vatMillimes),
        ttc: formatFiscalMillimes(vat.ttcMillimes),
        count: vat.transactionCount,
      }));
    }
  }
  y += 3;
  line(t('fiscalExport.paymentTotals', {
    label: t('fiscalReports.sales'),
    cash: formatFiscalMillimes(report.payments.sales.cash),
    card: formatFiscalMillimes(report.payments.sales.card),
    other: formatFiscalMillimes(report.payments.sales.other),
    tab: formatFiscalMillimes(report.payments.sales.tab),
  }));
  line(t('fiscalExport.paymentTotals', {
    label: t('fiscalReports.collected'),
    cash: formatFiscalMillimes(report.payments.collected.cash),
    card: formatFiscalMillimes(report.payments.collected.card),
    other: formatFiscalMillimes(report.payments.collected.other),
    tab: formatFiscalMillimes(report.payments.collected.tab),
  }));
  y += 3;
  line(t('fiscalExport.voidSummary', { count: counts.voided, amount: formatFiscalMillimes(report.adjustments.voidedGrossMillimes) }));
  line(`${t('fiscalExport.refundsCredits')}: ${t('fiscalExport.refundsUnavailable')}`);
  line(`${t('fiscalExport.snapshotReconciliation')}: ${reconciliationStatus(report)}`);
  line(`${t('fiscalExport.reconciliationBasis')}: ${t('fiscalExport.reconciliationBasisValue')}`);
  y += 3;
  line(t('fiscalReports.transactions'));
  for (const transaction of report.transactions) {
    const fiscalAmounts = t('fiscalExport.transactionAmounts', {
      ht: transactionAmountTnd(report, transaction, 'netAmountMillimes'),
      vat: transactionAmountTnd(report, transaction, 'totalTaxMillimes'),
      ttc: transactionAmountTnd(report, transaction, 'totalAmountMillimes'),
    });
    line(t('fiscalExport.transactionLine', {
      number: transaction.number,
      date: transaction.businessDate,
      timestamp: reportTimestamp(transaction.createdAt, report.period.timezone),
      timezone: report.period.timezone,
      customer: transaction.customer ?? t('fiscal.common.walkIn'),
      staff: transaction.staff ?? t('fiscal.common.unknown'),
      amounts: fiscalAmounts,
      payment: transaction.paymentMethod,
      status: transaction.status,
    }));
  }
  return pdf.output('blob');
}

export async function downloadFiscalPdf(report: FiscalReport): Promise<void> {
  const blob = await createFiscalPdfBlob(report);
  downloadBlob(blob, `${t('fiscalReports.export.pdfFile')}-${report.period.startDate}-${report.period.endDateExclusive}.pdf`);
}

export async function previewFiscalPdf(report: FiscalReport): Promise<string> {
  const blob = await createFiscalPdfBlob(report);
  return URL.createObjectURL(blob);
}

export async function printFiscalPdf(report: FiscalReport): Promise<void> {
  const url = await previewFiscalPdf(report);
  const printWindow = window.open(url, '_blank', 'noopener,noreferrer');
  if (!printWindow) throw new Error(t('fiscalReports.error.popupBlocked'));
  printWindow.addEventListener('load', () => printWindow.print());
}
