import { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { t } from '../i18n/translations';
import { formatTnd } from '../lib/format';
import { orderService } from '../services/orderService';
import { useAuthStore } from '../stores/authStore';
import { userService } from '../services/userService';
import type { OrderRecord } from '../types/domain';

function OwnerVoidRequestsContent() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const ownerId = user?.id ?? '';
  const [requests, setRequests] = useState<OrderRecord[]>([]);
  const [storeName, setStoreName] = useState<string>();
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [voidReasons, setVoidReasons] = useState<Record<string, string>>({});

  const refreshRequests = useCallback(async () => {
    const orders = (await orderService.listAll(storeId)).filter((order) => order.status === 'pending_void');
    const staff = await Promise.all(orders.map((order) => userService.getUser(order.staffId)));
    setRequests(orders);
    setStaffNames(Object.fromEntries(orders.map((order, index) => [order.staffId, staff[index]?.name ?? 'Staff'])));
  }, [storeId]);

  useEffect(() => {
    void refreshRequests().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : t('common.loadFailed')));
    if (user?.storeId) void userService.getStore(user.storeId).then((store) => setStoreName(store?.name)).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : t('common.storeLoadFailed')));
  }, [refreshRequests, storeId, user?.storeId]);

  async function resolve(order: OrderRecord, decision: 'approve' | 'reject') {
    setError('');
    setNotice('');
    try {
      await orderService.resolveVoidRequest(order.id, ownerId, decision, voidReasons[order.id]);
      await refreshRequests();
      setNotice(decision === 'approve' ? `Order #${order.number} voided.` : `Void request for #${order.number} rejected.`);
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : 'Unable to resolve this request.');
    }
  }

  return (
    <WorkspaceLayout title={t('voids.title')} storeName={storeName} links={ownerWorkspaceLinks}>
      <header className="mb-4">
        <h1 className="font-display text-headline-lg text-on-surface">{t('voids.title')}</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">Approve or reject staff requests to void completed orders.</p>
      </header>
      {error && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      {notice && <p role="status" className="mb-3 rounded-lg bg-success-container p-3 font-body text-body-sm text-on-success-container">{notice}</p>}
      <section className="flex flex-col gap-3">
        {requests.map((order) => {
          return (
            <article key={order.id} className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-headline-sm text-on-surface">Order #{order.number}</h2>
                  <p className="mt-1 font-body text-body-sm text-outline">{t('voids.requestedBy', { name: staffNames[order.staffId] ?? 'Staff' })} • {order.voidRequestedAt ? new Date(order.voidRequestedAt).toLocaleString() : ''}</p>
                </div>
                <StatusTag status="pending">Awaiting owner</StatusTag>
              </div>
              <div className="rounded-xl bg-surface-container-low p-3">
                {order.items.map((item, index) => (
                  <div key={`${item.itemId}-${index}`} className="flex justify-between gap-3 py-1 font-body text-body-sm text-on-surface">
                    <span>{item.quantity}× {item.name}</span>
                    <span className="shrink-0 tabular-nums">{formatTnd(item.lineTotalMillimes / 1000)} DT</span>
                  </div>
                ))}
                <div className="mt-2 flex justify-between border-t border-outline-variant pt-2 font-body text-label-md">
                  <span>Total</span><span className="tabular-nums">{formatTnd(order.totalMillimes / 1000)} DT</span>
                </div>
              </div>
              <label className="font-body text-label-sm">Reason required to approve void
                <textarea value={voidReasons[order.id] ?? order.voidReason ?? ''} onChange={(event) => setVoidReasons((current) => ({ ...current, [order.id]: event.target.value }))} className="mt-1 min-h-16 w-full rounded-lg bg-surface-container-low p-3" />
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="danger" onClick={() => { void resolve(order, 'reject'); }}><MaterialIcon name="close" />{t('voids.reject')}</Button>
                <Button disabled={!(voidReasons[order.id] ?? order.voidReason ?? '').trim()} onClick={() => { void resolve(order, 'approve'); }}><MaterialIcon name="check" />{t('voids.approve')}</Button>
              </div>
            </article>
          );
        })}
        {requests.length === 0 && <div className="rounded-2xl bg-surface-container-lowest p-8 text-center shadow-card"><MaterialIcon name="task_alt" className="text-4xl text-success-dark" /><p className="mt-2 font-body text-body-md text-on-surface-variant">{t('voids.none')}</p></div>}
      </section>
    </WorkspaceLayout>
  );
}

export function OwnerVoidRequestsScreen() {
  return <OwnerVoidRequestsContent />;
}
