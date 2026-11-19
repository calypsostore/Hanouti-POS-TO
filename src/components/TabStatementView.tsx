import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './Button';
import { formatTnd } from '../lib/format';
import type { CustomerRecord, OrderRecord, TabRecord } from '../types/domain';
import { printOrSharePdf } from '../services/receiptExport';

function money(amountMillimes: number): string {
  return `${formatTnd(Math.abs(amountMillimes) / 1000)} DT`;
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
  const orderIndex = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const entries = useMemo(() => [...transactions].sort((left, right) => left.createdAt.localeCompare(right.createdAt)), [transactions]);
  const balanceLabel = balanceMillimes < 0 ? `Credit balance ${money(balanceMillimes)}` : `Amount due ${money(balanceMillimes)}`;

  const printStatement = useCallback(async () => {
    setError('');
    try {
      await printOrSharePdf(printTarget.current, `tab-statement-${customer.name}`, `Tab statement — ${customer.name}`);
    } catch (printError) {
      if (printError instanceof Error && printError.name === 'AbortError') return;
      setError(printError instanceof Error ? printError.message : 'Unable to create or share this statement.');
    }
  }, [customer.name]);

  useEffect(() => {
    if (autoShare) void printStatement();
  }, [autoShare, customer.id, printStatement]);

  return (
    <div className="receipt-overlay" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label={`${customer.name} tab statement`} className="receipt-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="receipt-actions no-print">
          <Button variant="secondary" onClick={() => { void printStatement(); }}>Print statement</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
        {error && <p role="alert" className="no-print receipt-error">{error}</p>}
        <article ref={printTarget} className="receipt-print-target thermal-receipt">
          <header className="receipt-center">
            <strong>{storeName}</strong>
            <strong>CUSTOMER TAB STATEMENT</strong>
            <div>{customer.name}</div>
            {customer.phone && <div>{customer.phone}</div>}
            <div>{new Date().toLocaleString()}</div>
          </header>
          <Rule />
          {customer.creditLimitMillimes !== undefined && (
            <div className="receipt-row"><span>Credit limit</span><strong>{money(customer.creditLimitMillimes)}</strong></div>
          )}
          {entries.map((entry) => {
            const order = entry.orderId ? orderIndex.get(entry.orderId) : undefined;
            const issued = entry.kind === 'issued';
            const reversal = entry.kind === 'reversal';
            const label = issued ? `Ticket #${order?.number ?? '—'}` : reversal ? 'Payment reversed' : 'Cash payment';
            return (
              <div className="receipt-item" key={entry.id}>
                <div>{new Date(entry.createdAt).toLocaleString()}</div>
                <div className="receipt-row">
                  <span>{label}</span>
                  <strong>{issued || reversal ? '+' : '−'}{money(entry.amountMillimes)}</strong>
                </div>
                {entry.note && <div className="receipt-subline">{entry.note}</div>}
              </div>
            );
          })}
          {!entries.length && <div>No tab activity recorded.</div>}
          <Rule />
          <div className="receipt-row receipt-total">
            <strong>{balanceMillimes < 0 ? 'CREDIT' : 'BALANCE DUE'}</strong>
            <strong>{money(balanceMillimes)}</strong>
          </div>
          <div className="receipt-center">{balanceLabel}</div>
        </article>
      </section>
    </div>
  );
}

function Rule() {
  return <div className="receipt-rule" />;
}
