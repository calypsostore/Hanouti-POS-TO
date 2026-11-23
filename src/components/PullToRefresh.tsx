import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MaterialIcon } from './MaterialIcon';
import { useOverlayLifecycle, useOverlayTarget } from './overlay/overlayArchitecture';

interface PullToRefreshProps {
  enabled: boolean;
  children: ReactNode;
}

const REFRESH_THRESHOLD = 58;
const MAX_PULL_DISTANCE = 84;

function findScrollContainer(target: EventTarget | null): HTMLElement | null {
  let element = target instanceof HTMLElement ? target : null;
  while (element && element !== document.body) {
    const overflowY = window.getComputedStyle(element).overflowY;
    if (/(auto|scroll|overlay)/.test(overflowY) && element.scrollHeight > element.clientHeight) {
      return element;
    }
    element = element.parentElement;
  }
  return document.scrollingElement as HTMLElement | null;
}

export function PullToRefresh({ enabled, children }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef<{ startX: number; startY: number; scrollContainer: HTMLElement } | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const updatePullDistance = (distance: number) => {
      pullDistanceRef.current = distance;
      setPullDistance(distance);
    };

    const startPull = (event: TouchEvent) => {
      if (refreshingRef.current || event.touches.length !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(
        'input, textarea, select, [contenteditable="true"], [role="dialog"], dialog, .responsive-dialog, .notification-popover-panel',
      )) return;
      const touch = event.touches[0];
      const scrollContainer = findScrollContainer(event.target);
      if (!touch || !scrollContainer || scrollContainer.scrollTop > 0) return;
      pullRef.current = { startX: touch.clientX, startY: touch.clientY, scrollContainer };
    };

    const movePull = (event: TouchEvent) => {
      const pull = pullRef.current;
      const touch = event.touches[0];
      if (!pull || !touch) return;
      const deltaX = touch.clientX - pull.startX;
      const deltaY = touch.clientY - pull.startY;
      if (deltaY <= 0 || Math.abs(deltaX) > Math.abs(deltaY) || pull.scrollContainer.scrollTop > 0) {
        pullRef.current = null;
        updatePullDistance(0);
        return;
      }
      event.preventDefault();
      updatePullDistance(Math.min(deltaY * 0.62, MAX_PULL_DISTANCE));
    };

    const endPull = () => {
      if (!pullRef.current) return;
      pullRef.current = null;
      if (pullDistanceRef.current >= REFRESH_THRESHOLD && !refreshingRef.current) {
        refreshingRef.current = true;
        setRefreshing(true);
        window.dispatchEvent(new Event('focus'));
        refreshTimerRef.current = window.setTimeout(() => {
          refreshingRef.current = false;
          setRefreshing(false);
          updatePullDistance(0);
          refreshTimerRef.current = null;
        }, 1200);
      } else {
        updatePullDistance(0);
      }
    };

    const cancelPull = () => {
      pullRef.current = null;
      updatePullDistance(0);
    };

    window.addEventListener('touchstart', startPull, { passive: true });
    window.addEventListener('touchmove', movePull, { passive: false });
    window.addEventListener('touchend', endPull);
    window.addEventListener('touchcancel', cancelPull);
    return () => {
      window.removeEventListener('touchstart', startPull);
      window.removeEventListener('touchmove', movePull);
      window.removeEventListener('touchend', endPull);
      window.removeEventListener('touchcancel', cancelPull);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
        refreshingRef.current = false;
      }
    };
  }, [enabled]);

  const visible = enabled && (pullDistance > 0 || refreshing);
  const readyToRefresh = pullDistance >= REFRESH_THRESHOLD;
  const portalTarget = useOverlayTarget();
  const zIndex = useOverlayLifecycle({
    open: visible,
    kind: 'toast',
    lockScroll: false,
    trapFocus: false,
    restoreFocus: false,
  });

  return (
    <>
      {children}
      {visible && createPortal(
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-surface-container-lowest px-4 py-2 text-sm font-medium text-on-surface shadow-overlay"
          style={{
            top: 'calc(env(safe-area-inset-top, 0px) - 3.25rem)',
            transform: `translate(-50%, ${refreshing ? 64 : pullDistance}px)`,
            zIndex,
          }}
        >
          <MaterialIcon
            name="refresh"
            className={refreshing ? 'animate-spin' : ''}
          />
          {refreshing ? 'Refreshing…' : readyToRefresh ? 'Release to refresh' : 'Pull to refresh'}
        </div>,
        portalTarget,
      )}
    </>
  );
}
