import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert } from 'lucide-react';
import { t } from '../i18n/translations';

interface ContextualHelpProps {
  title: string;
  description: string;
}

interface HelpLabelProps extends ContextualHelpProps {
  children: ReactNode;
}

export function ContextualHelp({ title, description }: ContextualHelpProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const button = buttonRef.current;
      const popover = popoverRef.current;
      if (!button || !popover) return;

      const rect = button.getBoundingClientRect();
      const width = popover.offsetWidth;
      const height = popover.offsetHeight;
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const below = rect.bottom + 8;
      const top = below + height <= window.innerHeight - 12
        ? below
        : Math.max(12, rect.top - height - 8);

      setPosition({ left, top });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node
        && !buttonRef.current?.contains(target)
        && !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t('common.helpLabel', { title })}
        aria-expanded={open}
        aria-controls={popoverId}
        aria-describedby={open ? popoverId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-primary transition-[background-color,color,transform] duration-150 hover:scale-105 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-lowest aria-expanded:bg-primary-container aria-expanded:text-on-primary-container"
      >
        <CircleAlert aria-hidden="true" focusable="false" size={19} strokeWidth={2.25} />
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          id={popoverId}
          role="tooltip"
          style={{ position: 'fixed', left: position.left, top: position.top, zIndex: 1100 }}
          className="max-h-[min(24rem,calc(100dvh-1.5rem))] w-[min(20rem,calc(100vw-1.5rem))] overflow-auto rounded-xl border border-primary/20 bg-surface-container-lowest p-4 text-body-sm text-on-surface shadow-xl"
        >
          <div className="mb-1.5 flex items-center gap-2">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
              <CircleAlert aria-hidden="true" focusable="false" size={16} strokeWidth={2.25} />
            </span>
            <strong className="text-label-md">{title}</strong>
          </div>
          <p>{description}</p>
        </div>,
        document.body,
      )}
    </>
  );
}

export function HelpLabel({ title, description, children }: HelpLabelProps) {
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {children}
      <ContextualHelp title={title} description={description} />
    </span>
  );
}
