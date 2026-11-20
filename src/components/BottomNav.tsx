import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { MaterialIcon } from './MaterialIcon';
import { BottomSheet } from './BottomSheet';
import { t } from '../i18n/translations';
import { useAuthStore } from '../stores/authStore';
import { ownerMoreLinks, ownerPrimaryLinks } from '../app/navigation';
import { orderService } from '../services/orderService';
import { useNotificationStore } from '../stores/notificationStore';

const staffNavigation = [
  { to: '/pos', label: 'nav.pos', icon: 'point_of_sale' },
  { to: '/orders', label: 'nav.orders', icon: 'receipt_long' },
  { to: '/shift', label: 'nav.shift', icon: 'payments' },
  { to: '/settings', label: 'nav.settings', icon: 'settings' },
] as const;

export function BottomNav() {
  const user = useAuthStore((state) => state.user);
  const isOwner = user?.role === 'owner';
  const navigation = staffNavigation;
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem('hanouti.sidebar-collapsed.v1') === 'true');
  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingVoidCount, setPendingVoidCount] = useState(0);
  const unreadNotificationCount = useNotificationStore((state) => state.unreadCount);

  useEffect(() => {
    const storeId = user?.storeId;
    if (!isOwner || !storeId) return;
    let active = true;
    const refreshBadges = () => {
      void Promise.all([
        orderService.listAll(storeId),
      ]).then(([orders]) => {
        if (!active) return;
        setPendingVoidCount(orders.filter((order) => order.status === 'pending_void').length);
      }).catch((error: unknown) => {
        console.error('Could not load owner bottom navigation badges.', error);
      });
    };
    refreshBadges();
    window.addEventListener('focus', refreshBadges);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshBadges);
    };
  }, [isOwner, user]);

  useEffect(() => {
    document.documentElement.classList.toggle('staff-sidebar-layout', !isOwner);
    document.documentElement.classList.toggle('staff-sidebar-collapsed', !isOwner && collapsed);
    return () => {
      document.documentElement.classList.remove('staff-sidebar-layout', 'staff-sidebar-collapsed');
    };
  }, [collapsed, isOwner]);

  const badgeCountFor = (to: string) => {
    if (to === '/owner/voids') return pendingVoidCount;
    if (to === '/notifications') return unreadNotificationCount;
    return 0;
  };
  const totalBadgeCount = pendingVoidCount + unreadNotificationCount;

  if (isOwner) {
    return (
      <>
        <nav aria-label={t('nav.ownerNavigation')} className="owner-mobile-nav">
          {ownerPrimaryLinks.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={t(item.label)}
              className={({ isActive }) => `owner-mobile-nav__item${isActive ? ' is-active' : ''}`}
            >
              <MaterialIcon name={item.icon} className="owner-mobile-nav__icon" />
              <span>{t(item.label)}</span>
            </NavLink>
          ))}
          <button
            type="button"
            aria-label={t('nav.more')}
            aria-expanded={moreOpen}
            aria-controls="owner-more-navigation"
            onClick={() => setMoreOpen(true)}
            className="owner-mobile-nav__item"
          >
            <span className="owner-mobile-nav__more-icon">
              <MaterialIcon name="more_horiz" className="owner-mobile-nav__icon" />
              {totalBadgeCount > 0 && <span className="owner-mobile-nav__badge">{totalBadgeCount > 99 ? '99+' : totalBadgeCount}</span>}
            </span>
            <span>{t('nav.more')}</span>
          </button>
        </nav>
        <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t('nav.more')}>
          <nav id="owner-more-navigation" aria-label={t('nav.moreNavigation')} className="owner-more-list">
            {ownerMoreLinks.map((item) => {
              const badgeCount = badgeCountFor(item.to);
              return (
                <NavLink
                  key={`${item.to}-${item.label}`}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) => `owner-more-list__item${isActive ? ' is-active' : ''}`}
                >
                  <MaterialIcon name={item.icon} className="text-xl" />
                  <span className="min-w-0 flex-1">{t(item.label)}</span>
                  {badgeCount > 0 && <span className="owner-more-list__badge">{badgeCount > 99 ? '99+' : badgeCount}</span>}
                </NavLink>
              );
            })}
          </nav>
        </BottomSheet>
      </>
    );
  }

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem('hanouti.sidebar-collapsed.v1', String(next));
      return next;
    });
  };

  return (
    <nav
      aria-label={t('nav.staffNavigation')}
      className="staff-bottom-nav fixed inset-x-0 bottom-0 z-40 bg-surface-container-lowest/95 shadow-sheet backdrop-blur-xl safe-bottom"
    >
      <button type="button" className="staff-sidebar-collapse" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        <MaterialIcon name={collapsed ? 'chevron_right' : 'chevron_left'} />
      </button>
      <div className="staff-bottom-nav__items flex h-16 items-stretch justify-around px-1">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex min-h-14 min-w-14 flex-1 flex-col items-center justify-center gap-0.5 font-body text-label-sm transition-colors ${
                isActive ? 'text-primary' : 'text-slate-500 hover:text-primary'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <MaterialIcon name={item.icon} filled={isActive} className="text-2xl" />
                <span>{t(item.label)}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
