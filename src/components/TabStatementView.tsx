import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import type { CustomerRecord, OrderRecord, TabRecord } from '../types/domain';
import { printOrSharePdf } from '../services/receiptExport';
import { useOverlayLifecycle, useOverlayTarget } from './overlay/overlayArchitecture';
import { getLanguage, t } from '../i18n';

function formatCustomerTnd(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat(getLanguage(), {
    useGrouping: true,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(amount);
}

function money(amountMillimes: number): string {
  return `${formatCustomerTnd(Math.abs(amountMillimes) / 1000)} DT`;
}

export function TabStatementView({ customer, storeName, balanceMillimes, transactions, orders, onClose, autoShare = false }: {
  customer: CustomerRecord;
  storeName: string;
  balanceMillimes: number;
  transactions: TabRecord[];
  orders: OrderRecord[];
  onClose: () => void;
  autoShare?: boolean;
}) {
  const [error, setError] = useState('');
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
  const orderIndex = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const entries = useMemo(() => [...transactions].sort((left, right) => left.createdAt.localeCompare(right.createdAt)), [transactions]);
  const balanceLabel = balanceMillimes < 0
    ? t('customers.statement.creditBalance', { amount: money(balanceMillimes) })
    : t('customers.statement.amountDue', { amount: money(balanceMillimes) });

  const printStatement = useCallback(async () => {
    setError('');
    try {
      await printOrSharePdf(printTarget.current, `tab-statement-${customer.name}`, t('customers.statement.title', { name: customer.name }));
    } catch (printError) {
      if (printError instanceof Error && printError.name === 'AbortError') return;
      setError(t('customers.errors.statementPrint'));
    }
  }, [customer.name]);

  useEffect(() => {
    if (autoShare) void printStatement();
  }, [autoShare, customer.id, printStatement]);

  return createPortal(
    <div className="glass-modal-backdrop receipt-overlay" style={{ zIndex }} onMouseDown={onClose}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('customers.statement.dialogLabel', { name: customer.name })} className="glass-modal-panel receipt-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="receipt-actions no-print">
          <Button variant="secondary" onClick={() => { void printStatement(); }}>{t('customers.statement.print')}</Button>
          <Button variant="ghost" onClick={onClose}>{t('customers.statement.close')}</Button>
        </div>
        {error && <p role="alert" className="no-print receipt-error">{error}</p>}
        <article ref={printTarget} className="receipt-print-target thermal-receipt">
          <header className="receipt-center">
            <strong>{storeName}</strong>
            <strong>{t('customers.statement.heading')}</strong>
            <div>{customer.name}</div>
            {customer.phone && <div>{customer.phone}</div>}
            <div>{new Date().toLocaleString(getLanguage())}</div>
          </header>
          <Rule />
          {customer.creditLimitMillimes !== undefined && (
            <div className="receipt-row"><span>{t('customers.statement.creditLimit')}</span><strong>{money(customer.creditLimitMillimes)}</strong></div>
          )}
          {entries.map((entry) => {
            const order = entry.orderId ? orderIndex.get(entry.orderId) : undefined;
            const issued = entry.kind === 'issued';
            const reversal = entry.kind === 'reversal';
            const label = issued
              ? order ? t('customers.statement.ticket', { number: order.number }) : t('customers.statement.tabCharge')
              : reversal ? t('customers.statement.paymentReversed') : t('customers.statement.cashPayment');
            return (
              <div className="receipt-item" key={entry.id}>
                <div>{new Date(entry.createdAt).toLocaleString(getLanguage())}</div>
                <div className="receipt-row">
                  <span>{label}</span>
                  <strong>{issued || reversal ? '+' : '−'}{money(entry.amountMillimes)}</strong>
                </div>
                {entry.note && <div className="receipt-subline">{entry.note}</div>}
              </div>
            );
          })}
          {!entries.length && <div>{t('customers.statement.empty')}</div>}
          <Rule />
          <div className="receipt-row receipt-total">
            <strong>{balanceMillimes < 0 ? t('customers.statement.credit') : t('customers.statement.balanceDue')}</strong>
            <strong>{money(balanceMillimes)}</strong>
          </div>
          <div className="receipt-center">{balanceLabel}</div>
        </article>
      </section>
    </div>,
    portalTarget,
  );
}

function Rule() {
  return <div className="receipt-rule" />;
}
