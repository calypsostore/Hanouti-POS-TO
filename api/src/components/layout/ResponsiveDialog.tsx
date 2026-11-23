import { useEffect, type ReactNode } from 'react';
import { MaterialIcon } from '../MaterialIcon';
import { t } from '../../i18n/translations';

interface ResponsiveDialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  variant?: 'modal' | 'drawer';
  panelClassName?: string;
}

export function ResponsiveDialog({ open, onClose, title, children, variant = 'modal', panelClassName = '' }: ResponsiveDialogProps) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);
  if (!open) return null;
  return (
    <div className={`responsive-dialog responsive-dialog--${variant} fixed inset-0 z-50 flex items-end justify-center bg-primary-dark/60 backdrop-blur-sm lg:items-center`} onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label={title ?? t('common.dialog')} className={`responsive-dialog__panel flex max-h-[calc(100dvh-8px)] w-full flex-col overflow-hidden rounded-t-xl bg-surface-container-lowest p-4 shadow-overlay safe-bottom lg:max-h-[calc(100dvh-48px)] lg:rounded-xl ${panelClassName}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-4 shrink-0">
          <div className="relative flex justify-center">
            <span className="h-1.5 w-12 rounded-full bg-outline-variant lg:hidden" />
            <button type="button" aria-label={t('common.close')} onClick={onClose} className="absolute right-0 -top-2 flex h-12 w-12 items-center justify-center rounded-full text-outline hover:bg-surface-container">
              <MaterialIcon name="close" />
            </button>
          </div>
          {title && <h2 className="mt-4 pr-10 font-display text-headline-md text-on-surface">{title}</h2>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </section>
    </div>
  );
}
