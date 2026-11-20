import { useRef, useState } from 'react';
import { Button } from './Button';
import { ReceiptDocumentView } from './ReceiptDocumentView';
import { downloadThermalPdf, printOrSharePdf, shareThermalPdf } from '../services/receiptExport';
import { buildTicketDocument } from '../services/ticketDocument';
import type { OrderRecord, StoreSettings } from '../types/domain';

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
  const printTarget = useRef<HTMLElement>(null);
  const ticketNumber = order.syncStatus ? `LOCAL-${Math.abs(order.number)}` : String(order.number);
  const ticketDocument = buildTicketDocument(
    order,
    {
      name: order.storeName ?? storeName,
      address: storeAddress,
      phone: storePhone,
      taxId: storeTaxId,
    },
    order.staffName ?? staffName,
    settings,
  );

  async function downloadPdf() {
    setShareError('');
    try {
      await downloadThermalPdf(printTarget.current, `ticket-${ticketNumber}`, `Ticket #${ticketNumber}`, ticketDocument.width);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setShareError(error instanceof Error ? error.message : 'Unable to download this ticket PDF.');
    }
  }

  async function sharePdf() {
    setShareError('');
    try {
      await shareThermalPdf(printTarget.current, `ticket-${ticketNumber}`, `Ticket #${ticketNumber}`, ticketDocument.width);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setShareError(error instanceof Error ? error.message : 'Unable to share this ticket.');
    }
  }

  async function printTicket() {
    setShareError('');
    try {
      await printOrSharePdf(printTarget.current, `ticket-${ticketNumber}`, `Ticket #${ticketNumber}`, ticketDocument.width);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setShareError(error instanceof Error ? error.message : 'Unable to create or share this ticket.');
    }
  }

  return (
    <div className="receipt-overlay" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label={`Ticket ${ticketNumber}`} className="receipt-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="receipt-actions no-print">
          <Button variant="secondary" onClick={() => { void printTicket(); }}>Print</Button>
          <Button variant="secondary" onClick={() => { void downloadPdf(); }}>Download PDF</Button>
          <Button variant="secondary" onClick={() => { void sharePdf(); }}>Share PDF</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
        {shareError && <p role="alert" className="no-print receipt-error">{shareError}</p>}
        <ReceiptDocumentView ref={printTarget} document={ticketDocument} />
      </section>
    </div>
  );
}
