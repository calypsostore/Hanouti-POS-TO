import { useEffect, type ReactNode } from 'react';
import { MaterialIcon } from './MaterialIcon';
import { t } from '../i18n/translations';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-primary-dark/60 backdrop-blur-sm" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title ?? t('common.dialog')}
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-xl bg-surface-container-lowest p-4 shadow-overlay safe-bottom tablet:mb-6 tablet:rounded-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="relative mb-4 flex justify-center">
          <span className="h-1.5 w-12 rounded-full bg-outline-variant" />
          <button type="button" aria-label={t('common.close')} onClick={onClose} className="absolute right-0 -top-2 flex h-12 w-12 items-center justify-center rounded-full text-outline hover:bg-surface-container">
            <MaterialIcon name="close" />
          </button>
        </div>
        {title && <h2 className="mb-4 pr-10 font-display text-headline-md text-on-surface">{title}</h2>}
        {children}
      </section>
    </div>
  );
}
