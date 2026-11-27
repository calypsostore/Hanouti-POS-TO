import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { MaterialIcon } from './MaterialIcon';
import { NotificationsPopoverButton } from './NotificationsPopoverButton';
import { ProfileAvatar } from './ProfileAvatar';
import { t } from '../i18n/translations';
import { useAuthStore } from '../stores/authStore';
import type { ProfileAvatarId, StoreType } from '../types/domain';
import { getLogoDefinition } from '../data/logoCatalog';
import { DEFAULT_PROFILE_AVATAR_ID, PROFILE_AVATARS } from '../data/profileAvatars';
import { useOverlayLifecycle, useOverlayTarget } from './overlay/overlayArchitecture';
import { localizeErrorMessage } from '../i18n';

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
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const device = useAuthStore((state) => state.device);
  const logout = useAuthStore((state) => state.logout);
  const lock = useAuthStore((state) => state.lock);
  const updateProfileAvatar = useAuthStore((state) => state.updateProfileAvatar);
  const canLockSession = user?.role === 'staff' || user?.role === 'owner';
  const deviceBoundSession = Boolean(device && user);
  const displayedStoreName = storeName?.trim() || t('common.appName');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profilePosition, setProfilePosition] = useState(64);
  const [profileError, setProfileError] = useState('');
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [locking, setLocking] = useState(false);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const profilePanelRef = useRef<HTMLElement>(null);
  const portalTarget = useOverlayTarget();
  const storeLogo = getLogoDefinition(storeLogoId ?? '');
  const updateProfilePosition = useCallback(() => {
    const buttonBounds = profileButtonRef.current?.getBoundingClientRect();
    if (buttonBounds) setProfilePosition(buttonBounds.bottom + 6);
  }, []);
  const closeProfileOnEscape = useCallback(() => setProfileOpen(false), []);
  const profileZIndex = useOverlayLifecycle({
    open: profileOpen,
    kind: 'popover',
    onEscape: closeProfileOnEscape,
    lockScroll: true,
    trapFocus: true,
    restoreFocus: true,
    containerRef: profilePanelRef,
  });

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
      setProfileError(localizeErrorMessage(error, t('profile.unableToLogOut')));
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleLock() {
    if (onLockClick) {
      onLockClick();
      return;
    }
    if (!canLockSession || locking) return;
    setProfileError('');
    setLocking(true);
    try {
      await lock();
      setProfileOpen(false);
      navigate(deviceBoundSession ? '/device-pin' : '/lock', { replace: true, state: { from: location.pathname } });
    } catch (lockError) {
      console.error('Unable to lock the shared-device session.', lockError);
      setProfileError(localizeErrorMessage(lockError, t('profile.unableToLockTerminal')));
      setProfileOpen(true);
    } finally {
      setLocking(false);
    }
  }

  async function handleAvatarChange(avatarId: ProfileAvatarId) {
    setProfileError('');
    setSavingAvatar(true);
    try {
      await updateProfileAvatar(avatarId);
    } catch (error) {
      console.error('Unable to update the profile avatar.', error);
      setProfileError(localizeErrorMessage(error, t('profile.unableToUpdateAvatar')));
    } finally {
      setSavingAvatar(false);
    }
  }

  useEffect(() => {
    if (!profileOpen) return;
    const updateProfileOnViewportChange = () => updateProfilePosition();
    window.addEventListener('resize', updateProfileOnViewportChange);
    window.addEventListener('scroll', updateProfileOnViewportChange, true);
    return () => {
      window.removeEventListener('resize', updateProfileOnViewportChange);
      window.removeEventListener('scroll', updateProfileOnViewportChange, true);
    };
  }, [profileOpen, updateProfilePosition]);

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
          {(onLockClick || canLockSession) && (
            <button type="button" aria-label={t('profile.lockTerminal')} disabled={locking} onClick={() => { void handleLock(); }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-60">
              <MaterialIcon name="lock" />
            </button>
          )}
          {user && (
            <NotificationsPopoverButton
              open={notificationsOpen}
              onOpenChange={(nextOpen) => {
                if (nextOpen) setProfileOpen(false);
                setNotificationsOpen(nextOpen);
              }}
              buttonClassName="relative flex h-8 w-8 items-center justify-center rounded-full bg-surface-container text-primary"
            />
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
    {profileOpen && user && createPortal(
      <div
        className="glass-modal-backdrop notification-popover-backdrop fixed inset-0 bg-primary-dark/30 backdrop-blur-[1px]"
        style={{ zIndex: profileZIndex }}
        onMouseDown={() => setProfileOpen(false)}
      >
        <section
          ref={profilePanelRef}
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
                <span className="block truncate font-body text-body-sm text-on-surface-variant">{t(user.role === 'owner' ? 'common.roleOwner' : user.role === 'staff' ? 'common.roleStaff' : 'common.roleSuperAdmin')}</span>
              </span>
            </div>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={() => setProfileOpen(false)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-outline"
            >
              <MaterialIcon name="close" />
            </button>
          </div>
          <dl className="mb-3 grid grid-cols-1 gap-2 rounded-lg bg-surface-container-low p-3 font-body text-body-sm">
            {(user.email || user.username) && (
              <div className="min-w-0">
                <dt className="text-outline">{user.email ? t('profile.email') : t('profile.username')}</dt>
                <dd className="truncate text-on-surface">{user.email ?? user.username}</dd>
              </div>
            )}
            {user.phone && (
              <div>
                <dt className="text-outline">{t('profile.phone')}</dt>
                <dd className="text-on-surface">{user.phone}</dd>
              </div>
            )}
            {displayedStoreName && (
              <div className="min-w-0">
                <dt className="text-outline">{t('profile.store')}</dt>
                <dd className="truncate text-on-surface">{displayedStoreName}</dd>
              </div>
            )}
          </dl>
          <div className="mb-3">
            <p className="mb-2 font-body text-label-sm text-on-surface-variant">{t('profile.chooseAvatar')}</p>
            <div className="grid grid-cols-6 gap-2">
              {PROFILE_AVATARS.map((avatar) => (
                <button
                  key={avatar.id}
                  type="button"
                  disabled={savingAvatar || loggingOut}
                  aria-label={t('profile.chooseAvatarLabel', { avatar: avatar.label })}
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
            {(onLockClick || canLockSession) && (
              <button
                type="button"
                disabled={loggingOut || locking}
                onClick={() => { void handleLock(); }}
                className="flex min-h-11 items-center gap-3 rounded-lg bg-red-600 px-3 text-left font-body text-label-md text-white hover:bg-red-700 disabled:opacity-60"
              >
                <MaterialIcon name={locking ? 'sync' : 'lock'} className={locking ? 'animate-spin' : ''} />
                {t('profile.lockTerminal')}
              </button>
            )}
            {profileError && <p role="alert" className="rounded-lg bg-error-container p-2 font-body text-body-sm text-on-error-container">{profileError}</p>}
            {!deviceBoundSession && (
              <button
                type="button"
                disabled={loggingOut}
                onClick={() => { void handleLogout(); }}
                className="flex min-h-11 items-center gap-3 rounded-lg bg-error-container px-3 text-left font-body text-label-md text-on-error-container hover:opacity-90 disabled:opacity-60"
              >
                <MaterialIcon name={loggingOut ? 'sync' : 'logout'} className={loggingOut ? 'animate-spin' : ''} />
                {loggingOut ? t('profile.signingOut') : t('app.logOut')}
              </button>
            )}
          </div>
        </section>
      </div>,
      portalTarget,
    )}
    </>
  );
}
