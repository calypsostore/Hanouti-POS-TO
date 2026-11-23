import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MaterialIcon } from '../MaterialIcon';
import { t } from '../../i18n/translations';

interface ResponsiveDialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  icon?: string;
  iconElement?: ReactNode;
  closeIcon?: ReactNode;
  children: ReactNode;
  variant?: 'modal' | 'drawer';
  panelClassName?: string;
}

export function ResponsiveDialog({ open, onClose, title, subtitle, icon = 'tune', iconElement, closeIcon, children, variant = 'modal', panelClassName = '' }: ResponsiveDialogProps) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);
  if (!open) return null;
  return createPortal(
    <div className={`glass-modal-backdrop responsive-dialog responsive-dialog--${variant} fixed inset-0 z-50 flex items-center justify-center bg-primary-dark/60 backdrop-blur-sm`} onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label={title ?? t('common.dialog')} className={`glass-modal-panel responsive-dialog__panel flex max-h-[calc(100dvh-8px)] w-full flex-col overflow-hidden rounded-t-xl bg-surface-container-lowest p-4 shadow-overlay safe-bottom lg:max-h-[calc(100dvh-48px)] lg:rounded-xl ${panelClassName}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="glass-modal-header shrink-0">
          <div className="glass-modal-heading">
            <span className="glass-modal-icon">{iconElement ?? <MaterialIcon name={icon} />}</span>
            {title && (
              <div className="glass-modal-heading-copy">
                <h2 className="glass-modal-title font-display text-headline-md">{title}</h2>
                {subtitle && <p className="glass-modal-subtitle font-body text-body-sm">{subtitle}</p>}
              </div>
            )}
          </div>
          <button type="button" aria-label={t('common.close')} onClick={onClose} className="glass-modal-close">
            {closeIcon ?? <MaterialIcon name="close" />}
          </button>
        </div>
        <div className="glass-modal-content min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
          {children}
        </div>
      </section>
    </div>,
    document.body,
  );
}
