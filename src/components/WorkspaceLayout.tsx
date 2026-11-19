import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ownerMoreLinks, ownerPrimaryLinks } from '../app/navigation';
import { BottomSheet } from './BottomSheet';
import { MaterialIcon } from './MaterialIcon';
import { TopBar } from './TopBar';
import { t, type TranslationKey } from '../i18n/translations';
import { notificationService, OWNER_NOTIFICATIONS_CHANGED_EVENT } from '../services/notificationService';
import { orderService } from '../services/orderService';
import { useAuthStore } from '../stores/authStore';
import { PageContainer } from './layout/PageContainer';

export interface WorkspaceLink {
  to: string;
  label: TranslationKey;
  icon: string;
  id?: string;
}

interface WorkspaceLayoutProps {
  title: string;
  storeName?: string;
  links: WorkspaceLink[];
  children: ReactNode;
}

export function WorkspaceLayout({ title, storeName, links, children }: WorkspaceLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const isOwnerWorkspace = links.some((link) => link.to === '/owner/dashboard');
  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingVoidCount, setPendingVoidCount] = useState(0);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem('hanouti.sidebar-collapsed.v1') === 'true');

  useEffect(() => {
    const storeId = user?.storeId;
    if (!isOwnerWorkspace || !user || !storeId) return;
    let active = true;
    let requestId = 0;
    const refreshBadges = () => {
      const currentRequestId = ++requestId;
      void Promise.all([
        orderService.listAll(storeId),
        notificationService.listFor(user),
      ]).then(([orders, notifications]) => {
        if (!active || currentRequestId !== requestId) return;
        setPendingVoidCount(orders.filter((order) => order.status === 'pending_void').length);
        setUnreadNotificationCount(notifications.filter((notification) => !notification.readAt).length);
      }).catch((error: unknown) => {
        console.error('Could not load owner navigation badges.', error);
      });
    };
    refreshBadges();
    window.addEventListener('focus', refreshBadges);
    window.addEventListener('storage', refreshBadges);
    window.addEventListener(OWNER_NOTIFICATIONS_CHANGED_EVENT, refreshBadges);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshBadges);
      window.removeEventListener('storage', refreshBadges);
      window.removeEventListener(OWNER_NOTIFICATIONS_CHANGED_EVENT, refreshBadges);
    };
  }, [isOwnerWorkspace, user]);

  const badgeCountFor = (link: WorkspaceLink) => {
    if (link.to === '/owner/voids') return pendingVoidCount;
    if (link.to === '/notifications') return unreadNotificationCount;
    return 0;
  };
  const totalBadgeCount = pendingVoidCount + unreadNotificationCount;
  const isMoreActive = ownerMoreLinks.some((link) => location.pathname === link.to);
  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem('hanouti.sidebar-collapsed.v1', String(next));
      return next;
    });
  };
  const sidebarGroups: Array<{ title: string; links: WorkspaceLink[] }> = isOwnerWorkspace
    ? [
        { title: 'Operations', links: links.filter((link) => ['/owner/dashboard', '/pos', '/orders', '/owner/shifts', '/owner/voids'].includes(link.to)) },
        { title: 'People', links: links.filter((link) => ['/owner/staff', '/owner/schedule', '/customers'].includes(link.to)) },
        { title: 'Catalog', links: links.filter((link) => ['/owner/catalog', '/owner/inventory', '/owner/waste'].includes(link.to)) },
        { title: 'Money', links: links.filter((link) => ['/owner/reports', '/owner/expenses', '/owner/suppliers'].includes(link.to)) },
        { title: 'System', links: links.filter((link) => ['/owner/activity', '/notifications', '/owner/settings'].includes(link.to)) },
      ]
    : [{ title: 'System', links }];

  return (
    <div className={`workspace-layout min-h-screen bg-surface pb-6${isOwnerWorkspace ? ' owner-workspace' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <TopBar title={title} storeName={storeName} onProfileClick={() => navigate('/settings')} />
      <aside className="desktop-sidebar" aria-label={t('common.workspaceNavigation')}>
        <div className="desktop-sidebar__brand">
          <span className="desktop-sidebar__logo"><MaterialIcon name="local_cafe" /></span>
          {!sidebarCollapsed && <span className="desktop-sidebar__app-name">{t('common.appName')}</span>}
        </div>
        <nav className="desktop-sidebar__nav">
          {sidebarGroups.map((group) => (
            <div className="desktop-sidebar__group" key={group.title}>
              {!sidebarCollapsed && <p className="desktop-sidebar__group-title">{group.title}</p>}
              {group.links.map((link) => (
                <NavLink
                  key={link.id ?? link.to}
                  to={link.to}
                  title={sidebarCollapsed ? t(link.label) : undefined}
                  className={({ isActive }) => `desktop-sidebar__link${isActive ? ' is-active' : ''}`}
                >
                  <MaterialIcon name={link.icon} className="desktop-sidebar__icon" />
                  {!sidebarCollapsed && <span className="desktop-sidebar__label">{t(link.label)}</span>}
                  {badgeCountFor(link) > 0 && (
                    <span className={`workspace-nav-badge${sidebarCollapsed ? ' workspace-nav-badge--collapsed' : ''}`}>
                      {badgeCountFor(link) > 99 ? '99+' : badgeCountFor(link)}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <button type="button" className="desktop-sidebar__collapse" onClick={toggleSidebar} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <MaterialIcon name={sidebarCollapsed ? 'chevron_right' : 'chevron_left'} />
        </button>
      </aside>
      <nav aria-label={t('common.workspaceNavigation')} className={`workspace-desktop-nav scrollbar-hidden sticky top-16 z-20 flex gap-2 overflow-x-auto border-b border-outline-variant bg-surface/95 px-3 py-2 backdrop-blur-xl${isOwnerWorkspace ? ' owner-desktop-nav' : ''}`}>
        {links.map((link) => (
          <NavLink
            key={link.id ?? link.to}
            to={link.to}
            className={({ isActive }) => `inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 font-body text-label-md transition ${
              isActive ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant'
            }`}
          >
            <MaterialIcon name={link.icon} className="text-lg" />
            {t(link.label)}
            {badgeCountFor(link) > 0 && (
              <span className="workspace-nav-badge" aria-label={`${badgeCountFor(link)} pending`}>
                {badgeCountFor(link) > 99 ? '99+' : badgeCountFor(link)}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <main className="workspace-main mx-auto w-full p-0">
        <PageContainer>{children}</PageContainer>
      </main>
      {isOwnerWorkspace && (
        <>
          <nav aria-label={t('nav.ownerNavigation')} className="owner-mobile-nav">
            {ownerPrimaryLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                aria-label={t(link.label)}
                className={({ isActive }) => `owner-mobile-nav__item${isActive ? ' is-active' : ''}`}
              >
                <MaterialIcon name={link.icon} className="owner-mobile-nav__icon" />
                <span>{t(link.label)}</span>
              </NavLink>
            ))}
            <button
              type="button"
              aria-label={t('nav.more')}
              aria-expanded={moreOpen}
              aria-controls="owner-more-navigation"
              onClick={() => setMoreOpen(true)}
              className={`owner-mobile-nav__item${isMoreActive ? ' is-active' : ''}`}
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
              {ownerMoreLinks.map((link) => {
                const badgeCount = badgeCountFor(link);
                return (
                  <NavLink
                    key={`${link.to}-${link.label}`}
                    to={link.to}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) => `owner-more-list__item${isActive ? ' is-active' : ''}`}
                  >
                    <MaterialIcon name={link.icon} className="text-xl" />
                    <span className="min-w-0 flex-1">{t(link.label)}</span>
                    {badgeCount > 0 && <span className="owner-more-list__badge">{badgeCount > 99 ? '99+' : badgeCount}</span>}
                  </NavLink>
                );
              })}
            </nav>
          </BottomSheet>
        </>
      )}
    </div>
  );
}
