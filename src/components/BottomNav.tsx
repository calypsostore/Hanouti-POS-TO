import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { MaterialIcon } from './MaterialIcon';
import { t } from '../i18n/translations';

const staffNavigation = [
  { to: '/pos', label: 'nav.pos', icon: 'point_of_sale' },
  { to: '/orders', label: 'nav.orders', icon: 'receipt_long' },
  { to: '/shift', label: 'nav.shift', icon: 'payments' },
  { to: '/settings', label: 'nav.settings', icon: 'tune' },
] as const;

export function BottomNav() {
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem('hanouti.sidebar-collapsed.v1') === 'true');

  useEffect(() => {
    document.documentElement.classList.add('staff-sidebar-layout');
    document.documentElement.classList.toggle('staff-sidebar-collapsed', collapsed);
    return () => {
      document.documentElement.classList.remove('staff-sidebar-layout', 'staff-sidebar-collapsed');
    };
  }, [collapsed]);

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
        {staffNavigation.map((item) => (
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
