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
  return (
    <nav
      aria-label={t('nav.staffNavigation')}
      className="fixed inset-x-0 bottom-0 z-40 bg-surface-container-lowest/95 shadow-sheet backdrop-blur-xl safe-bottom"
    >
      <div className="flex h-16 items-stretch justify-around px-1">
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
