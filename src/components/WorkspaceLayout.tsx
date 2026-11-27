import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ownerMoreLinks, ownerPrimaryLinks } from '../app/navigation';
import { BottomSheet } from './BottomSheet';
import { MaterialIcon } from './MaterialIcon';
import { TopBar } from './TopBar';
import { t, type TranslationKey } from '../i18n/translations';
import { orderService } from '../services/orderService';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { PageContainer } from './layout/PageContainer';
import { userService } from '../services/userService';
import { resolveStoreSettings, type StoreType } from '../types/domain';
import { ProfileAvatar } from './ProfileAvatar';

export interface WorkspaceLink {
  to: string;
  label: TranslationKey;
  icon: string;
  id?: string;
  permission?: string | string[];
  ownerOnly?: boolean;
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
  const permissions = useAuthStore((state) => state.permissions);
  const hasPermission = (permission: string | string[] | undefined) => !permission ||
    (Array.isArray(permission) ? permission.some((id) => permissions.includes(id)) : permissions.includes(permission));
  const visibleLinks = links.filter((link) =>
    user?.role === 'owner' || (
      !link.ownerOnly &&
      hasPermission(link.permission)
    ),
  );
  const visiblePrimaryLinks = ownerPrimaryLinks.filter((link) => visibleLinks.some((visible) => visible.to === link.to));
  const visibleMoreLinks = ownerMoreLinks.filter((link) => visibleLinks.some((visible) => visible.to === link.to));
  const isOwnerWorkspace = links.some((link) => link.to === '/owner/dashboard');
  const isShiftWorkspace = location.pathname === '/owner/shifts';
  const isSettingsWorkspace = location.pathname === '/owner/settings' || location.pathname === '/settings';
  const usesOwnerTabletBottomNav = isOwnerWorkspace && location.pathname !== '/pos' && !isShiftWorkspace;
  const isDashboardWorkspace = location.pathname === '/owner/dashboard' || location.pathname === '/admin/overview';
  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingVoidCount, setPendingVoidCount] = useState(0);
  const unreadNotificationCount = useNotificationStore((state) => state.unreadCount);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem('hanouti.sidebar-collapsed.v1') === 'true');
  const [activeLinkPosition, setActiveLinkPosition] = useState({ top: 0, left: 0, width: 0, height: 0, visible: false });
  const sidebarNavRef = useRef<HTMLElement>(null);
  const [storeLogoId, setStoreLogoId] = useState('');
  const [storeType, setStoreType] = useState<StoreType>('general');

  useEffect(() => {
    const storeId = user?.storeId;
    if (!storeId) return;
    let active = true;
    const refreshLogo = () => {
      void userService.getStore(storeId).then((store) => {
        if (active) {
          const storeSettings = resolveStoreSettings(store?.settings);
          setStoreLogoId(storeSettings.storeLogoId);
          setStoreType(storeSettings.storeType);
        }
      }).catch((error: unknown) => console.error('Unable to load the store logo.', error));
    };
    refreshLogo();
    window.addEventListener('hanouti:store-settings-updated', refreshLogo);
    return () => {
      active = false;
      window.removeEventListener('hanouti:store-settings-updated', refreshLogo);
    };
  }, [user?.storeId]);

  useEffect(() => {
    const storeId = user?.storeId;
    if (!isOwnerWorkspace || !user || !storeId) return;
    let active = true;
    let requestId = 0;
    const refreshBadges = () => {
      const currentRequestId = ++requestId;
      void Promise.all([
        orderService.listAll(storeId),
      ]).then(([orders]) => {
        if (!active || currentRequestId !== requestId) return;
        setPendingVoidCount(orders.filter((order) => order.status === 'pending_void').length);
      }).catch((error: unknown) => {
        console.error('Could not load owner navigation badges.', error);
      });
    };
    refreshBadges();
    window.addEventListener('focus', refreshBadges);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshBadges);
    };
  }, [isOwnerWorkspace, user]);

  const badgeCountFor = (link: WorkspaceLink) => {
    if (link.to === '/owner/voids') return pendingVoidCount;
    if (link.to === '/notifications') return unreadNotificationCount;
    return 0;
  };
  const totalBadgeCount = pendingVoidCount + unreadNotificationCount;
  const isMoreActive = visibleMoreLinks.some((link) =>
    location.pathname === link.to || location.pathname.startsWith(`${link.to}/`),
  );
  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem('hanouti.sidebar-collapsed.v1', String(next));
      return next;
    });
  };
  useLayoutEffect(() => {
    const nav = sidebarNavRef.current;
    if (!nav) return;
    const updateActivePosition = () => {
      const activeLink = nav.querySelector<HTMLElement>('.desktop-sidebar__link.is-active');
      if (!activeLink) {
        setActiveLinkPosition((position) => ({ ...position, visible: false }));
        return;
      }
      const navBounds = nav.getBoundingClientRect();
      const linkBounds = activeLink.getBoundingClientRect();
      setActiveLinkPosition({
        top: linkBounds.top - navBounds.top + nav.scrollTop,
        left: linkBounds.left - navBounds.left + nav.scrollLeft,
        width: linkBounds.width,
        height: linkBounds.height,
        visible: true,
      });
    };
    updateActivePosition();
    const resizeObserver = new ResizeObserver(updateActivePosition);
    resizeObserver.observe(nav);
    window.addEventListener('resize', updateActivePosition);
    nav.addEventListener('scroll', updateActivePosition, { passive: true });
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateActivePosition);
      nav.removeEventListener('scroll', updateActivePosition);
    };
  }, [location.pathname, sidebarCollapsed, links]);
  const sidebarGroups: Array<{ title: TranslationKey; links: WorkspaceLink[] }> = isOwnerWorkspace
    ? [
        { title: 'nav.group.operations', links: visibleLinks.filter((link) => ['/owner/dashboard', '/pos', '/orders', '/owner/shifts', '/owner/voids'].includes(link.to)) },
        { title: 'nav.group.people', links: visibleLinks.filter((link) => ['/owner/staff', '/owner/devices', '/owner/schedule', '/customers'].includes(link.to)) },
        { title: 'nav.group.catalog', links: visibleLinks.filter((link) => ['/owner/catalog', '/owner/inventory', '/owner/waste'].includes(link.to)) },
        { title: 'nav.group.money', links: visibleLinks.filter((link) => ['/owner/reports', '/owner/fiscal-reports', '/owner/fiscal', '/owner/expenses', '/owner/suppliers'].includes(link.to)) },
        { title: 'nav.group.system', links: visibleLinks.filter((link) => ['/owner/activity', '/notifications', '/owner/settings'].includes(link.to)) },
      ]
    : [{ title: 'nav.group.system', links }];

  return (
    <div className={`workspace-layout min-h-screen bg-surface pb-6${isOwnerWorkspace ? ' owner-workspace' : ''}${isDashboardWorkspace ? ' dashboard-workspace' : ''}${isShiftWorkspace ? ' shift-screen-layout' : ''}${isSettingsWorkspace ? ' settings-screen-layout' : ''}${usesOwnerTabletBottomNav ? ' owner-tablet-bottom-nav' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <TopBar title={title} storeName={storeName} storeLogoId={storeLogoId} storeType={storeType} onProfileClick={() => navigate('/settings')} />
      <aside className="desktop-sidebar" aria-label={t('common.workspaceNavigation')}>
        <div className="desktop-sidebar__brand">
          <span className="desktop-sidebar__logo"><MaterialIcon name="local_cafe" /></span>
          {!sidebarCollapsed && <span className="desktop-sidebar__app-name">{t('common.appName')}</span>}
        </div>
        <nav ref={sidebarNavRef} className="desktop-sidebar__nav">
          <span
            aria-hidden="true"
            className="desktop-sidebar__active-capsule"
            style={{
              height: `${activeLinkPosition.height}px`,
              width: `${activeLinkPosition.width}px`,
              transform: `translate3d(${activeLinkPosition.left}px, ${activeLinkPosition.top}px, 0)`,
              opacity: activeLinkPosition.visible ? 1 : 0,
            }}
          />
          {sidebarGroups.map((group) => (
            <div className="desktop-sidebar__group" key={group.title}>
              {!sidebarCollapsed && <p className="desktop-sidebar__group-title">{t(group.title)}</p>}
              <div className="desktop-sidebar__group-card">
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
            </div>
          ))}
        </nav>
        <div className="desktop-sidebar__footer">
          <button type="button" className="desktop-sidebar__user" onClick={() => navigate('/settings')} aria-label={t('common.profileSettings')}>
            <span className="desktop-sidebar__avatar">
              <ProfileAvatar avatarId={user?.avatarId} className="h-full w-full" />
            </span>
            {!sidebarCollapsed && user && (
              <span className="desktop-sidebar__user-copy">
                <span className="desktop-sidebar__user-name">{user.name}</span>
                <span className="desktop-sidebar__user-role">{t(user.role === 'owner' ? 'common.roleManager' : user.role === 'staff' ? 'common.roleStaff' : 'common.roleSuperAdmin')}</span>
              </span>
            )}
          </button>
          <button type="button" className="desktop-sidebar__collapse" onClick={toggleSidebar} aria-label={t(sidebarCollapsed ? 'nav.expandSidebar' : 'nav.collapseSidebar')}>
            <MaterialIcon name={sidebarCollapsed ? 'keyboard_arrow_right' : 'keyboard_arrow_left'} />
          </button>
        </div>
      </aside>
      <nav aria-label={t('common.workspaceNavigation')} className={`workspace-desktop-nav scrollbar-hidden sticky top-16 z-20 flex gap-2 overflow-x-auto border-b border-outline-variant bg-surface/95 px-3 py-2 backdrop-blur-xl${isOwnerWorkspace ? ' owner-desktop-nav' : ''}`}>
        {visibleLinks.map((link) => (
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
              <span className="workspace-nav-badge" aria-label={t('nav.pendingCount', { count: badgeCountFor(link) })}>
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
            {visiblePrimaryLinks.map((link) => (
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
          <BottomSheet
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            title={t('nav.more')}
            icon="grid_view"
            iconElement={
              <>
                <MaterialIcon name="grid_view" className="owner-more-header-icon--desktop" />
                <MaterialIcon name="grid_view" className="owner-more-header-icon--mobile" />
              </>
            }
            closeIcon={
              <>
                <MaterialIcon name="close" className="owner-more-close-icon--desktop" />
                <MaterialIcon name="close" className="owner-more-close-icon--mobile" />
              </>
            }
            panelClassName="owner-more-panel"
          >
            <nav id="owner-more-navigation" aria-label={t('nav.moreNavigation')} className="owner-more-list">
              {visibleMoreLinks.map((link) => {
                const badgeCount = badgeCountFor(link);
                return (
                  <NavLink
                    key={`${link.to}-${link.label}`}
                    to={link.to}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) => `owner-more-list__item${isActive ? ' is-active' : ''}`}
                  >
                    <MaterialIcon name={link.icon} className="owner-more-list__desktop-icon text-xl" />
                    <MaterialIcon name={link.icon} className="owner-more-list__mobile-icon" />
                    <span className="min-w-0 flex-1">{t(link.label)}</span>
                    {badgeCount > 0 && <span className="owner-more-list__badge">{badgeCount > 99 ? '99+' : badgeCount}</span>}
                    <MaterialIcon name="chevron_right" className="owner-more-chevron--desktop owner-more-list__chevron" />
                    <MaterialIcon name="chevron_right" className="owner-more-chevron--mobile owner-more-list__chevron" />
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
