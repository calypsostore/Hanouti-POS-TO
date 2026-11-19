import { useRef, useState } from 'react';
import { Button } from './Button';
import { formatTnd } from '../lib/format';
import type { OrderRecord } from '../types/domain';
import { downloadOrSharePdf, printOrSharePdf } from '../services/receiptExport';

export function TicketView({ order, storeName, staffName, onClose }: {
  order: OrderRecord;
  storeName: string;
  staffName: string;
  onClose: () => void;
}) {
  const [shareError, setShareError] = useState('');
  const printTarget = useRef<HTMLElement>(null);
  const voided = order.status === 'voided';
  const ticketStoreName = order.storeName ?? storeName;
  const ticketStaffName = order.staffName ?? staffName;
  const ticketNumber = order.syncStatus ? `LOCAL-${Math.abs(order.number)}` : String(order.number);
  async function share() {
    setShareError('');
    try {
      await downloadOrSharePdf(printTarget.current, `ticket-${ticketNumber}`, `Ticket #${ticketNumber}`);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setShareError(error instanceof Error ? error.message : 'Unable to share this ticket.');
    }
  }

  async function printTicket() {
    setShareError('');
    try {
      await printOrSharePdf(printTarget.current, `ticket-${ticketNumber}`, `Ticket #${ticketNumber}`);
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
          <Button variant="secondary" onClick={() => { void share(); }}>Share PDF</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
        {shareError && <p role="alert" className="no-print receipt-error">{shareError}</p>}
        <article ref={printTarget} className="receipt-print-target thermal-receipt">
          <header className="receipt-center">
            <strong>{ticketStoreName}</strong>
            <div>Ticket #{ticketNumber}</div>
            <div>{new Date(order.createdAt).toLocaleString()}</div>
            <div>Staff: {ticketStaffName}</div>
            {order.syncStatus === 'queued' && <div>QUEUED - awaiting sync</div>}
            {order.syncStatus === 'needs_attention' && <div>NEEDS ATTENTION - order was not synced</div>}
            {order.verificationStatus === 'to_verify' && <div>Customer credit to verify</div>}
          </header>
          <ReceiptRule />
          {voided && <div className="void-stamp">VOIDED</div>}
          {order.items.map((item, index) => (
            <div className="receipt-item" key={`${item.itemId}-${index}`}>
              <div>{item.name}</div>
              <div className="receipt-row"><span>{item.quantity} × {formatTnd(item.unitPriceMillimes / 1000)}</span><strong>{formatTnd(item.lineTotalMillimes / 1000)} DT</strong></div>
              {item.modifiers.map((modifier) => <div className="receipt-subline" key={modifier}>+ {modifier}</div>)}
            </div>
          ))}
          {order.note && (
            <div className="receipt-item">
              <strong>Order note</strong>
              <div>{order.note}</div>
            </div>
          )}
          <ReceiptRule />
          <div className="receipt-row receipt-total"><strong>TOTAL</strong><strong>{formatTnd(order.totalMillimes / 1000)} DT</strong></div>
          <div className="receipt-row"><span>Payment</span><span>{order.paymentMethod.toUpperCase()}</span></div>
          {voided && <div className="receipt-void-details"><strong>Reason:</strong> {order.voidReason}<br /><strong>Voided by:</strong> {order.voidedBy}</div>}
          <ReceiptRule />
          <footer className="receipt-center">Thank you</footer>
        </article>
      </section>
    </div>
  );
}

function ReceiptRule() {
  return <div className="receipt-rule" />;
}
