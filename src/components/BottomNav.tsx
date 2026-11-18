import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { MaterialIcon } from './MaterialIcon';
import { t } from '../i18n/translations';
import { useAuthStore } from '../stores/authStore';
import { userService } from '../services/userService';

const staffNavigation = [
  { to: '/dashboard', permission: null, label: 'nav.dashboard', icon: 'space_dashboard' },
  { to: '/pos', permission: 'take_orders', label: 'nav.pos', icon: 'point_of_sale' },
  { to: '/orders', permission: 'view_order_history', label: 'nav.orders', icon: 'receipt_long' },
  { to: '/customers', permission: 'customers', label: 'nav.customers', icon: 'group' },
  { to: '/shift', permission: 'open_close_shift', label: 'nav.shift', icon: 'payments' },
  { to: '/settings', label: 'nav.settings', icon: 'settings' },
] as const;

type StaffNavigationItem = (typeof staffNavigation)[number];

let previousIndicatorPosition: { x: number; y: number } | null = null;
let pendingNavigationPath: string | null = null;
let pendingPosPulse = false;

export function BottomNav() {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const barRef = useRef<HTMLDivElement>(null);
  const posNavigationPointerStart = useRef<number | null>(null);
  const [allowed, setAllowed] = useState<Record<string, boolean>>({});
  const [posNavigationOpen, setPosNavigationOpen] = useState(false);
  const [activeIndicator, setActiveIndicator] = useState<{ x: number; y: number } | null>(() =>
    location.pathname !== '/pos' && pendingNavigationPath === location.pathname ? previousIndicatorPosition : null,
  );
  const [posPulsing, setPosPulsing] = useState(() => {
    const shouldPulse = pendingPosPulse;
    pendingPosPulse = false;
    return shouldPulse;
  });

  useEffect(() => {
    if (!user) return;
    void Promise.all([
      userService.hasPermission(user.id, 'take_orders'),
      userService.hasPermission(user.id, 'view_order_history'),
      userService.hasPermission(user.id, 'use_tabs'),
      userService.hasPermission(user.id, 'settle_tabs'),
      userService.hasPermission(user.id, 'open_close_shift'),
    ]).then(([takeOrders, viewHistory, useTabs, settleTabs, manageShift]) => {
      setAllowed({ '/pos': takeOrders, '/orders': viewHistory, '/customers': useTabs || settleTabs, '/shift': manageShift });
    }).catch((error: unknown) => console.error('Could not load staff navigation permissions.', error));
  }, [user]);

  const visibleNavigation = staffNavigation.filter((item) => {
    if (!('permission' in item) || item.permission === null) return true;
    return item.permission ? allowed[item.to] : true;
  });
  const posItem = visibleNavigation.find((item) => item.to === '/pos');
  const otherItems = visibleNavigation.filter((item) => item.to !== '/pos');
  const leftItems = otherItems.slice(0, 2);
  const rightItems = otherItems.slice(2);
  const navigationSignature = visibleNavigation.map((item) => item.to).join('|');
  const isPosScreen = location.pathname === '/pos';

  useLayoutEffect(() => {
    const bar = barRef.current;
    const activeLinkIcon = bar?.querySelector<HTMLElement>('.bottom-nav__link[aria-current="page"] .bottom-nav__icon');
    const activePosOrbit = bar?.querySelector<HTMLElement>('.bottom-nav__pos-link[aria-current="page"] .bottom-nav__pos-orbit');
    const target = activeLinkIcon ?? activePosOrbit;
    if (!bar || !target) {
      if (pendingNavigationPath !== location.pathname) setActiveIndicator(null);
      return;
    }

    const isPosActive = !activeLinkIcon;
    const updatePosition = () => {
      const barBounds = bar.getBoundingClientRect();
      const targetBounds = target.getBoundingClientRect();
      const position = {
        x: targetBounds.left - barBounds.left + targetBounds.width / 2,
        y: targetBounds.top - barBounds.top + targetBounds.height / 2,
      };
      previousIndicatorPosition = position;
      setActiveIndicator(isPosActive ? null : position);
    };

    let animationFrame: number | null = null;
    if (!isPosActive && pendingNavigationPath === location.pathname && previousIndicatorPosition) {
      setActiveIndicator(previousIndicatorPosition);
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        pendingNavigationPath = null;
        updatePosition();
      });
    } else {
      updatePosition();
      if (pendingNavigationPath === location.pathname) pendingNavigationPath = null;
    }

    window.addEventListener('resize', updatePosition);
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', updatePosition);
    };
  }, [location.pathname, navigationSignature]);

  useEffect(() => {
    if (!posPulsing) return;
    const timeout = window.setTimeout(() => setPosPulsing(false), 720);
    return () => window.clearTimeout(timeout);
  }, [posPulsing]);

  function pulsePosButton() {
    setPosPulsing(true);
  }

  function handlePosNavigationPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    posNavigationPointerStart.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePosNavigationPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const startY = posNavigationPointerStart.current;
    if (startY === null) return;
    posNavigationPointerStart.current = null;
    const swipeDistance = startY - event.clientY;
    if (swipeDistance > 24) setPosNavigationOpen(true);
    else if (swipeDistance < -24) setPosNavigationOpen(false);
    else setPosNavigationOpen((open) => !open);
  }

  function renderLink(item: StaffNavigationItem) {
    return (
      <NavLink
        key={item.to}
        to={item.to}
        aria-label={t(item.label)}
        onClick={() => { pendingNavigationPath = item.to === location.pathname ? null : item.to; }}
        className={({ isActive }) => `bottom-nav__link${isActive ? ' is-active' : ''}`}
      >
        {({ isActive }) => (
          <MaterialIcon name={item.icon} filled={isActive} className="bottom-nav__icon" />
        )}
      </NavLink>
    );
  }

  return (
    <nav
      aria-label={t('nav.staffNavigation')}
      className={`bottom-nav${isPosScreen && posNavigationOpen ? ' is-pos-open' : ''}`}
    >
      <div
        ref={barRef}
        id="staff-bottom-nav-bar"
        className={`bottom-nav__bar${posItem ? ' has-pos' : ''}${isPosScreen && !posNavigationOpen ? ' is-hidden-in-pos' : ''}`}
      >
        {activeIndicator && (
          <span
            aria-hidden="true"
            className="bottom-nav__active-indicator"
            style={{ transform: `translate3d(${activeIndicator.x}px, ${activeIndicator.y}px, 0) translate(-50%, -50%)` }}
          />
        )}
        {posItem ? (
          <>
            <div className="bottom-nav__group bottom-nav__group--left">{leftItems.map(renderLink)}</div>
            <NavLink
              to={posItem.to}
              aria-label={t(posItem.label)}
              onClick={() => {
                pendingNavigationPath = posItem.to === location.pathname ? null : posItem.to;
                pendingPosPulse = posItem.to !== location.pathname;
                pulsePosButton();
              }}
              className={({ isActive }) => `bottom-nav__pos-link${isActive ? ' is-active' : ''}${posPulsing ? ' is-pulsing' : ''}`}
            >
              <span className="bottom-nav__pos-orbit">
                <MaterialIcon name={posItem.icon} className="bottom-nav__pos-icon" />
              </span>
              <span className="sr-only">{t(posItem.label)}</span>
            </NavLink>
            <div className="bottom-nav__group bottom-nav__group--right">{rightItems.map(renderLink)}</div>
          </>
        ) : visibleNavigation.map(renderLink)}
      </div>
      {isPosScreen && (
        <button
          type="button"
          className="bottom-nav__pos-toggle"
          aria-label={t(posNavigationOpen ? 'nav.hideNavigation' : 'nav.showNavigation')}
          aria-expanded={posNavigationOpen}
          aria-controls="staff-bottom-nav-bar"
          onPointerDown={handlePosNavigationPointerDown}
          onPointerUp={handlePosNavigationPointerUp}
          onPointerCancel={() => { posNavigationPointerStart.current = null; }}
          onClick={(event) => {
            if (event.detail === 0) setPosNavigationOpen((open) => !open);
          }}
        >
          <MaterialIcon name="menu" />
        </button>
      )}
    </nav>
  );
}
