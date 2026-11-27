import { afterEach, describe, expect, it, vi } from 'vitest';
import { inflateSync } from 'node:zlib';
import * as XLSX from 'xlsx';
import {
  createFiscalCsv,
  createFiscalPdfBlob,
  createFiscalWorkbook,
  exportFiscalXlsx,
} from '../src/services/fiscal/fiscalReportExport';
import { getFiscalReportCounts, getFiscalReconciliationStatus, formatFiscalTimestamp, type FiscalReport } from '../src/services/fiscal/fiscalReportService';

const report: FiscalReport = {
  store: {
    id: 'fixture-store',
    name: 'Fiscal Fixture Store',
    timezone: 'Africa/Tunis',
    address: 'Local test address',
  },
  period: {
    startDate: '2026-03-01',
    endDateExclusive: '2026-03-02',
    timezone: 'Africa/Tunis',
  },
  generatedAt: '2026-03-02T00:00:00.000Z',
  profile: {
    legalName: 'Fiscal Fixture Store SARL',
    taxId: 'FIXTURE-ONLY',
    reviewStatus: 'confirmed',
  },
  summary: {
    transactionCount: 1,
    voidedTransactionCount: 0,
    netAmountMillimes: 2521,
    vatAmountMillimes: 479,
    grossAmountMillimes: 3000,
    payableAmountMillimes: 3000,
    missingSnapshotCount: 0,
    reconciliationValid: true,
  },
  vatBreakdown: [{
    taxType: 'vat',
    treatment: 'taxable',
    ratePpm: 190000,
    taxableHTMillimes: 2521,
    vatMillimes: 479,
    ttcMillimes: 3000,
    transactionCount: 1,
    transactionIds: ['fixture-order'],
  }],
  payments: {
    sales: { cash: 3000, card: 0, other: 0, tab: 0 },
    collected: { cash: 3000, card: 0, other: 0, tab: 0 },
    tabSettlements: { cash: 0, card: 0, other: 0, reversed: 0 },
  },
  adjustments: {
    voidedCount: 0,
    voidedGrossMillimes: 0,
    cashMovements: [],
    cashMovementsNetMillimes: 0,
    voidAdjustments: [],
    voidAdjustmentsTotalMillimes: 0,
    refundsAvailable: false,
    refundsMillimes: null,
    creditNotesAvailable: false,
  },
  transactions: [{
    id: 'fixture-order',
    number: 1,
    businessDate: '2026-03-01',
    createdAt: '2026-03-01T10:00:00.000Z',
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'done',
    snapshot: {
      netAmountMillimes: 2521,
      totalTaxMillimes: 479,
      totalAmountMillimes: 3000,
      lines: [{
        taxes: [{ ratePpm: 190000, treatment: 'taxable' }],
      }],
    },
    items: [{ name: 'Fixture product', quantity: 1, unitPriceMillimes: 3000, lineTotalMillimes: 3000 }],
  }],
};

const reportWithoutSnapshots: FiscalReport = {
  ...report,
  summary: {
    ...report.summary,
    transactionCount: 1,
    voidedTransactionCount: 1,
    netAmountMillimes: 0,
    vatAmountMillimes: 0,
    grossAmountMillimes: 0,
    payableAmountMillimes: 0,
    missingSnapshotCount: 2,
  },
  vatBreakdown: [],
  payments: {
    sales: { cash: 0, card: 0, other: 0, tab: 0 },
    collected: { cash: 0, card: 0, other: 0, tab: 0 },
    tabSettlements: { cash: 0, card: 0, other: 0, reversed: 0 },
  },
  adjustments: {
    ...report.adjustments,
    voidedCount: 1,
  },
  transactions: [
    { ...report.transactions[0], snapshot: undefined },
    {
      ...report.transactions[0],
      id: 'fixture-voided-order',
      number: 2,
      status: 'voided',
      snapshot: undefined,
      voidReason: 'Fixture void',
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function extractPdfStreams(blob: Blob): Promise<string> {
  const bytes = Buffer.from(await blob.arrayBuffer());
  const streamMarker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');
  const streams: string[] = [];
  let cursor = 0;
  while (true) {
    const streamStart = bytes.indexOf(streamMarker, cursor);
    if (streamStart < 0) break;
    let dataStart = streamStart + streamMarker.length;
    if (bytes[dataStart] === 13 && bytes[dataStart + 1] === 10) dataStart += 2;
    else if (bytes[dataStart] === 10) dataStart += 1;
    const streamEnd = bytes.indexOf(endMarker, dataStart);
    if (streamEnd < 0) break;
    let dataEnd = streamEnd;
    while (dataEnd > dataStart && (bytes[dataEnd - 1] === 10 || bytes[dataEnd - 1] === 13)) dataEnd -= 1;
    try {
      streams.push(inflateSync(bytes.subarray(dataStart, dataEnd)).toString('latin1'));
    } catch {
      // Some PDF streams are not Flate-compressed content streams.
    }
    cursor = streamEnd + endMarker.length;
  }
  return streams.join('\n');
}

describe('fiscal report exports', () => {
  it('exports UTF-8 CSV headings and exact millime amounts from the report', () => {
    const csv = createFiscalCsv(report, 'transactions');

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Store,Fiscal Fixture Store,Period,"2026-03-01 to 2026-03-02 (end exclusive), Africa/Tunis"');
    expect(csv).toContain('Order,Business date (store timezone),Timestamp (ISO),Customer,Staff,Items,Net HT (TND),VAT rate,VAT (TND),Gross TTC (TND),Payment,Payment status,Status,Void reason');
    expect(csv).toContain('1,2026-03-01,2026-03-01T10:00:00.000Z,,,Fixture product x1,2.521,19%,0.479,3.000,cash,paid,done,');
    expect(csv).toContain('Gross TTC (TND),3.000');
    expect(new TextDecoder('utf-8').decode(new TextEncoder().encode(csv))).toContain('Fiscal Fixture Store');
  });

  it('writes all four XLSX sheets and reconciled report amounts', async () => {
    const workbook = await createFiscalWorkbook(report);
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const exported = XLSX.read(bytes, { type: 'buffer', cellDates: true, cellNF: true });

    expect(exported.SheetNames).toEqual(['Summary', 'VAT Breakdown', 'Transactions', 'Adjustments']);
    expect(exported.Sheets.Summary?.B3?.v).toBe('Fiscal Fixture Store');
    expect(exported.Sheets.Summary?.B4?.v).toBe('Fiscal Fixture Store SARL');
    expect(exported.Sheets.Summary?.B6?.v).toBe('2026-03-01 to 2026-03-02 (end exclusive)');
    expect(exported.Sheets.Summary?.B11?.v).toBe(1);
    expect(exported.Sheets.Summary?.B12?.v).toBe(0);
    expect(exported.Sheets.Summary?.B13?.v).toBe(0);
    expect(exported.Sheets.Summary?.B14?.v).toBe(0);
    expect(exported.Sheets.Summary?.B15?.v).toBe(3);
    expect(exported.Sheets.Summary?.B16?.v).toBe(2.521);
    expect(exported.Sheets.Summary?.B17?.v).toBe(0.479);
    expect(exported.Sheets.Summary?.B18?.v).toBe(3);
    expect(exported.Sheets.Summary?.B15?.z).toBe('#,##0.000 "TND"');
    expect(exported.Sheets['VAT Breakdown']?.A2?.v).toBe('19%');
    expect(exported.Sheets.Transactions?.G2?.v).toBe(2.521);
    expect(exported.Sheets.Transactions?.G2?.z).toBe('#,##0.000 "TND"');
    expect(exported.Sheets.Transactions?.H2?.v).toBe('19%');
    expect(exported.Sheets.Transactions?.I2?.v).toBe(0.479);
    expect(exported.Sheets.Transactions?.J2?.v).toBe(3);
    expect(exported.Sheets.Adjustments?.A1?.v).toBe('Adjustment');
    expect(exported.Sheets.Adjustments?.E1?.v).toBe('Detail');
    expect(exported.Sheets.Adjustments?.A2?.v).toBeUndefined();
    expect(JSON.stringify(exported.Sheets)).not.toContain('Other store fixture');
  });

  it('downloads the valid workbook through the Blob download helper', async () => {
    const link = { href: '', download: '', click: vi.fn() };
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fiscal-report-test');
    const setTimeout = vi.fn();
    vi.stubGlobal('document', { createElement: vi.fn(() => link) });
    vi.stubGlobal('window', { setTimeout });

    await exportFiscalXlsx(report);

    expect(link.href).toBe('blob:fiscal-report-test');
    expect(link.download).toBe('fiscal-report-2026-03-01-2026-03-02.xlsx');
    expect(link.click).toHaveBeenCalledOnce();
    expect(setTimeout).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const exported = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
    expect(exported.SheetNames).toEqual(['Summary', 'VAT Breakdown', 'Transactions', 'Adjustments']);
  });

  it('generates a valid PDF document for the selected report', async () => {
    const pdf = await createFiscalPdfBlob(report);
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    const contents = new TextDecoder('latin1').decode(bytes);

    expect(pdf.type).toBe('application/pdf');
    expect(contents.startsWith('%PDF-')).toBe(true);
    expect(contents).toContain('%%EOF');
    expect(contents.match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
  });

  it('warns about missing snapshots and keeps completed, voided, and missing counts distinct', async () => {
    const workbook = await createFiscalWorkbook(reportWithoutSnapshots);
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const exported = XLSX.read(bytes, { type: 'buffer' });
    const summaryRows = XLSX.utils.sheet_to_json(exported.Sheets.Summary!, { header: 1, defval: '' }) as unknown[][];
    const summaryValue = (label: string) => summaryRows.find((row) => row[0] === label)?.[1];
    const warning = summaryRows.flat().find((value) => typeof value === 'string' && value.startsWith('WARNING:'));

    expect(warning).toContain('2 transaction(s) are missing stored fiscal snapshots');
    expect(warning).toContain('HT, VAT, and TTC cannot be reliably reconstructed');
    expect(summaryValue('Completed transactions')).toBe(1);
    expect(summaryValue('Voided transactions')).toBe(1);
    expect(summaryValue('Transactions missing fiscal snapshots')).toBe(2);
    expect(summaryValue('Snapshot-backed VAT (TND)')).toBe('Unavailable');
    expect(exported.Sheets.Transactions?.G2?.v).toBe('Unavailable');
    expect(exported.Sheets.Transactions?.I2?.v).toBe('Unavailable');
    expect(exported.Sheets.Transactions?.J2?.v).toBe('Unavailable');
    expect(exported.Sheets['VAT Breakdown']?.A2).toBeUndefined();

    const pdfText = await extractPdfStreams(await createFiscalPdfBlob(reportWithoutSnapshots));
    expect(pdfText).toContain('WARNING: 2 transaction\\(s\\) are missing stored fiscal snapshots.');
    expect(pdfText).toContain('HT, VAT, and TTC cannot be reliably reconstructed');
    expect(pdfText).toContain('Completed transactions: 1');
    expect(pdfText).toContain('Voided transactions: 1');
    expect(pdfText).toContain('Transactions missing fiscal snapshots: 2');
    expect(pdfText).toContain('No VAT breakdown is available from stored fiscal snapshots.');
    expect(pdfText).toContain('Snapshot-backed VAT: Unavailable');
    expect(pdfText).toContain('HT Unavailable | VAT Unavailable | TTC Unavailable');
  });

  it('does not present missing snapshot amounts as zero in the transactions CSV', () => {
    const csv = createFiscalCsv(reportWithoutSnapshots, 'transactions');

    expect(csv).toContain('Completed transactions,1,Voided transactions,1');
    expect(csv).toContain('Transactions missing fiscal snapshots,2');
    expect(csv).toContain('WARNING: 2 transaction(s) are missing stored fiscal snapshots. HT, VAT, and TTC cannot be reliably reconstructed');
    expect(csv).toContain('1,2026-03-01,2026-03-01T10:00:00.000Z,,,Fixture product x1,Unavailable,Unavailable,Unavailable,Unavailable,cash,paid,done,');
    expect(csv).toContain('2,2026-03-01,2026-03-01T10:00:00.000Z,,,Fixture product x1,Unavailable,Unavailable,Unavailable,Unavailable,cash,paid,voided,Fixture void');
  });

  it('explains unavailable VAT breakdowns and preserves CSV escaping', () => {
    const reportWithQuotedFields: FiscalReport = {
      ...reportWithoutSnapshots,
      store: { ...report.store, name: 'Fiscal, "North" Store' },
      transactions: [{
        ...reportWithoutSnapshots.transactions[0],
        customer: 'Buyer, "North"',
        items: [{ ...report.transactions[0].items[0], name: 'Tea, "green"' }],
      }],
    };
    const csv = createFiscalCsv(reportWithQuotedFields, 'transactions');
    const vatCsv = createFiscalCsv(reportWithoutSnapshots, 'vat');

    expect(csv).toContain('"Fiscal, ""North"" Store"');
    expect(csv).toContain('"Buyer, ""North"""');
    expect(csv).toContain('"Tea, ""green"" x1"');
    expect(vatCsv.charCodeAt(0)).toBe(0xfeff);
    expect(vatCsv).toContain('VAT breakdown availability,No snapshot-backed VAT breakdown is available for this period.');
    expect(vatCsv).toContain('Rate / treatment,Tax type,Taxable HT TND,VAT TND,TTC TND,Transaction count');
    expect(vatCsv.split('\r\n').filter((row) => row.startsWith('19%,')).length).toBe(0);
  });

  it('counts completed, voided, and pending-void transactions distinctly', () => {
    const reportWithPending = {
      ...reportWithoutSnapshots,
      transactions: [
        ...reportWithoutSnapshots.transactions,
        { ...reportWithoutSnapshots.transactions[0], id: 'pending', status: 'pending_void' as const },
      ],
    };
    expect(getFiscalReportCounts(reportWithPending)).toEqual({
      completed: 1,
      voided: 1,
      pendingVoid: 1,
      missingSnapshots: 2,
    });
    expect(getFiscalReconciliationStatus(reportWithoutSnapshots)).toBe('Not verifiable: no stored fiscal snapshots');
  });

  it('formats timestamps using the reporting store timezone', () => {
    expect(formatFiscalTimestamp('2026-03-01T10:00:00.000Z', 'Africa/Tunis')).toBe('01/03/2026, 11:00');
    expect(formatFiscalTimestamp('not-a-date', 'Africa/Tunis')).toBe('Unavailable');
  });
});
