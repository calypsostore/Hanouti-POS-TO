import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { classifyActionFeedback, type ActionFeedbackKind } from '../lib/actionFeedback';
import { MaterialIcon } from './MaterialIcon';
import { useOverlayLifecycle, useOverlayTarget } from './overlay/overlayArchitecture';

interface ToastMessage {
  kind: ActionFeedbackKind;
  message: string;
  exiting: boolean;
  pinned: boolean;
  expanded: boolean;
  dragOffset: number;
}

type ActionToastStyle = CSSProperties & { '--action-toast-drag-y': string };

const EXIT_ANIMATION_MS = 180;
const TOAST_VISIBLE_DURATION_MS = 7000;
const TOAST_AUTO_DISMISS_MS = TOAST_VISIBLE_DURATION_MS - EXIT_ANIMATION_MS;
const HOLD_TO_PIN_MS = 500;
const SWIPE_TO_DISMISS_PX = 48;

export function ActionFeedbackToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const portalTarget = useOverlayTarget();
  const zIndex = useOverlayLifecycle({
    open: Boolean(toast),
    kind: 'toast',
    lockScroll: false,
    trapFocus: false,
    restoreFocus: false,
  });
  const timeoutRef = useRef<number | undefined>(undefined);
  const holdTimeoutRef = useRef<number | undefined>(undefined);
  const expiresAtRef = useRef(0);
  const remainingTimeRef = useRef(TOAST_AUTO_DISMISS_MS);
  const pointerStartYRef = useRef<number | null>(null);
  const pointerHeldRef = useRef(false);
  const swipeDismissedRef = useRef(false);
  const dismissToastRef = useRef<() => void>(() => undefined);
  const pinToastRef = useRef<(expanded: boolean) => void>(() => undefined);
  const scheduleDismissRef = useRef<(duration: number) => void>(() => undefined);
  const lastToastRef = useRef({ key: '', shownAt: 0 });

  useEffect(() => {
    const clearToast = () => {
      window.clearTimeout(timeoutRef.current);
      window.clearTimeout(holdTimeoutRef.current);
      expiresAtRef.current = 0;
      setToast((current) => current ? { ...current, exiting: true } : null);
      timeoutRef.current = window.setTimeout(() => setToast(null), EXIT_ANIMATION_MS);
    };

    const pinToast = (expanded: boolean) => {
      window.clearTimeout(timeoutRef.current);
      window.clearTimeout(holdTimeoutRef.current);
      expiresAtRef.current = 0;
      setToast((current) => current ? {
        ...current,
        pinned: true,
        expanded: current.expanded || expanded,
        dragOffset: 0,
      } : null);
    };

    const scheduleDismiss = (duration: number) => {
      window.clearTimeout(timeoutRef.current);
      remainingTimeRef.current = duration;
      expiresAtRef.current = Date.now() + duration;
      timeoutRef.current = window.setTimeout(clearToast, duration);
    };

    dismissToastRef.current = clearToast;
    pinToastRef.current = pinToast;
    scheduleDismissRef.current = scheduleDismiss;

    const showToast = (kind: ActionFeedbackKind, message: string) => {
      const key = `${kind}:${message}`;
      const now = Date.now();
      if (lastToastRef.current.key === key && now - lastToastRef.current.shownAt < 700) return;
      lastToastRef.current = { key, shownAt: now };
      window.clearTimeout(timeoutRef.current);
      setToast({ kind, message, exiting: false, pinned: false, expanded: false, dragOffset: 0 });
      scheduleDismiss(TOAST_AUTO_DISMISS_MS);
    };

    const inspect = (root: ParentNode) => {
      const candidates: Element[] = [];
      if (root instanceof Element && root.matches('[role="alert"], [role="status"]')) {
        candidates.push(root);
      }
      candidates.push(...root.querySelectorAll('[role="alert"], [role="status"]'));

      for (const element of candidates) {
        if (element.closest('[data-action-feedback-toast]')) continue;
        if (candidates.some((child) => child !== element && element.contains(child))) continue;
        const message = element.textContent?.trim().replace(/\s+/g, ' ');
        if (!message) continue;
        const kind = classifyActionFeedback(element.getAttribute('role'), element.getAttribute('class') ?? '', message);
        if (kind) showToast(kind, message);
      }
    };

    inspect(document);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData' && mutation.target.parentElement) {
          inspect(mutation.target.parentElement.closest('[role="alert"], [role="status"]') ?? mutation.target.parentElement);
        } else if (mutation.type === 'attributes' && mutation.target instanceof Element) {
          inspect(mutation.target);
        } else {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) inspect(node);
          });
        }
      }
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'role'],
      characterData: true,
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      window.clearTimeout(timeoutRef.current);
      window.clearTimeout(holdTimeoutRef.current);
    };
  }, []);

  if (!toast) return null;

  const isError = toast.kind === 'error';
  const messageContent = (
    <>
      <MaterialIcon name={isError ? 'error' : 'check_circle'} className="!text-white" />
      <span className={`action-feedback-toast-message ${toast.expanded ? 'action-feedback-toast-message--expanded' : ''}`}>{toast.message}</span>
      {toast.pinned && <span className="action-feedback-toast-pinned">Kept</span>}
    </>
  );
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('.action-feedback-toast-dismiss')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    swipeDismissedRef.current = false;
    pointerStartYRef.current = event.clientY;
    pointerHeldRef.current = false;
    remainingTimeRef.current = Math.max(0, expiresAtRef.current - Date.now());
    window.clearTimeout(timeoutRef.current);
    holdTimeoutRef.current = window.setTimeout(() => {
      pointerHeldRef.current = true;
      pinToastRef.current(false);
    }, HOLD_TO_PIN_MS);
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerStartYRef.current === null) return;
    const offset = event.clientY - pointerStartYRef.current;
    if (Math.abs(offset) > 10) window.clearTimeout(holdTimeoutRef.current);
    setToast((current) => current ? { ...current, dragOffset: Math.min(0, offset) } : null);
  };
  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerStartYRef.current === null) return;
    const offset = event.clientY - pointerStartYRef.current;
    pointerStartYRef.current = null;
    window.clearTimeout(holdTimeoutRef.current);

    if (offset <= -SWIPE_TO_DISMISS_PX) {
      swipeDismissedRef.current = true;
      dismissToastRef.current();
    } else {
      setToast((current) => current ? { ...current, dragOffset: 0 } : null);
      if (!pointerHeldRef.current && !toast.pinned) scheduleDismissRef.current(remainingTimeRef.current);
    }
  };

  return createPortal(
    <div className="action-feedback-toast-position" data-action-feedback-toast style={{ zIndex }}>
      <div
        className={`action-feedback-toast ${toast.exiting ? 'action-feedback-toast--exit' : ''} ${isError ? 'bg-error-dark' : 'bg-success-dark'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{ '--action-toast-drag-y': `${toast.dragOffset}px` } as ActionToastStyle}
      >
        <div className="action-feedback-toast-content">
          {isError ? (
            <button
              type="button"
              onClick={() => {
                if (swipeDismissedRef.current) {
                  swipeDismissedRef.current = false;
                  return;
                }
                pinToastRef.current(true);
              }}
              aria-label={`Keep and view error details: ${toast.message}`}
              title="Tap to keep this message and view the full error"
              className="action-feedback-toast-error-details"
            >
              {messageContent}
            </button>
          ) : (
            <div className="action-feedback-toast-message-content">{messageContent}</div>
          )}
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => dismissToastRef.current()}
            className="action-feedback-toast-dismiss flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          >
            <MaterialIcon name="close" className="!text-white" />
          </button>
        </div>
        <span className="sr-only" role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'}>{toast.message}</span>
      </div>
    </div>,
    portalTarget,
  );
}
