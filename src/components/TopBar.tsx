import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { MaterialIcon } from './MaterialIcon';
import { ProfileAvatar } from './ProfileAvatar';
import { t } from '../i18n/translations';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { notificationPath } from '../lib/notificationPath';
import type { NotificationRecord, ProfileAvatarId, StoreType } from '../types/domain';
import { getLogoDefinition } from '../data/logoCatalog';
import { DEFAULT_PROFILE_AVATAR_ID, PROFILE_AVATARS } from '../data/profileAvatars';

interface TopBarProps {
  title: string;
  storeName?: string;
  storeLogoId?: string;
  storeType?: StoreType;
  onProfileClick?: () => void;
  onDashboardClick?: () => void;
  onLockClick?: () => void;
}

export function TopBar({ title, storeName, storeLogoId, storeType = 'general', onProfileClick, onDashboardClick, onLockClick }: TopBarProps) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const updateProfileAvatar = useAuthStore((state) => state.updateProfileAvatar);
  const displayedStoreName = storeName?.trim() || t('common.appName');
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const notificationItems = useNotificationStore((state) => state.items);
  const recentNotifications = useMemo(() => notificationItems.slice(0, 6), [notificationItems]);
  const notificationsLoading = useNotificationStore((state) => state.status === 'loading');
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllReadStore = useNotificationStore((state) => state.markAllRead);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsError, setNotificationsError] = useState('');
  const [activeNotificationId, setActiveNotificationId] = useState('');
  const [notificationPosition, setNotificationPosition] = useState({ top: 64, originX: 320 });
  const [profileOpen, setProfileOpen] = useState(false);
  const [profilePosition, setProfilePosition] = useState(64);
  const [profileError, setProfileError] = useState('');
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const storeLogo = getLogoDefinition(storeLogoId ?? '');
  const updateNotificationPosition = useCallback(() => {
    const buttonBounds = notificationButtonRef.current?.getBoundingClientRect();
    if (!buttonBounds) return;
    const panelWidth = Math.min(352, Math.max(0, window.innerWidth - 16));
    const panelLeft = window.innerWidth - 8 - panelWidth;
    const bellCenterX = buttonBounds.left + buttonBounds.width / 2;
    setNotificationPosition({
      top: buttonBounds.bottom + 6,
      originX: Math.min(panelWidth - 16, Math.max(16, bellCenterX - panelLeft)),
    });
  }, []);
  const updateProfilePosition = useCallback(() => {
    const buttonBounds = profileButtonRef.current?.getBoundingClientRect();
    if (buttonBounds) setProfilePosition(buttonBounds.bottom + 6);
  }, []);

  async function openNotification(notification: NotificationRecord) {
    if (!user) return;
    setActiveNotificationId(notification.id);
    try {
      await markRead(user, notification.id);
      setNotificationsOpen(false);
      navigate(notificationPath(notification, user.role));
    } catch (error) {
      console.error('Unable to open this notification.', error);
      setNotificationsError('Unable to open this notification. Please try again.');
    } finally {
      setActiveNotificationId('');
    }
  }

  async function markNotificationRead(notificationId: string) {
    if (!user) return;
    setActiveNotificationId(notificationId);
    try {
      await markRead(user, notificationId);
    } catch (error) {
      console.error('Unable to mark this notification as read.', error);
      setNotificationsError('Unable to mark this notification as read. Please try again.');
    } finally {
      setActiveNotificationId('');
    }
  }

  async function markAllNotificationsRead() {
    if (!user) return;
    try {
      await markAllReadStore(user);
    } catch (error) {
      console.error('Unable to mark notifications as read.', error);
      setNotificationsError('Unable to mark notifications as read. Please try again.');
    }
  }

  function openNotifications() {
    setNotificationsError('');
    updateNotificationPosition();
    setProfileOpen(false);
    setNotificationsOpen(true);
  }

  function openProfile() {
    setProfileError('');
    updateProfilePosition();
    setNotificationsOpen(false);
    setProfileOpen(true);
  }

  async function handleLogout() {
    setProfileError('');
    setLoggingOut(true);
    try {
      await logout();
      setProfileOpen(false);
      navigate('/', { replace: true });
    } catch (error) {
      console.error('Unable to log out from the profile menu.', error);
      setProfileError(error instanceof Error ? error.message : 'Unable to log out. Please try again.');
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleAvatarChange(avatarId: ProfileAvatarId) {
    setProfileError('');
    setSavingAvatar(true);
    try {
      await updateProfileAvatar(avatarId);
    } catch (error) {
      console.error('Unable to update the profile avatar.', error);
      setProfileError(error instanceof Error ? error.message : 'Unable to update your avatar. Please try again.');
    } finally {
      setSavingAvatar(false);
    }
  }

  useEffect(() => {
    if (!notificationsOpen && !profileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNotificationsOpen(false);
        setProfileOpen(false);
      }
    };
    const updatePositions = () => {
      if (notificationsOpen) updateNotificationPosition();
      if (profileOpen) updateProfilePosition();
    };
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', updatePositions);
    window.addEventListener('scroll', updatePositions, true);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', updatePositions);
      window.removeEventListener('scroll', updatePositions, true);
    };
  }, [notificationsOpen, profileOpen, updateNotificationPosition, updateProfilePosition]);

  return (
    <>
    <header className="top-bar-glass safe-top sticky top-0 z-30 border-b">
      <div className="top-bar-content flex h-16 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-fixed text-primary">
            {storeLogo ? (
              <img src={storeLogo.src} alt="" className="h-8 w-8 object-contain" />
            ) : (
              <MaterialIcon
                name={storeType === 'coffee' ? 'local_cafe' : storeType === 'restaurant' ? 'restaurant' : storeType === 'bakery' ? 'bakery_dining' : storeType === 'grocery' ? 'local_mall' : 'storefront'}
                className="text-2xl"
              />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate font-body text-label-sm text-outline">{displayedStoreName}</p>
            <h1 className="truncate font-display text-headline-sm text-primary">{title}</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onDashboardClick && (
            <button
              type="button"
              aria-label={t('nav.dashboard')}
              title={t('nav.dashboard')}
              onClick={onDashboardClick}
              className="flex h-8 items-center justify-center gap-1.5 rounded-full bg-surface-container px-2 text-primary tablet:px-2.5"
            >
              <MaterialIcon name="dashboard" />
              <span className="hidden tablet:inline">{t('nav.dashboard')}</span>
            </button>
          )}
          {onLockClick && (
            <button type="button" aria-label="Lock terminal" onClick={onLockClick} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container text-primary">
              <MaterialIcon name="lock" />
            </button>
          )}
          {user && (
            <button
              ref={notificationButtonRef}
              type="button"
              aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              aria-haspopup="dialog"
              aria-controls="notifications-popover"
              aria-expanded={notificationsOpen}
              onClick={openNotifications}
              className="relative flex h-8 w-8 items-center justify-center rounded-full bg-surface-container text-primary"
            >
              <MaterialIcon name="notifications" />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 font-body text-label-sm text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          )}
          <button
            ref={profileButtonRef}
            type="button"
            aria-label={t('common.profileSettings')}
            aria-haspopup="dialog"
            aria-controls="profile-popover"
            aria-expanded={profileOpen}
            onClick={openProfile}
            className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-surface p-0 shadow-card"
          >
            <ProfileAvatar avatarId={user?.avatarId} className="h-full w-full" />
          </button>
        </div>
      </div>
    </header>
    {notificationsOpen && createPortal(
      <div className="glass-modal-backdrop notification-popover-backdrop fixed inset-0 z-50 bg-primary-dark/30 backdrop-blur-[1px]" onMouseDown={() => setNotificationsOpen(false)}>
        <section
          id="notifications-popover"
          role="dialog"
          aria-modal="true"
          aria-label={t('nav.notifications')}
          style={{
            top: `${notificationPosition.top}px`,
            right: '8px',
            transformOrigin: `${notificationPosition.originX}px 0px`,
            maxHeight: `min(68dvh, calc(100dvh - ${notificationPosition.top}px - 1rem))`,
          }}
          className="glass-modal-panel notification-popover-panel fixed flex w-[min(22rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest p-3 shadow-overlay safe-bottom"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <h2 className="font-display text-title-md text-on-surface">{t('nav.notifications')}</h2>
            <div className="flex shrink-0 items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => { void markAllNotificationsRead(); }}
                  className="!min-h-0 !min-w-0 rounded-md px-2 py-1 font-body text-label-md text-primary hover:bg-primary-fixed"
                >
                  Read all
                </button>
              )}
              <Link
                to="/notifications"
                onClick={() => setNotificationsOpen(false)}
                className="!min-h-0 !min-w-0 rounded-md px-2 py-1 font-body text-label-md text-primary hover:bg-primary-fixed"
              >
                See all
              </Link>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setNotificationsOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container"
              >
                <MaterialIcon name="close" />
              </button>
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            <div className="flex flex-col gap-2">
              {notificationsError && <p role="alert" className="rounded-lg bg-error-container p-2 font-body text-body-sm text-on-error-container">{notificationsError}</p>}
              {notificationsLoading ? (
                <p role="status" className="py-3 text-center font-body text-body-sm text-on-surface-variant">Loading notifications…</p>
              ) : recentNotifications.length > 0 ? recentNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`flex min-w-0 items-center gap-1 rounded-lg border border-outline-variant/60 p-2 ${
                    notification.readAt ? 'bg-surface-container-low' : 'bg-primary-fixed/30'
                  }`}
                >
                  <button
                    type="button"
                    disabled={activeNotificationId === notification.id}
                    onClick={() => { void openNotification(notification); }}
                    aria-label={`Open notification: ${notification.title}`}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60"
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      notification.readAt ? 'bg-surface-container text-outline' : 'bg-primary-fixed text-primary'
                    }`}>
                      <MaterialIcon name="notifications" className="text-lg" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="block truncate font-body text-label-lg text-on-surface">{notification.title}</span>
                        {!notification.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                      </span>
                      <span className="block truncate font-body text-body-sm text-on-surface-variant">{notification.body}</span>
                      <span className="block truncate font-body text-body-sm text-outline">{new Date(notification.createdAt).toLocaleString()}</span>
                    </span>
                  </button>
                  {!notification.readAt && (
                    <button
                      type="button"
                      disabled={activeNotificationId === notification.id}
                      onClick={() => { void markNotificationRead(notification.id); }}
                      aria-label={`Mark notification as read: ${notification.title}`}
                      className="flex shrink-0 items-center gap-1 rounded-lg px-2 font-body text-label-md text-primary hover:bg-white/70 disabled:opacity-60"
                    >
                      <MaterialIcon name="done" className="text-base" />
                      <span>Mark as read</span>
                    </button>
                  )}
                </div>
              )) : (
                <p className="py-3 text-center font-body text-body-sm text-on-surface-variant">You’re all caught up.</p>
              )}
            </div>
          </div>
        </section>
      </div>,
      document.body,
    )}
    {profileOpen && user && createPortal(
      <div className="glass-modal-backdrop notification-popover-backdrop fixed inset-0 z-50 bg-primary-dark/30 backdrop-blur-[1px]" onMouseDown={() => setProfileOpen(false)}>
        <section
          id="profile-popover"
          role="dialog"
          aria-modal="true"
          aria-label={t('common.profileSettings')}
          style={{
            top: `${profilePosition}px`,
            right: '8px',
            maxHeight: `min(68dvh, calc(100dvh - ${profilePosition}px - 1rem))`,
          }}
          className="glass-modal-panel notification-popover-panel fixed flex w-[min(22rem,calc(100vw-1rem))] flex-col overflow-y-auto rounded-lg border border-outline-variant bg-surface-container-lowest p-3 shadow-overlay safe-bottom"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-primary">
                <ProfileAvatar avatarId={user.avatarId} className="h-full w-full rounded-full" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-body text-label-lg text-on-surface">{user.name}</span>
                <span className="block truncate font-body text-body-sm capitalize text-on-surface-variant">{user.role.replace('_', ' ')}</span>
              </span>
            </div>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={() => setProfileOpen(false)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-outline hover:bg-surface-container"
            >
              <MaterialIcon name="close" />
            </button>
          </div>
          <dl className="mb-3 grid grid-cols-1 gap-2 rounded-lg bg-surface-container-low p-3 font-body text-body-sm">
            {(user.email || user.username) && (
              <div className="min-w-0">
                <dt className="text-outline">{user.email ? 'Email' : 'Username'}</dt>
                <dd className="truncate text-on-surface">{user.email ?? user.username}</dd>
              </div>
            )}
            {user.phone && (
              <div>
                <dt className="text-outline">Phone</dt>
                <dd className="text-on-surface">{user.phone}</dd>
              </div>
            )}
            {displayedStoreName && (
              <div className="min-w-0">
                <dt className="text-outline">Store</dt>
                <dd className="truncate text-on-surface">{displayedStoreName}</dd>
              </div>
            )}
          </dl>
          <div className="mb-3">
            <p className="mb-2 font-body text-label-sm text-on-surface-variant">Choose your avatar</p>
            <div className="grid grid-cols-6 gap-2">
              {PROFILE_AVATARS.map((avatar) => (
                <button
                  key={avatar.id}
                  type="button"
                  disabled={savingAvatar || loggingOut}
                  aria-label={`Choose ${avatar.label} avatar`}
                  aria-pressed={(user.avatarId ?? DEFAULT_PROFILE_AVATAR_ID) === avatar.id}
                  onClick={() => { void handleAvatarChange(avatar.id); }}
                  className={`flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 p-0 transition disabled:opacity-60 ${
                    (user.avatarId ?? DEFAULT_PROFILE_AVATAR_ID) === avatar.id
                      ? 'border-primary ring-2 ring-primary/20'
                      : 'border-transparent hover:border-outline-variant'
                  }`}
                >
                  <ProfileAvatar avatarId={avatar.id} className="h-full w-full" />
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={loggingOut || savingAvatar}
              onClick={() => {
                setProfileOpen(false);
                if (onProfileClick) onProfileClick();
                else navigate(user.role === 'staff' ? '/profile' : '/settings');
              }}
              className="flex min-h-11 items-center gap-3 rounded-lg bg-surface-container-low px-3 text-left font-body text-label-md text-on-surface hover:bg-surface-container disabled:opacity-60"
            >
              <MaterialIcon name="manage_accounts" className="text-primary" />
              {t('common.profileSettings')}
            </button>
            {onLockClick && (
              <button
                type="button"
                disabled={loggingOut}
                onClick={() => {
                  setProfileOpen(false);
                  onLockClick();
                }}
                className="flex min-h-11 items-center gap-3 rounded-lg bg-surface-container-low px-3 text-left font-body text-label-md text-on-surface hover:bg-surface-container disabled:opacity-60"
              >
                <MaterialIcon name="lock" className="text-primary" />
                Lock terminal
              </button>
            )}
            {profileError && <p role="alert" className="rounded-lg bg-error-container p-2 font-body text-body-sm text-on-error-container">{profileError}</p>}
            <button
              type="button"
              disabled={loggingOut}
              onClick={() => { void handleLogout(); }}
              className="flex min-h-11 items-center gap-3 rounded-lg bg-error-container px-3 text-left font-body text-label-md text-on-error-container hover:opacity-90 disabled:opacity-60"
            >
              <MaterialIcon name={loggingOut ? 'sync' : 'logout'} className={loggingOut ? 'animate-spin' : ''} />
              {loggingOut ? 'Signing out…' : t('app.logOut')}
            </button>
          </div>
        </section>
      </div>,
      document.body,
    )}
    </>
  );
}
