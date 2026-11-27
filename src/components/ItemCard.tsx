import { formatTnd } from '../lib/format';
import { t } from '../i18n/translations';
import { ItemLogo } from './ItemLogo';
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
  canEditStockCount?: boolean;
  onEditStockCount?: () => void;
  onOpenOutOfStock?: () => void;
  largeButtons?: boolean;
  viewMode?: 'grid' | 'list';
  stockMenuOpen: boolean;
  onStockMenuToggle: () => void;
}

export function ItemCard({
  item,
  quantity = 0,
  onAdd,
  onRemove,
  canToggleStock = false,
  onToggleStock,
  canEditStockCount = false,
  onEditStockCount,
  onOpenOutOfStock,
  largeButtons = false,
  viewMode = 'grid',
  stockMenuOpen,
  onStockMenuToggle,
}: ItemCardProps) {
  const isListView = viewMode === 'list';
  const useLargeButtons = largeButtons && !isListView;
  const hasQuantityControls = quantity > 0 && Boolean(onRemove) && !item.outOfStock;
  return (
    <article
      className={`relative flex ${isListView ? `pos-item-card--list min-h-16 flex-row flex-wrap items-center gap-2 overflow-visible p-2${hasQuantityControls ? ' pos-item-card--list-has-quantity' : ''}${stockMenuOpen ? ' z-20' : ''}` : `${useLargeButtons ? 'min-h-44' : 'min-h-36'} flex-col justify-between overflow-hidden p-3.5`} rounded-xl border border-outline-variant shadow-card ${item.outOfStock ? 'bg-surface-container-low' : 'bg-surface-container-lowest'}`}
    >
      <button
        type="button"
        aria-label={item.outOfStock ? `${item.name}, ${t('pos.outOfStock')}` : t('pos.addItem', { item: item.name })}
        onClick={item.outOfStock ? onOpenOutOfStock : onAdd}
        className={`pos-item-card-main flex min-w-0 ${isListView ? 'flex-1 flex-row items-center justify-start gap-3' : 'flex-1 flex-col justify-between'} text-left disabled:cursor-not-allowed`}
      >
        <div className={`flex ${isListView ? 'shrink-0 items-center' : 'items-start'} justify-between`}>
          <span className="relative">
            <ItemLogo id={item.icon} size="md" className={item.outOfStock ? 'bg-surface-container text-outline opacity-60' : 'bg-surface-container-high text-primary'} />
            {quantity > 0 && (
              <span className="pos-cart-count-badge">
                {quantity}
              </span>
            )}
            {item.outOfStock && (
              <>
                <span className="absolute inset-0 flex items-center justify-center">
                  <MaterialIcon name="close" className="!text-[42px] text-error-dark drop-shadow" />
                </span>
                <span className="absolute right-0 top-0 z-10 rounded bg-error px-1 font-body text-label-sm leading-4 text-white shadow-card">86</span>
              </>
            )}
          </span>
        </div>
        <div className={`min-w-0 ${isListView ? 'flex-1' : 'mt-2'}`}>
          <h3 className={`truncate font-body text-title-md ${item.outOfStock ? 'text-on-surface-variant' : 'text-on-surface'}`}>{item.name}</h3>
          <p className={`font-display text-currency-display-mobile ${item.outOfStock ? 'text-outline' : 'text-primary'}`}>
            {formatTnd(item.price)} <span className="font-body text-label-md text-outline">DT</span>
          </p>
        </div>
      </button>
      {quantity > 0 && onRemove && !item.outOfStock && (
        <div className={`pos-quantity-controls ${isListView ? 'ml-auto mt-0 shrink-0' : 'mt-1'} flex items-center justify-between rounded-lg bg-surface-container-low p-0.5 ${useLargeButtons ? 'pos-quantity-controls--large' : ''}`}>
          <button type="button" aria-label={t('pos.removeItem', { item: item.name })} onClick={onRemove} className={`flex ${useLargeButtons ? 'h-14 w-14' : 'h-7 w-7'} items-center justify-center rounded-lg bg-surface-container-lowest text-primary`}>
            <MaterialIcon name={quantity === 1 ? 'delete' : 'remove'} className="text-sm" />
          </button>
          <span className="font-display text-label-lg text-primary">{quantity}</span>
          <button type="button" aria-label={t('pos.addItem', { item: item.name })} onClick={onAdd} className={`flex ${useLargeButtons ? 'h-14 w-14' : 'h-7 w-7'} items-center justify-center rounded-lg bg-primary text-on-primary`}>
            <MaterialIcon name="add" className="text-sm" />
          </button>
        </div>
      )}
      {(canToggleStock && onToggleStock || canEditStockCount && onEditStockCount) && (
        <div className={`flex ${isListView ? 'relative z-10 ml-1 shrink-0' : 'absolute right-1 top-1 z-10 flex-col items-end'}`}>
          <button
            type="button"
            aria-expanded={stockMenuOpen}
            aria-haspopup="menu"
            aria-label={t('pos.itemActions', { item: item.name })}
            onClick={onStockMenuToggle}
            className={`flex h-12 w-12 items-center justify-center rounded-xl ${
              isListView ? 'bg-surface-container-low text-primary hover:bg-surface-container-high' : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            <MaterialIcon name="more_vert" className="text-2xl" />
          </button>
          {stockMenuOpen && (
            <div role="menu" className={`absolute right-0 z-20 ${isListView ? 'bottom-full mb-1' : 'top-12'} min-w-44 rounded-xl border border-outline-variant bg-surface-container-lowest p-1 shadow-overlay`}>
              {canToggleStock && onToggleStock && (
                <button
                  type="button"
                  role="menuitem"
                  aria-pressed={item.outOfStock}
                  onClick={() => {
                    onStockMenuToggle();
                    onToggleStock();
                  }}
                  className="flex min-h-12 w-full items-center gap-2 rounded-lg px-3 text-left font-body text-label-md text-on-surface hover:bg-surface-container-low"
                >
                  <MaterialIcon name={item.outOfStock ? 'check' : 'block'} className="text-lg text-primary" />
                  {t(item.outOfStock ? 'pos.markAvailable' : 'pos.markOutOfStock')}
                </button>
              )}
              {canEditStockCount && onEditStockCount && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onStockMenuToggle();
                    onEditStockCount();
                  }}
                  className="flex min-h-12 w-full items-center gap-2 rounded-lg px-3 text-left font-body text-label-md text-on-surface hover:bg-surface-container-low"
                >
                  <MaterialIcon name="inventory_2" className="text-lg text-primary" />
                  {t('pos.editStockCount')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
