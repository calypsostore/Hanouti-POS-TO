import {
  formatFiscalTimestamp,
  getFiscalReportCounts,
  getFiscalReconciliationStatus,
  getFiscalSnapshotAmount,
  getFiscalSnapshotNotice,
  hasSnapshotBackedFiscalAmounts,
  type FiscalReport,
  type FiscalTransaction,
  type FiscalVatLine,
} from './fiscalReportService';

export function formatFiscalMillimes(value: number): string {
  if (!Number.isSafeInteger(value)) return 'Unavailable';
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 1000).toLocaleString('en-US')}.${String(absolute % 1000).padStart(3, '0')}`;
}

function formatFiscalCsvMillimes(value: number): string {
  if (!Number.isSafeInteger(value)) return 'Unavailable';
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 1000)}.${String(absolute % 1000).padStart(3, '0')}`;
}

function vatRate(line: FiscalVatLine): string {
  if (line.ratePpm === undefined) return line.treatment === 'exempt' ? 'Exempt' : line.treatment.replaceAll('_', ' ');
  return `${(line.ratePpm / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

function reportAmount(report: FiscalReport, value: number): string {
  if (report.summary.missingSnapshotCount > 0 && !hasSnapshotBackedFiscalAmounts(report)) return 'Unavailable';
  return formatFiscalMillimes(value);
}

function reportAmountTnd(report: FiscalReport, value: number): number | string {
  if (report.summary.missingSnapshotCount > 0 && !hasSnapshotBackedFiscalAmounts(report)) return 'Unavailable';
  return Number.isSafeInteger(value) ? value / 1000 : 'Unavailable';
}

function reportAmountCsv(report: FiscalReport, value: number): string {
  if (report.summary.missingSnapshotCount > 0 && !hasSnapshotBackedFiscalAmounts(report)) return 'Unavailable';
  return formatFiscalCsvMillimes(value);
}

function reportAmountLabel(report: FiscalReport, label: string): string {
  return report.summary.missingSnapshotCount > 0 ? `Snapshot-backed ${label}` : label;
}

function reportAmountText(report: FiscalReport, value: number): string {
  const amount = reportAmount(report, value);
  return amount === 'Unavailable' ? amount : `${amount} TND`;
}

function transactionAmountTnd(report: FiscalReport, transaction: FiscalTransaction, key: 'netAmountMillimes' | 'totalTaxMillimes' | 'totalAmountMillimes'): number | string {
  const amount = getFiscalSnapshotAmount(transaction, key);
  return amount === undefined ? 'Unavailable' : reportAmountTnd(report, amount);
}

function transactionCsvAmount(transaction: FiscalTransaction, key: 'netAmountMillimes' | 'totalTaxMillimes' | 'totalAmountMillimes'): string {
  const amount = getFiscalSnapshotAmount(transaction, key);
  return amount === undefined ? 'Unavailable' : formatFiscalCsvMillimes(amount);
}

function fiscalReportMetadataRows(report: FiscalReport, period: string): string[][] {
  const counts = getFiscalReportCounts(report);
  return [
    ['Store', report.store.name, 'Period', period],
    ['Completed transactions', String(counts.completed), 'Voided transactions', String(counts.voided)],
    ['Pending void transactions', String(counts.pendingVoid), 'Transactions missing fiscal snapshots', String(counts.missingSnapshots)],
    [reportAmountLabel(report, 'Gross TTC (TND)'), reportAmountCsv(report, report.summary.grossAmountMillimes)],
    [reportAmountLabel(report, 'Net HT (TND)'), reportAmountCsv(report, report.summary.netAmountMillimes)],
    [reportAmountLabel(report, 'VAT (TND)'), reportAmountCsv(report, report.summary.vatAmountMillimes)],
    [reportAmountLabel(report, 'Final payable (TND)'), reportAmountCsv(report, report.summary.payableAmountMillimes)],
    ['Snapshot reconciliation', getFiscalReconciliationStatus(report)],
    ['Reconciliation basis', 'HT + VAT = TTC using stored fiscal snapshots only'],
    ['Fiscal snapshot notice', getFiscalSnapshotNotice(report)],
    ['Refunds and credit notes', 'Unavailable in the existing data model; not included'],
  ];
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
  const period = `${report.period.startDate} to ${report.period.endDateExclusive} (exclusive), ${report.period.timezone}`;
  const metadataRows = fiscalReportMetadataRows(report, period);
  let rows: string[][];
  if (kind === 'transactions') {
    rows = [
      ...metadataRows,
      [],
      ['Order', 'Business date (store timezone)', 'Timestamp (ISO)', 'Customer', 'Staff', 'Items', 'HT TND', 'VAT rate', 'VAT TND', 'TTC TND', 'Payment', 'Payment status', 'Status', 'Void reason'],
      ...report.transactions.map((transaction) => [
        String(transaction.number),
        transaction.businessDate,
        transaction.createdAt,
        transaction.customer ?? '',
        transaction.staff ?? '',
        transaction.items.map((item) => `${item.name} x${item.quantity}`).join(' | '),
        transactionCsvAmount(transaction, 'netAmountMillimes'),
        transaction.snapshot ? snapshotRates(transaction) : 'Unavailable',
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
      ['VAT breakdown availability', report.vatBreakdown.length === 0
        ? 'No snapshot-backed VAT breakdown is available for this period.'
        : 'Snapshot-backed VAT breakdown available.'],
      [],
      ['Rate / treatment', 'Tax type', 'Taxable HT TND', 'VAT TND', 'TTC TND', 'Transaction count'],
      ...report.vatBreakdown.map((line) => [
        vatRate(line),
        line.taxType,
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
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `fiscal-${kind}-${report.period.startDate}-${report.period.endDateExclusive}.csv`);
}

export async function createFiscalWorkbook(report: FiscalReport) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const counts = getFiscalReportCounts(report);
  const period = `${report.period.startDate} to ${report.period.endDateExclusive} (end exclusive)`;
  const summaryRows = [
    ['Fiscal report - Internal accounting support'],
    [getFiscalSnapshotNotice(report)],
    ['Store', report.store.name],
    ['Legal name', report.profile?.legalName ?? report.store.name],
    ['Tax identifier', report.profile?.taxId ?? report.store.taxId ?? 'Not configured'],
    ['Reporting period', period],
    ['Timezone', report.period.timezone],
    ['Generated at', report.generatedAt],
    ['Currency', 'TND'],
    [],
    ['Completed transactions', counts.completed],
    ['Voided transactions', counts.voided],
    ['Pending void transactions', counts.pendingVoid],
    ['Transactions missing fiscal snapshots', counts.missingSnapshots],
    [reportAmountLabel(report, 'Gross TTC (TND)'), reportAmountTnd(report, report.summary.grossAmountMillimes)],
    [reportAmountLabel(report, 'Net HT (TND)'), reportAmountTnd(report, report.summary.netAmountMillimes)],
    [reportAmountLabel(report, 'VAT (TND)'), reportAmountTnd(report, report.summary.vatAmountMillimes)],
    [reportAmountLabel(report, 'Final payable (TND)'), reportAmountTnd(report, report.summary.payableAmountMillimes)],
    ['Snapshot reconciliation', getFiscalReconciliationStatus(report)],
    ['Reconciliation basis', 'HT + VAT = TTC using stored fiscal snapshots only'],
    ['Refunds and credit notes', 'Unavailable in the existing data model; not included'],
    [],
    ['Payment', 'Sales (TND)', 'Collected (TND)'],
    ['Cash', report.payments.sales.cash / 1000, report.payments.collected.cash / 1000],
    ['Card', report.payments.sales.card / 1000, report.payments.collected.card / 1000],
    ['Other', report.payments.sales.other / 1000, report.payments.collected.other / 1000],
    ['Tab', report.payments.sales.tab / 1000, report.payments.collected.tab / 1000],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } }];
  summarySheet['!rows'] = [];
  summarySheet['!rows'][1] = { hpt: 36 };
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  const vatRows = [
    ['VAT rate', 'Tax type', 'Treatment', 'Taxable HT (TND)', 'VAT (TND)', 'TTC (TND)', 'Transactions'],
    ...report.vatBreakdown.map((line) => [
      vatRate(line), line.taxType, line.treatment,
      line.taxableHTMillimes / 1000, line.vatMillimes / 1000, line.ttcMillimes / 1000, line.transactionCount,
    ]),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(vatRows), 'VAT Breakdown');

  const transactionRows = [
    ['Order', 'Business date (store timezone)', 'Timestamp (ISO)', 'Customer', 'Staff', 'Items', 'HT (TND)', 'VAT rate(s)', 'VAT (TND)', 'TTC (TND)', 'Payment', 'Status'],
    ...report.transactions.map((transaction) => {
      const amounts = transaction.snapshot
        ? [
            transactionAmountTnd(report, transaction, 'netAmountMillimes'),
            snapshotRates(transaction),
            transactionAmountTnd(report, transaction, 'totalTaxMillimes'),
            transactionAmountTnd(report, transaction, 'totalAmountMillimes'),
          ]
        : ['Unavailable', 'Unavailable', 'Unavailable', 'Unavailable'];
      return [
        transaction.number, transaction.businessDate, transaction.createdAt, transaction.customer ?? '', transaction.staff ?? '',
        transaction.items.map((item) => `${item.name} x${item.quantity}`).join(' | '),
        amounts[0], amounts[1], amounts[2], amounts[3],
        transaction.paymentMethod, transaction.status,
      ];
    }),
  ];
  const transactionSheet = XLSX.utils.aoa_to_sheet(transactionRows);
  XLSX.utils.book_append_sheet(workbook, transactionSheet, 'Transactions');

  const adjustmentRows = [
    ['Adjustment', 'Reference', 'Amount (TND)', 'Timestamp', 'Detail'],
    ...report.adjustments.voidAdjustments.map((row) => [
      'Void adjustment',
      String(row.orderNumber ?? row.orderId ?? ''),
      typeof row.amountMillimes === 'number' && Number.isSafeInteger(row.amountMillimes) ? row.amountMillimes / 1000 : 'Unavailable',
      String(row.createdAt ?? ''),
      '',
    ]),
    ...report.adjustments.cashMovements.map((row) => [
      `Cash movement ${String(row.kind ?? '')}`,
      String(row.reason ?? ''),
      typeof row.amountMillimes === 'number' && Number.isSafeInteger(row.amountMillimes)
        ? (row.kind === 'out' ? -row.amountMillimes : row.amountMillimes) / 1000
        : 'Unavailable',
      String(row.createdAt ?? ''),
      String(row.note ?? ''),
    ]),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(adjustmentRows), 'Adjustments');

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    for (const [address, cell] of Object.entries(sheet)) {
      if (!address.startsWith('!') && cell && typeof cell === 'object' && typeof cell.v === 'number') {
        const { r, c } = XLSX.utils.decode_cell(address);
        const monetaryCell = sheetName === 'Summary'
          ? (c === 1 && ['Gross TTC (TND)', 'Snapshot-backed Gross TTC (TND)', 'Net HT (TND)', 'Snapshot-backed Net HT (TND)', 'VAT (TND)', 'Snapshot-backed VAT (TND)', 'Final payable (TND)', 'Snapshot-backed Final payable (TND)'].includes(String(sheet[XLSX.utils.encode_cell({ r, c: 0 })]?.v)))
            || (c === 1 || c === 2) && ['Cash', 'Card', 'Other', 'Tab'].includes(String(sheet[XLSX.utils.encode_cell({ r, c: 0 })]?.v))
          : sheetName === 'VAT Breakdown'
            ? c >= 3 && c <= 5 && r > 0
            : sheetName === 'Transactions'
              ? [6, 8, 9].includes(c) && r > 0
              : sheetName === 'Adjustments' && c === 2 && r > 0;
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
  downloadBlob(blob, `fiscal-report-${report.period.startDate}-${report.period.endDateExclusive}.xlsx`);
}

export async function createFiscalPdfBlob(report: FiscalReport): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('Fiscal Reports & Tax Tracking', 14, 16);
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
  line(`Store: ${report.profile?.tradingName ?? report.profile?.legalName ?? report.store.name}`);
  line(`Address: ${report.store.address ?? 'Not configured'} | Phone: ${report.store.phone ?? 'Not configured'}`);
  line(`Tax identifier: ${report.profile?.taxId ?? report.store.taxId ?? 'Not configured'}`);
  line(`Period: ${report.period.startDate} to ${report.period.endDateExclusive} (end exclusive), ${report.period.timezone}`);
  line(`Generated: ${report.generatedAt}`);
  line('Currency: TND');
  line('This is an internal fiscal/accounting report. It is not an official Tunisian tax declaration.');
  if (report.summary.missingSnapshotCount > 0) {
    const warning = pdf.splitTextToSize(getFiscalSnapshotNotice(report), 174) as string[];
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
    line(getFiscalSnapshotNotice(report));
  }
  const counts = getFiscalReportCounts(report);
  y += 3;
  line(`Completed transactions: ${counts.completed}`);
  line(`Voided transactions: ${counts.voided}`);
  line(`Pending void transactions: ${counts.pendingVoid}`);
  line(`Transactions missing fiscal snapshots: ${counts.missingSnapshots}`);
  line(`${reportAmountLabel(report, 'Gross TTC')}: ${reportAmountText(report, report.summary.grossAmountMillimes)}`);
  line(`${reportAmountLabel(report, 'Net HT')}: ${reportAmountText(report, report.summary.netAmountMillimes)}`);
  line(`${reportAmountLabel(report, 'VAT')}: ${reportAmountText(report, report.summary.vatAmountMillimes)}`);
  line(`${reportAmountLabel(report, 'Final payable')}: ${reportAmountText(report, report.summary.payableAmountMillimes)}`);
  y += 3;
  line('VAT breakdown');
  if (report.vatBreakdown.length === 0) {
    line('No VAT breakdown is available from stored fiscal snapshots.');
  } else {
    for (const vat of report.vatBreakdown) {
      line(`${vatRate(vat)} | HT ${formatFiscalMillimes(vat.taxableHTMillimes)} | VAT ${formatFiscalMillimes(vat.vatMillimes)} | TTC ${formatFiscalMillimes(vat.ttcMillimes)} | transactions ${vat.transactionCount}`);
    }
  }
  y += 3;
  line(`Payments - Sales cash/card/other/tab: ${formatFiscalMillimes(report.payments.sales.cash)} / ${formatFiscalMillimes(report.payments.sales.card)} / ${formatFiscalMillimes(report.payments.sales.other)} / ${formatFiscalMillimes(report.payments.sales.tab)} TND`);
  line(`Payments - Collected cash/card/other/tab: ${formatFiscalMillimes(report.payments.collected.cash)} / ${formatFiscalMillimes(report.payments.collected.card)} / ${formatFiscalMillimes(report.payments.collected.other)} / ${formatFiscalMillimes(report.payments.collected.tab)} TND`);
  y += 3;
  line(`Voids: ${counts.voided} transactions, ${formatFiscalMillimes(report.adjustments.voidedGrossMillimes)} TND`);
  line('Refunds and credit notes: unavailable in the existing data model; not included');
  line(`Snapshot reconciliation: ${getFiscalReconciliationStatus(report)}`);
  line('Reconciliation basis: HT + VAT = TTC using stored fiscal snapshots only');
  y += 3;
  line('Transactions');
  for (const transaction of report.transactions) {
    const fiscalAmounts = `HT ${transactionAmountTnd(report, transaction, 'netAmountMillimes')} | VAT ${transactionAmountTnd(report, transaction, 'totalTaxMillimes')} | TTC ${transactionAmountTnd(report, transaction, 'totalAmountMillimes')}`;
    line(`#${transaction.number} | ${transaction.businessDate} ${formatFiscalTimestamp(transaction.createdAt, report.period.timezone)} (${report.period.timezone}) | ${transaction.customer ?? 'Walk-in'} | Staff ${transaction.staff ?? 'Unknown'} | ${fiscalAmounts} | ${transaction.paymentMethod} | ${transaction.status}`);
  }
  return pdf.output('blob');
}

export async function downloadFiscalPdf(report: FiscalReport): Promise<void> {
  const blob = await createFiscalPdfBlob(report);
  downloadBlob(blob, `fiscal-report-${report.period.startDate}-${report.period.endDateExclusive}.pdf`);
}

export async function previewFiscalPdf(report: FiscalReport): Promise<string> {
  const blob = await createFiscalPdfBlob(report);
  return URL.createObjectURL(blob);
}

export async function printFiscalPdf(report: FiscalReport): Promise<void> {
  const url = await previewFiscalPdf(report);
  const printWindow = window.open(url, '_blank', 'noopener,noreferrer');
  if (!printWindow) throw new Error('Your browser blocked the PDF print window.');
  printWindow.addEventListener('load', () => printWindow.print());
}
