import { useEffect, useRef, useState, type RefObject } from 'react';
import { DEFAULT_STORE_APPEARANCE } from '../../theme/themeRegistry';
import { useStoreAppearance } from '../../lib/storeAppearance';

export type OverlayKind = 'popover' | 'sheet' | 'dialog' | 'prompt' | 'critical' | 'toast';

export interface OverlayRegistrationOptions {
  open: boolean;
  kind: OverlayKind;
  onEscape?: () => void;
  preventEscape?: boolean;
  lockScroll?: boolean;
  trapFocus?: boolean;
  restoreFocus?: boolean;
  containerRef?: RefObject<HTMLElement | null>;
}

interface OverlayRegistration {
  id: number;
  kind: OverlayKind;
  onEscape?: () => void;
  preventEscape: boolean;
  trapFocus: boolean;
  containerRef?: RefObject<HTMLElement | null>;
}

function getOverlayZIndexFromTheme(kind: OverlayKind): number {
  const tokenName = kind === 'sheet' || kind === 'dialog'
    ? 'dialog'
    : kind;
  const token = typeof document === 'undefined'
    ? ''
    : window.getComputedStyle(document.documentElement).getPropertyValue(`--z-${tokenName}`);
  const configured = Number.parseInt(token, 10);
  if (Number.isFinite(configured)) return configured;
  if (tokenName === 'dialog') return DEFAULT_STORE_APPEARANCE.light.zIndex.dialog;
  return DEFAULT_STORE_APPEARANCE.light.zIndex[tokenName];
}

let nextOverlayId = 1;
let escapeListenerInstalled = false;
let scrollLockCount = 0;
let previousBodyOverflow = '';
let previousHtmlOverflow = '';
const overlayStack: OverlayRegistration[] = [];

function ensureEscapeListener() {
  if (escapeListenerInstalled || typeof document === 'undefined') return;
  escapeListenerInstalled = true;
  document.addEventListener('keydown', handleDocumentKeyDown, true);
}

function handleDocumentKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;

  for (let index = overlayStack.length - 1; index >= 0; index -= 1) {
    const overlay = overlayStack[index];
    if (overlay.preventEscape) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    if (overlay.onEscape) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      overlay.onEscape();
      return;
    }
  }
}

function lockPageScroll() {
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function unlockPageScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = previousBodyOverflow;
    document.documentElement.style.overflow = previousHtmlOverflow;
  }
}

export function getOverlayZIndex(kind: OverlayKind): number {
  return getOverlayZIndexFromTheme(kind);
}

export function getOverlayTarget(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  let root = document.getElementById('hanouti-overlay-root');
  if (!(root instanceof HTMLElement)) {
    root = document.createElement('div');
    root.id = 'hanouti-overlay-root';
    root.setAttribute('data-overlay-root', 'document');
    root.className = 'hanouti-overlay-root';
    document.body.appendChild(root);
  }
  return root;
}

export function useOverlayTarget(): HTMLElement {
  const [target, setTarget] = useState<HTMLElement | null>(() => getOverlayTarget());

  useEffect(() => {
    setTarget(getOverlayTarget());
  }, []);

  return target as HTMLElement;
}

export function useOverlayLifecycle({
  open,
  kind,
  onEscape,
  preventEscape = false,
  lockScroll = true,
  trapFocus = true,
  restoreFocus = true,
  containerRef,
}: OverlayRegistrationOptions): number {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  useStoreAppearance();
  const zIndex = getOverlayZIndex(kind);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!open) return;

    ensureEscapeListener();
    const registration: OverlayRegistration = {
      id: nextOverlayId++,
      kind,
      onEscape: () => onEscapeRef.current?.(),
      preventEscape,
      trapFocus,
      containerRef,
    };
    overlayStack.push(registration);
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    if (lockScroll) lockPageScroll();

    const focusFrame = window.requestAnimationFrame(() => {
      const container = containerRef?.current;
      const target = container?.querySelector<HTMLElement>(
        '[autofocus], [role="dialog"] button:not([disabled]), [role="dialog"] input:not([disabled]), [role="dialog"] textarea:not([disabled]), [role="dialog"] [tabindex]:not([tabindex="-1"])',
      );
      target?.focus();
    });

    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !trapFocus || !containerRef?.current) return;
      if (overlayStack[overlayStack.length - 1]?.id !== registration.id) return;

      const focusable = Array.from(containerRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) {
        event.preventDefault();
        containerRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !containerRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !containerRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleTab, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleTab, true);
      const index = overlayStack.findIndex((item) => item.id === registration.id);
      if (index >= 0) overlayStack.splice(index, 1);
      if (lockScroll) unlockPageScroll();
      if (restoreFocus) previousFocusRef.current?.focus();
    };
  }, [containerRef, kind, lockScroll, open, preventEscape, restoreFocus, trapFocus]);

  return zIndex;
}
