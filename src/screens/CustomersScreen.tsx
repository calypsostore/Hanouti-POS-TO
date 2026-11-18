import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BottomNav } from '../components/BottomNav';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { TopBar } from '../components/TopBar';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { formatTnd } from '../lib/format';
import { customerService } from '../services/customerService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import type { CustomerRecord, OrderRecord, TabRecord } from '../types/domain';

function parseAmount(value: string): number {
  const parsed = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Enter a payment greater than zero.');
  return Math.round(parsed * 1000);
}

export function CustomersScreen() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<CustomerRecord | null>(null);
  const [history, setHistory] = useState<OrderRecord[]>([]);
  const [transactions, setTransactions] = useState<TabRecord[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [canSettle, setCanSettle] = useState(user?.role === 'owner');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [storeName, setStoreName] = useState('');

  const refresh = useCallback(async () => {
    const records = await customerService.listCustomers(storeId);
    const nextBalances = await Promise.all(records.map(async (customer) => [customer.id, await customerService.getBalance(customer.id)] as const));
    setCustomers(records);
    setBalances(Object.fromEntries(nextBalances));
    if (user?.role === 'staff') setCanSettle(await userService.hasPermission(user.id, 'settle_tabs'));
    if (selected) {
      const [nextHistory, nextTransactions] = await Promise.all([
        customerService.getOrderHistory(selected.id),
        customerService.listTransactions(selected.id),
      ]);
      setHistory(nextHistory);
      setTransactions(nextTransactions);
    }
  }, [storeId, user, selected]);

  useEffect(() => {
    void refresh().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Unable to load customers.'));
    if (storeId) void userService.getStore(storeId).then((store) => setStoreName(store?.name ?? ''));
  }, [refresh, storeId]);

  async function addCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const customer = await customerService.createCustomer(storeId, name, phone);
      setName('');
      setPhone('');
      setSelected(customer);
      await refresh();
      setNotice('Customer added.');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to add customer.');
    }
  }

  async function settle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !user) return;
    setError('');
    setNotice('');
    try {
      await customerService.settleTab({ storeId, customerId: selected.id, staffId: user.id, amountMillimes: parseAmount(amount) });
      setAmount('');
      await refresh();
      setNotice('Cash settlement recorded in the current shift.');
    } catch (settleError) {
      setError(settleError instanceof Error ? settleError.message : 'Unable to settle this tab.');
    }
  }

  const content = (
    <>
      <header className="mb-4">
        <h1 className="font-display text-headline-lg text-on-surface">Customers & tabs</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">{storeName} • open balances and customer history</p>
      </header>
      <form onSubmit={addCustomer} className="mb-4 grid gap-2 rounded-xl bg-surface-container-lowest p-4 shadow-card sm:grid-cols-[1fr_1fr_auto]">
        <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer name" aria-label="Customer name" className="h-12 rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" />
        <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone (optional)" aria-label="Phone number" className="h-12 rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" />
        <Button type="submit"><MaterialIcon name="person_add" />Add customer</Button>
      </form>
      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mb-3 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)]">
        <section className="flex flex-col gap-2">
          {customers.map((customer) => (
            <button type="button" key={customer.id} onClick={() => setSelected(customer)} className={`flex items-center justify-between gap-3 rounded-xl p-4 text-left shadow-card ${selected?.id === customer.id ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest text-on-surface'}`}>
              <span><strong className="block font-body text-label-lg">{customer.name}</strong><small>{customer.phone || 'No phone'}</small></span>
              <span className="text-right"><small className="block">Balance</small><strong>{formatTnd((balances[customer.id] ?? 0) / 1000)} DT</strong></span>
            </button>
          ))}
          {customers.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">No customers yet.</p>}
        </section>
        <section className="rounded-xl bg-surface-container-lowest p-4 shadow-card">
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="font-display text-headline-md">{selected.name}</h2><p className="font-body text-body-sm text-outline">Open balance: {formatTnd((balances[selected.id] ?? 0) / 1000)} DT</p></div>
                <MaterialIcon name="account_balance_wallet" className="text-2xl text-primary" />
              </div>
              {canSettle && (balances[selected.id] ?? 0) > 0 && (
                <form onSubmit={(event) => { void settle(event); }} className="my-4 flex flex-wrap items-end gap-2 rounded-lg bg-surface-container-low p-3">
                  <label className="min-w-40 flex-1 font-body text-label-sm">Cash payment (TND)
                    <input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.000" className="mt-1 h-11 w-full rounded-lg bg-white px-3" />
                  </label>
                  <Button type="submit">Settle tab</Button>
                </form>
              )}
              {user?.role === 'staff' && !canSettle && <p className="my-3 font-body text-body-sm text-outline">Your position does not allow tab settlements.</p>}
              <h3 className="mb-2 mt-4 font-body text-label-lg">Order history</h3>
              <div className="flex flex-col gap-2">
                {history.map((order) => <div key={order.id} className="flex justify-between gap-2 rounded-lg bg-surface-container-low p-3 font-body text-body-sm"><span>Ticket #{order.number} • {new Date(order.createdAt).toLocaleString()} • {order.status}</span><strong>{formatTnd(order.totalMillimes / 1000)} DT</strong></div>)}
                {!history.length && <p className="font-body text-body-sm text-outline">No orders on this tab.</p>}
              </div>
              <div className="mt-4 border-t border-outline-variant pt-3">
                <h3 className="mb-2 font-body text-label-lg">Tab payments</h3>
                {transactions.filter((entry) => entry.kind === 'settled').map((entry) => (
                  <div key={entry.id} className="flex justify-between gap-2 py-1 font-body text-body-sm"><span>{new Date(entry.createdAt).toLocaleString()} • Cash</span><strong>−{formatTnd(entry.amountMillimes / 1000)} DT</strong></div>
                ))}
                {!transactions.some((entry) => entry.kind === 'settled') && <p className="font-body text-body-sm text-outline">No payments recorded.</p>}
              </div>
            </>
          ) : <p className="font-body text-body-md text-outline">Select a customer to review their open balance and order history.</p>}
        </section>
      </div>
    </>
  );
  if (user?.role === 'owner') return <WorkspaceLayout title="Customers" storeName={storeName} links={ownerWorkspaceLinks}>{content}</WorkspaceLayout>;
  return <div className="min-h-screen bg-surface pb-24"><TopBar title="Customers" storeName={storeName} /><main className="mx-auto max-w-5xl px-4 py-5">{content}</main><BottomNav /></div>;
}
