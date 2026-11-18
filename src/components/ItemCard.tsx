import { formatTnd } from '../lib/format';
import { MaterialIcon } from './MaterialIcon';

export interface ItemCardItem {
  id: string;
  name: string;
  price: number;
  icon: string;
  outOfStock?: boolean;
}

interface ItemCardProps {
  item: ItemCardItem;
  quantity?: number;
  onAdd: () => void;
  onRemove?: () => void;
}

export function ItemCard({ item, quantity = 0, onAdd, onRemove }: ItemCardProps) {
  return (
    <article
      className={`relative flex min-h-36 flex-col justify-between overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest p-3.5 shadow-card ${
        item.outOfStock ? 'opacity-75' : ''
      }`}
    >
      <button
        type="button"
        aria-label={item.outOfStock ? `${item.name}, out of stock` : `Add ${item.name}`}
        disabled={item.outOfStock}
        onClick={onAdd}
        className="flex flex-1 flex-col justify-between text-left disabled:cursor-not-allowed"
      >
        <div className="flex items-start justify-between">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-container-high text-primary">
            <MaterialIcon name={item.icon} className="text-[28px]" />
          </span>
          {quantity > 0 && (
            <span className="rounded-full bg-primary-fixed px-2 py-0.5 font-body text-label-sm text-on-surface">
              In cart ({quantity})
            </span>
          )}
        </div>
        <div className="mt-2 min-w-0">
          <h3 className="truncate font-body text-title-md text-on-surface">{item.name}</h3>
          <p className="font-display text-currency-display-mobile text-primary">
            {formatTnd(item.price)} <span className="font-body text-label-md text-outline">DT</span>
          </p>
        </div>
      </button>
      {quantity > 0 && onRemove && !item.outOfStock && (
        <div className="mt-2 flex items-center justify-between rounded-lg bg-surface-container-low p-1">
          <button type="button" aria-label={`Remove one ${item.name}`} onClick={onRemove} className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-container-lowest text-primary">
            <MaterialIcon name={quantity === 1 ? 'delete' : 'remove'} className="text-lg" />
          </button>
          <span className="font-display text-headline-sm text-primary">{quantity}</span>
          <button type="button" aria-label={`Add one ${item.name}`} onClick={onAdd} className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-on-primary">
            <MaterialIcon name="add" className="text-lg" />
          </button>
        </div>
      )}
      {item.outOfStock && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-dim/70 p-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-error px-3 py-1 font-body text-label-sm text-white shadow-card">
            <MaterialIcon name="block" className="text-sm" />
            86 Out of Stock
          </span>
        </div>
      )}
    </article>
  );
}
