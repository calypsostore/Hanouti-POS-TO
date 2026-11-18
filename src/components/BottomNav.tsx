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
  { to: '/settings', label: 'nav.settings', icon: 'tune' },
] as const;

type StaffNavigationItem = (typeof staffNavigation)[number];

export function BottomNav() {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const barRef = useRef<HTMLDivElement>(null);
  const posPulseTimeout = useRef<number | null>(null);
  const [allowed, setAllowed] = useState<Record<string, boolean>>({});
  const [activeIndicator, setActiveIndicator] = useState<{ x: number; y: number } | null>(null);
  const [posPulsing, setPosPulsing] = useState(false);

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

  useLayoutEffect(() => {
    const bar = barRef.current;
    const icon = bar?.querySelector<HTMLElement>('.bottom-nav__link[aria-current="page"] .bottom-nav__icon');
    if (!bar || !icon) {
      setActiveIndicator(null);
      return;
    }

    const updatePosition = () => {
      const barBounds = bar.getBoundingClientRect();
      const iconBounds = icon.getBoundingClientRect();
      setActiveIndicator({
        x: iconBounds.left - barBounds.left + iconBounds.width / 2,
        y: iconBounds.top - barBounds.top + iconBounds.height / 2,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [location.pathname, navigationSignature]);

  useEffect(() => () => {
    if (posPulseTimeout.current !== null) window.clearTimeout(posPulseTimeout.current);
  }, []);

  function pulsePosButton() {
    setPosPulsing(true);
    if (posPulseTimeout.current !== null) window.clearTimeout(posPulseTimeout.current);
    posPulseTimeout.current = window.setTimeout(() => setPosPulsing(false), 720);
  }

  function renderLink(item: StaffNavigationItem) {
    return (
      <NavLink
        key={item.to}
        to={item.to}
        aria-label={t(item.label)}
        className={({ isActive }) => `bottom-nav__link${isActive ? ' is-active' : ''}`}
      >
        {({ isActive }) => (
          <>
            <MaterialIcon name={item.icon} filled={isActive} className="bottom-nav__icon" />
            <span className="bottom-nav__label">{t(item.label)}</span>
          </>
        )}
      </NavLink>
    );
  }

  return (
    <nav aria-label={t('nav.staffNavigation')} className="bottom-nav">
      <div ref={barRef} className={`bottom-nav__bar${posItem ? ' has-pos' : ''}`}>
        <span
          aria-hidden="true"
          className={`bottom-nav__active-indicator${activeIndicator ? ' is-visible' : ''}`}
          style={activeIndicator ? { transform: `translate3d(${activeIndicator.x}px, ${activeIndicator.y}px, 0) translate(-50%, -50%)` } : undefined}
        />
        {posItem ? (
          <>
            <div className="bottom-nav__group bottom-nav__group--left">{leftItems.map(renderLink)}</div>
            <NavLink
              to={posItem.to}
              aria-label={t(posItem.label)}
              onClick={pulsePosButton}
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
    </nav>
  );
}
