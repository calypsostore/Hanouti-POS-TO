import { useState } from 'react';
import { formatTnd } from '../lib/format';
import { t } from '../i18n/translations';
import { MaterialIcon } from './MaterialIcon';

export interface ItemCardItem {
  id: string;
  name: string;
  price: number;
  icon: string;
  outOfStock?: boolean;
  outOfStockBy?: string;
  outOfStockAt?: string;
}

interface ItemCardProps {
  item: ItemCardItem;
  quantity?: number;
  onAdd: () => void;
  onRemove?: () => void;
  canToggleStock?: boolean;
  onToggleStock?: () => void;
  onOpenOutOfStock?: () => void;
}

export function ItemCard({ item, quantity = 0, onAdd, onRemove, canToggleStock = false, onToggleStock, onOpenOutOfStock }: ItemCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <article
      className={`relative flex min-h-36 flex-col justify-between overflow-hidden rounded-xl border border-outline-variant p-3.5 shadow-card ${item.outOfStock ? 'bg-surface-container-low' : 'bg-surface-container-lowest'}`}
    >
      <button
        type="button"
        aria-label={item.outOfStock ? `${item.name}, ${t('pos.outOfStock')}` : t('pos.addItem', { item: item.name })}
        onClick={item.outOfStock ? onOpenOutOfStock : onAdd}
        className="flex flex-1 flex-col justify-between text-left disabled:cursor-not-allowed"
      >
        <div className="flex items-start justify-between">
          <span className={`relative flex h-12 w-12 items-center justify-center rounded-xl ${item.outOfStock ? 'bg-surface-container text-outline' : 'bg-surface-container-high text-primary'}`}>
            <MaterialIcon name={item.icon} className={`text-[28px] ${item.outOfStock ? 'opacity-60' : ''}`} />
            {item.outOfStock && (
              <>
                <span className="absolute inset-0 flex items-center justify-center">
                  <MaterialIcon name="close" className="!text-[42px] text-error-dark drop-shadow" />
                </span>
                <span className="absolute right-0 top-0 z-10 rounded bg-error px-1 font-body text-label-sm leading-4 text-white shadow-card">86</span>
              </>
            )}
          </span>
          {quantity > 0 && (
            <span className={`rounded-full bg-primary-fixed px-2 py-0.5 font-body text-label-sm text-on-surface ${canToggleStock ? 'mr-11' : ''}`}>
              {t('pos.itemAddedToCart', { count: quantity })}
            </span>
          )}
        </div>
        <div className="mt-2 min-w-0">
          <h3 className={`truncate font-body text-title-md ${item.outOfStock ? 'text-on-surface-variant' : 'text-on-surface'}`}>{item.name}</h3>
          <p className={`font-display text-currency-display-mobile ${item.outOfStock ? 'text-outline' : 'text-primary'}`}>
            {formatTnd(item.price)} <span className="font-body text-label-md text-outline">DT</span>
          </p>
        </div>
      </button>
      {canToggleStock && onToggleStock && (
        <div className="absolute right-1 top-1 z-10">
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={`Item actions: ${item.name}`}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-12 w-12 items-center justify-center rounded-xl text-on-surface-variant hover:bg-surface-container-high"
          >
            <MaterialIcon name="more_vert" className="text-2xl" />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 top-12 z-20 min-w-44 rounded-xl border border-outline-variant bg-surface-container-lowest p-1 shadow-overlay">
              <button
                type="button"
                role="menuitem"
                aria-pressed={item.outOfStock}
                onClick={() => {
                  setMenuOpen(false);
                  onToggleStock();
                }}
                className="flex min-h-12 w-full items-center gap-2 rounded-lg px-3 text-left font-body text-label-md text-on-surface hover:bg-surface-container-low"
              >
                <MaterialIcon name={item.outOfStock ? 'check' : 'block'} className="text-lg text-primary" />
                {t(item.outOfStock ? 'pos.markAvailable' : 'pos.markOutOfStock')}
              </button>
            </div>
          )}
        </div>
      )}
      {quantity > 0 && onRemove && !item.outOfStock && (
        <div className="mt-1 flex items-center justify-between rounded-lg bg-surface-container-low p-0.5">
          <button type="button" aria-label={t('pos.removeItem', { item: item.name })} onClick={onRemove} className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-container-lowest text-primary">
            <MaterialIcon name={quantity === 1 ? 'delete' : 'remove'} className="text-sm" />
          </button>
          <span className="font-display text-label-lg text-primary">{quantity}</span>
          <button type="button" aria-label={t('pos.addItem', { item: item.name })} onClick={onAdd} className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary">
            <MaterialIcon name="add" className="text-sm" />
          </button>
        </div>
      )}
    </article>
  );
}
