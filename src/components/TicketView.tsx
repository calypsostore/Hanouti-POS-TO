import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { ReceiptDocumentView } from './ReceiptDocumentView';
import { downloadThermalPdf, printOrSharePdf, shareThermalPdf } from '../services/receiptExport';
import { buildKitchenTicketDocument, buildTicketDocument } from '../services/ticketDocument';
import type { OrderRecord, StoreSettings } from '../types/domain';
import { useOverlayLifecycle, useOverlayTarget } from './overlay/overlayArchitecture';

export function TicketView({ order, storeName, staffName, onClose, settings, storeAddress, storePhone, storeTaxId }: {
  order: OrderRecord;
  storeName: string;
  staffName: string;
  onClose: () => void;
  settings?: Partial<StoreSettings>;
  storeAddress?: string;
  storePhone?: string;
  storeTaxId?: string;
}) {
  const [shareError, setShareError] = useState('');
  const [copyType, setCopyType] = useState<'customer' | 'kitchen'>('customer');
  const printTarget = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const portalTarget = useOverlayTarget();
  const closeOnEscape = useCallback(() => onClose(), [onClose]);
  const zIndex = useOverlayLifecycle({
    open: true,
    kind: 'dialog',
    onEscape: closeOnEscape,
    lockScroll: true,
    trapFocus: true,
    restoreFocus: true,
    containerRef: dialogRef,
  });
  const ticketNumber = order.syncStatus ? `LOCAL-${Math.abs(order.number)}` : String(order.number);
  const ticketDocument = copyType === 'customer'
    ? buildTicketDocument(
      order,
      {
        name: order.storeName ?? storeName,
        address: storeAddress,
        phone: storePhone,
        taxId: storeTaxId,
      },
      order.staffName ?? staffName,
      settings,
    )
    : buildKitchenTicketDocument(order, { name: order.storeName ?? storeName }, staffName, settings);
  const copySuffix = copyType === 'customer' ? 'customer' : 'kitchen';
  const documentTitle = copyType === 'customer' ? `Ticket #${ticketNumber}` : `Kitchen copy #${ticketNumber}`;

  async function downloadPdf() {
    setShareError('');
    try {
      await downloadThermalPdf(printTarget.current, `ticket-${ticketNumber}-${copySuffix}`, documentTitle, ticketDocument.width);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setShareError(error instanceof Error ? error.message : 'Unable to download this ticket PDF.');
    }
  }

  async function sharePdf() {
    setShareError('');
    try {
      await shareThermalPdf(printTarget.current, `ticket-${ticketNumber}-${copySuffix}`, documentTitle, ticketDocument.width);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setShareError(error instanceof Error ? error.message : 'Unable to share this ticket.');
    }
  }

  async function printTicket() {
    setShareError('');
    try {
      await printOrSharePdf(printTarget.current, `ticket-${ticketNumber}-${copySuffix}`, documentTitle, ticketDocument.width);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setShareError(error instanceof Error ? error.message : 'Unable to create or share this ticket.');
    }
  }

  return createPortal(
    <div className="glass-modal-backdrop receipt-overlay" style={{ zIndex }} onMouseDown={onClose}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label={documentTitle} className="glass-modal-panel receipt-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="receipt-actions no-print">
          <Button variant={copyType === 'customer' ? 'primary' : 'secondary'} aria-pressed={copyType === 'customer'} onClick={() => setCopyType('customer')}>Customer receipt</Button>
          <Button variant={copyType === 'kitchen' ? 'primary' : 'secondary'} aria-pressed={copyType === 'kitchen'} onClick={() => setCopyType('kitchen')}>Kitchen copy</Button>
          <Button variant="secondary" onClick={() => { void printTicket(); }}>Print</Button>
          <Button variant="secondary" onClick={() => { void downloadPdf(); }}>Download PDF</Button>
          <Button variant="secondary" onClick={() => { void sharePdf(); }}>Share PDF</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
        {order.syncStatus && (
          <p role="status" className="no-print mx-3 my-2 rounded-lg bg-warning-container p-3 font-body text-body-sm text-on-warning-container">
            Provisional local ticket - not server-confirmed or fiscalized.
          </p>
        )}
        {shareError && <p role="alert" className="no-print receipt-error">{shareError}</p>}
        <ReceiptDocumentView ref={printTarget} document={ticketDocument} />
      </section>
    </div>,
    portalTarget,
  );
}
