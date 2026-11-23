import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { MaterialIcon } from './MaterialIcon';
import { ReceiptDocumentView } from './ReceiptDocumentView';
import { downloadOrSharePdf, downloadThermalPdf, printOrSharePdf } from '../services/receiptExport';
import { buildReportDocument } from '../services/reportDocument';
import type { ReportRecord, StoreRecord, StoreSettings } from '../types/domain';

type ReportStore = Pick<StoreRecord, 'name' | 'address' | 'phone' | 'taxId'>;

export function ReportView({
  report,
  storeName,
  store,
  settings,
  onClose,
  inline = false,
  previewZoom = 100,
}: {
  report: ReportRecord;
  storeName: string;
  store?: ReportStore;
  settings?: Partial<StoreSettings>;
  onClose: () => void;
  inline?: boolean;
  previewZoom?: number;
}) {
  const [shareError, setShareError] = useState('');
  const printTarget = useRef<HTMLElement>(null);
  const reportStore: ReportStore = {
    name: report.frozenStoreName ?? report.storeName ?? store?.name ?? storeName,
    address: report.frozenStoreAddress ?? store?.address,
    phone: report.frozenStorePhone ?? store?.phone,
    taxId: report.frozenStoreTaxId ?? store?.taxId,
  };
  const reportSettings = useMemo(() => ({
    ...settings,
    ...(report.frozenReportFooterText ? { reportFooterText: report.frozenReportFooterText } : {}),
    ...(report.frozenPaperWidth ? { paperWidth: report.frozenPaperWidth } : {}),
  }), [report.frozenPaperWidth, report.frozenReportFooterText, settings]);
  const document = buildReportDocument(report, reportStore, reportSettings);

  async function withoutPreviewZoom<T>(action: () => Promise<T>): Promise<T> {
    const target = printTarget.current;
    const transform = target?.style.transform;
    const transformOrigin = target?.style.transformOrigin;
    if (target) {
      target.style.transform = 'none';
      target.style.transformOrigin = '';
    }
    try {
      return await action();
    } finally {
      if (target) {
        target.style.transform = transform ?? '';
        target.style.transformOrigin = transformOrigin ?? '';
      }
    }
  }

  async function exportPdf(format: 'thermal' | 'a4') {
    setShareError('');
    try {
      await withoutPreviewZoom(async () => {
        if (format === 'thermal') {
          await downloadThermalPdf(
            printTarget.current,
            `${report.type.toLowerCase()}-report-${report.businessDate}`,
            document.title,
            document.width,
          );
        } else {
          await downloadOrSharePdf(
            printTarget.current,
            `${report.type.toLowerCase()}-report-${report.businessDate}-a4`,
            `${document.title} A4`,
          );
        }
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setShareError(error instanceof Error ? error.message : 'Unable to create or share this report PDF.');
    }
  }

  async function printReport() {
    setShareError('');
    try {
      await withoutPreviewZoom(() => printOrSharePdf(
        printTarget.current,
        `${report.type.toLowerCase()}-report-${report.businessDate}`,
        document.title,
        document.width,
      ));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setShareError(error instanceof Error ? error.message : 'Unable to print this report.');
    }
  }

  const content = (
    <>
      <div className="receipt-actions no-print">
        <Button variant="secondary" onClick={() => { void printReport(); }}>
          <MaterialIcon name="print" className="text-lg" />Print
        </Button>
        <Button variant="secondary" onClick={() => { void exportPdf('thermal'); }}>
          <MaterialIcon name="receipt_long" className="text-lg" />Thermal PDF
        </Button>
        <Button variant="secondary" onClick={() => { void exportPdf('a4'); }}>
          <MaterialIcon name="picture_as_pdf" className="text-lg" />A4 PDF
        </Button>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
      {shareError && <p role="alert" className="no-print receipt-error">{shareError}</p>}
      <ReceiptDocumentView
        ref={printTarget}
        document={document}
        style={inline ? {
          transform: `scale(${previewZoom / 100})`,
          transformOrigin: 'top center',
        } : undefined}
      />
    </>
  );

  if (inline) {
    return <section className="receipt-inline-report" aria-label={`${document.title} preview`}>{content}</section>;
  }

  return createPortal(
    <div className="glass-modal-backdrop receipt-overlay" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label={`${document.title} report`} className="glass-modal-panel receipt-dialog report-dialog" onMouseDown={(event) => event.stopPropagation()}>
        {content}
      </section>
    </div>,
    globalThis.document.body,
  );
}
