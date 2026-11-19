import { useRef, type TouchEvent } from 'react';
import { formatTnd } from '../lib/format';
import { t } from '../i18n/translations';
import { MaterialIcon } from './MaterialIcon';

export interface TicketLine {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers?: string[];
}

interface TicketRowProps {
  item: TicketLine;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
  largeButtons?: boolean;
}

export function TicketRow({ item, onIncrement, onDecrement, onRemove, largeButtons = false }: TicketRowProps) {
  const touchStartX = useRef<number | null>(null);

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchStartX.current = event.changedTouches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const endX = event.changedTouches[0]?.clientX;
    if (touchStartX.current !== null && endX !== undefined && touchStartX.current - endX > 64) {
      onRemove();
    }
    touchStartX.current = null;
  }

  return (
    <div
      className="flex items-center gap-3 border-b border-outline-variant py-3 last:border-0"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex shrink-0 items-center gap-1 rounded-lg bg-surface-container-low p-1">
        <button type="button" aria-label={t('pos.decreaseItem', { item: item.name })} onClick={onDecrement} className={`flex ${largeButtons ? 'h-14 w-14' : 'h-9 w-9'} items-center justify-center rounded-md bg-surface-container-lowest text-primary`}>
          <MaterialIcon name={item.quantity === 1 ? 'delete' : 'remove'} className="text-lg" />
        </button>
        <span className="min-w-6 text-center font-body text-label-lg tabular-nums">{item.quantity}</span>
        <button type="button" aria-label={t('pos.increaseItem', { item: item.name })} onClick={onIncrement} className={`flex ${largeButtons ? 'h-14 w-14' : 'h-9 w-9'} items-center justify-center rounded-md bg-primary text-on-primary`}>
          <MaterialIcon name="add" className="text-lg" />
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-body text-label-lg text-on-surface">{item.name}</p>
        {item.modifiers && item.modifiers.length > 0 && (
          <p className="truncate font-body text-body-sm text-outline">{item.modifiers.join(', ')}</p>
        )}
      </div>
      <span className="shrink-0 font-body text-label-lg tabular-nums text-on-surface">
        {formatTnd(item.quantity * item.unitPrice)} DT
      </span>
    </div>
  );
}
