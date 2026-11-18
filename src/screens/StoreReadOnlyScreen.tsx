import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { adminWorkspaceLinks } from '../app/navigation';
import { t } from '../i18n/translations';
import { formatTnd } from '../lib/format';
import { catalogService } from '../services/catalogService';
import { orderService } from '../services/orderService';
import { userService } from '../services/userService';
import type { CatalogItemRecord, OrderRecord, StoreRecord, UserSummary } from '../types/domain';

export function StoreReadOnlyScreen() {
  const { storeId = '' } = useParams();
  const [store, setStore] = useState<StoreRecord>();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [items, setItems] = useState<CatalogItemRecord[]>([]);
  const [owner, setOwner] = useState<UserSummary>();
  useEffect(() => {
    let active = true;
    void userService.getStore(storeId).then(async (nextStore) => {
      if (!active) return;
      setStore(nextStore);
      if (!nextStore) return;
      const [nextOrders, nextItems, nextOwner] = await Promise.all([
        orderService.listToday(storeId),
        catalogService.listItems(storeId),
        userService.getUser(nextStore.ownerId),
      ]);
      if (!active) return;
      setOrders(nextOrders);
      setItems(nextItems);
      setOwner(nextOwner);
    });
    return () => { active = false; };
  }, [storeId]);
  if (!store) {
    return <main className="p-6"><Link to="/admin/stores" className="font-body text-primary">Back to stores</Link><p className="mt-4 font-body text-body-md text-error-dark">Store could not be found.</p></main>;
  }
  const sales = orders.filter((order) => order.status === 'done').reduce((sum, order) => sum + order.totalMillimes, 0);

  return (
    <WorkspaceLayout title={store.name} links={adminWorkspaceLinks}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="font-display text-headline-lg text-on-surface">{store.name}</h1><p className="mt-1 font-body text-body-sm text-outline">{store.code} • {owner?.email}</p></div>
        <StatusTag status={store.isActive ? 'open' : 'suspended'}>{store.isActive ? t('common.active') : t('common.suspended')}</StatusTag>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <InfoCard label="Today's sales" value={`${formatTnd(sales / 1000)} DT`} />
        <InfoCard label="Today's orders" value={String(orders.length)} />
        <InfoCard label="Catalog items" value={String(items.length)} />
      </div>
      <section className="mb-5 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
        <h2 className="mb-3 font-display text-headline-md">Catalog • read only</h2>
        <div className="flex flex-col gap-2">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-container-low p-3"><span className="flex items-center gap-2 font-body text-body-sm"><MaterialIcon name={item.icon} className="text-lg text-primary" />{item.name}</span><span className="font-body text-label-md tabular-nums">{formatTnd(item.priceMillimes / 1000)} DT</span></div>)}</div>
      </section>
      <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
        <h2 className="mb-3 font-display text-headline-md">Today's orders • read only</h2>
        <div className="flex flex-col gap-2">{orders.map((order) => <div key={order.id} className="flex items-center justify-between rounded-lg bg-surface-container-low p-3"><span className="font-body text-label-md">#{order.number} • {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span className="font-body text-label-md tabular-nums">{formatTnd(order.totalMillimes / 1000)} DT</span></div>)}</div>
      </section>
    </WorkspaceLayout>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl bg-surface-container-lowest p-4 shadow-card"><p className="font-body text-body-sm text-outline">{label}</p><p className="mt-1 font-display text-headline-md tabular-nums text-primary">{value}</p></article>;
}
