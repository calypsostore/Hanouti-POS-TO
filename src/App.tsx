import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LoginScreen } from './screens/LoginScreen';
import type { UpdateCheckResult } from './services/updateService';
import { UpdateRequiredModal } from './components/UpdateRequiredModal';
import { useAuthStore } from './stores/authStore';
import { PERMISSIONS_CHANGED_EVENT, STORE_AUTO_LOCK_CHANGED_EVENT } from './services/userEvents';
import type { UserRole } from './types/domain';
import { Button } from './components/Button';
import { MaterialIcon } from './components/MaterialIcon';
import { t } from './i18n/translations';
import { getLanguage, subscribeToLanguage } from './i18n';
import { classifyInitializationError } from './services/serverErrorService';
import { PullToRefresh } from './components/PullToRefresh';
import { ActionFeedbackToast } from './components/ActionFeedbackToast';
import { useOverlayLifecycle, useOverlayTarget } from './components/overlay/overlayArchitecture';
import { subscribeToStoreChanges } from './data/repositories/realtimeRepository';
import { applyStoreAppearance, resetStoreAppearance } from './lib/storeAppearance';
import { resolveStoreSettings } from './types/domain';

const SetNewPasswordScreen = lazy(() => import('./screens/SetNewPasswordScreen').then((module) => ({ default: module.SetNewPasswordScreen })));
const LockScreen = lazy(() => import('./components/LockScreen').then((module) => ({ default: module.LockScreen })));
const PermissionsPrompt = lazy(() => import('./components/PermissionsPrompt').then((module) => ({ default: module.PermissionsPrompt })));
const NotificationsBridge = lazy(() => import('./components/NotificationsBridge').then((module) => ({ default: module.NotificationsBridge })));
const PosScreen = lazy(() => import('./screens/PosScreen').then((module) => ({ default: module.PosScreen })));
const OrdersScreen = lazy(() => import('./screens/OrdersScreen').then((module) => ({ default: module.OrdersScreen })));
const ShiftScreen = lazy(() => import('./screens/ShiftScreen').then((module) => ({ default: module.ShiftScreen })));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen').then((module) => ({ default: module.SettingsScreen })));
const StoreReadOnlyScreen = lazy(() => import('./screens/StoreReadOnlyScreen').then((module) => ({ default: module.StoreReadOnlyScreen })));
const StaffDashboardScreen = lazy(() => import('./screens/StaffDashboardScreen').then((module) => ({ default: module.StaffDashboardScreen })));
const StaffProfileScreen = lazy(() => import('./screens/StaffProfileScreen').then((module) => ({ default: module.StaffProfileScreen })));
const OwnerDashboardScreen = lazy(() => import('./screens/OwnerDashboardScreen').then((module) => ({ default: module.OwnerDashboardScreen })));
const OwnerCatalogScreen = lazy(() => import('./screens/OwnerCatalogScreen').then((module) => ({ default: module.OwnerCatalogScreen })));
const OwnerStaffScreen = lazy(() => import('./screens/OwnerStaffScreen').then((module) => ({ default: module.OwnerStaffScreen })));
const OwnerStaffProfileScreen = lazy(() => import('./screens/OwnerStaffProfileScreen').then((module) => ({ default: module.OwnerStaffProfileScreen })));
const OwnerScheduleScreen = lazy(() => import('./screens/OwnerScheduleScreen').then((module) => ({ default: module.OwnerScheduleScreen })));
const OwnerVoidRequestsScreen = lazy(() => import('./screens/OwnerVoidRequestsScreen').then((module) => ({ default: module.OwnerVoidRequestsScreen })));
const OwnerReportsScreen = lazy(() => import('./screens/OwnerReportsScreen').then((module) => ({ default: module.OwnerReportsScreen })));
const OwnerInventoryScreen = lazy(() => import('./screens/OwnerInventoryScreen').then((module) => ({ default: module.OwnerInventoryScreen })));
const OwnerWasteScreen = lazy(() => import('./screens/OwnerWasteScreen').then((module) => ({ default: module.OwnerWasteScreen })));
const OwnerExpensesScreen = lazy(() => import('./screens/OwnerFinancialScreens').then((module) => ({ default: module.OwnerExpensesScreen })));
const OwnerSuppliersScreen = lazy(() => import('./screens/OwnerFinancialScreens').then((module) => ({ default: module.OwnerSuppliersScreen })));
const OwnerActivityLogScreen = lazy(() => import('./screens/OwnerUtilityScreens').then((module) => ({ default: module.OwnerActivityLogScreen })));
const NotificationsScreen = lazy(() => import('./screens/NotificationsScreen').then((module) => ({ default: module.NotificationsScreen })));
const CustomersScreen = lazy(() => import('./screens/CustomersScreen').then((module) => ({ default: module.CustomersScreen })));
const SuperAdminStoresScreen = lazy(() => import('./screens/SuperAdminStoresScreen').then((module) => ({ default: module.SuperAdminStoresScreen })));
const SuperAdminOverviewScreen = lazy(() => import('./screens/SuperAdminStoresScreen').then((module) => ({ default: module.SuperAdminOverviewScreen })));

const loadUpdateService = () => import('./services/updateService');

function useLanguageRefresh(): void {
  useSyncExternalStore(subscribeToLanguage, getLanguage);
}

function homeForRole(role: UserRole): string {
  if (role === 'staff') return '/dashboard';
  return role === 'owner' ? '/owner/dashboard' : '/admin/overview';
}

function LoadingScreen({ message, cachedUserName }: { message: string; cachedUserName?: string }) {
  return (
    <main className="login-main loading-screen">
      <div className="login-decoration login-decoration--northwest" aria-hidden="true" />
      <div className="login-decoration login-decoration--northeast" aria-hidden="true" />
      <div className="login-decoration login-decoration--southeast" aria-hidden="true" />
      <div className="login-decoration login-decoration--southwest" aria-hidden="true" />
      <span className="login-bubble login-bubble--one" aria-hidden="true" />
      <span className="login-bubble login-bubble--two" aria-hidden="true" />
      <span className="login-bubble login-bubble--three" aria-hidden="true" />

      <div className="login-content">
        <header className="login-brand">
          <div className="login-logo-orbit">
            <div className="login-logo-frame loading-logo">
              <img src="/logo2.png" alt="" />
            </div>
          </div>
          <h1 className="login-title">7anouti<span>-POS</span></h1>
          <p className="login-tagline" role="status" aria-live="polite">{message}</p>
          {cachedUserName && <p className="login-tagline">Welcome back, {cachedUserName}</p>}
        </header>
      </div>
    </main>
  );
}

function InitializationErrorScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const kind = classifyInitializationError(error);
  const message = kind === 'schema-behind'
    ? t('app.serverUpdating')
    : kind === 'schema-out-of-date'
      ? t('app.serverSetupOutOfDate')
      : kind === 'network'
        ? t('app.serverUnreachable')
        : t('app.initializationError', { error: error.message });

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-6 text-center">
      <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-8 shadow-card">
        <MaterialIcon name="error_outline" className="text-5xl text-error" />
        <h1 className="mt-3 font-display text-headline-lg text-on-surface">{t('app.startupErrorTitle')}</h1>
        <p role="alert" className="mt-2 font-body text-body-md text-on-surface-variant">{message}</p>
        <Button onClick={onRetry} className="mt-5">{t('app.retry')}</Button>
      </div>
    </main>
  );
}

function GuestRoute() {
  const user = useAuthStore((state) => state.user);
  const locked = useAuthStore((state) => state.locked);
  if (!user) return <LoginScreen />;
  if (locked) return <Navigate to="/lock" replace state={{ from: location.pathname }} />;
  return <Navigate to={user.mustChangePassword || user.mustSetPin || user.mustSetVoidPin ? '/set-password' : homeForRole(user.role)} replace />;
}

function SetPasswordRoute() {
  const user = useAuthStore((state) => state.user);
  const [setupActive, setSetupActive] = useState(Boolean(user?.mustChangePassword || user?.mustSetPin || user?.mustSetVoidPin));
  if (!user) return <Navigate to="/" replace />;
  if (!user.mustChangePassword && !user.mustSetPin && !user.mustSetVoidPin && !setupActive) return <Navigate to={homeForRole(user.role)} replace />;
  return <SetNewPasswordScreen onSetupComplete={() => setSetupActive(false)} />;
}

interface ProtectedRouteProps {
  roles: UserRole[];
  children: ReactNode;
  permission?: string | string[];
}

function ProtectedRoute({ roles, children, permission }: ProtectedRouteProps) {
  const user = useAuthStore((state) => state.user);
  const permissions = useAuthStore((state) => state.permissions);
  const permissionsReady = useAuthStore((state) => state.permissionsReady);
  const refreshPermissions = useAuthStore((state) => state.refreshPermissions);
  const locked = useAuthStore((state) => state.locked);
  const location = useLocation();
  const permissionKey = Array.isArray(permission) ? permission.join('|') : permission ?? '';

  useEffect(() => {
    if (!permissionKey || user?.role !== 'staff') return;
    const checkPermission = () => { void refreshPermissions(); };
    window.addEventListener('focus', checkPermission);
    window.addEventListener(PERMISSIONS_CHANGED_EVENT, checkPermission);
    return () => {
      window.removeEventListener('focus', checkPermission);
      window.removeEventListener(PERMISSIONS_CHANGED_EVENT, checkPermission);
    };
  }, [permissionKey, refreshPermissions, user?.id, user?.role]);

  if (!user) return <Navigate to="/" replace state={{ from: location.pathname }} />;
  if (locked) return <Navigate to="/lock" replace />;
  if (user.mustChangePassword || user.mustSetPin || user.mustSetVoidPin) return <Navigate to="/set-password" replace />;
  if (!roles.includes(user.role)) return <Navigate to={homeForRole(user.role)} replace />;
  const permissionAllowed = permissionKey.split('|').some((permissionId) => permissions.includes(permissionId));
  if (permission && user.role === 'staff' && !permissionsReady) return <LoadingScreen message={t('app.loading')} />;
  if (permission && user.role === 'staff' && !permissionAllowed) return <AccessDenied />;

  return children;
}

function LockRoute() {
  const user = useAuthStore((state) => state.user);
  const locked = useAuthStore((state) => state.locked);
  const location = useLocation();
  if (!user) return <Navigate to="/" replace />;
  if (user.mustChangePassword || user.mustSetPin || user.mustSetVoidPin) return <Navigate to="/set-password" replace />;
  if (user.role !== 'staff' && user.role !== 'owner') return <Navigate to={homeForRole(user.role)} replace />;
  if (!locked) return <Navigate to={homeForRole(user.role)} replace />;
  const stateFrom = typeof location.state === 'object' && location.state !== null && 'from' in location.state
    ? location.state.from
    : undefined;
  const returnTo = typeof stateFrom === 'string' && stateFrom.startsWith('/') && !stateFrom.startsWith('//') && stateFrom !== '/lock'
    ? stateFrom
    : homeForRole(user.role);
  return <LockScreen returnTo={returnTo} />;
}

function AccessDenied() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-6 text-center">
      <div className="max-w-sm rounded-2xl bg-surface-container-lowest p-6 shadow-card">
        <MaterialIcon name="lock" className="text-4xl text-error-dark" />
        <h1 className="mt-2 font-display text-headline-md text-on-surface">Access not available</h1>
        <p className="mt-2 font-body text-body-md text-on-surface-variant">Your assigned position does not allow this action.</p>
      </div>
    </main>
  );
}

function RolePlaceholder({ title }: { title: string }) {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface p-6 text-center">
      <div className="rounded-2xl bg-surface-container-lowest p-8 shadow-card">
        <MaterialIcon name="construction" className="text-5xl text-primary" />
        <h1 className="mt-3 font-display text-headline-lg text-on-surface">{title}</h1>
        <p className="mt-2 font-body text-body-md text-on-surface-variant">Signed in as {user?.name}. This workspace is being prepared.</p>
        <Button onClick={logout} className="mt-5">
          <MaterialIcon name="logout" className="text-lg" />
          Log out
        </Button>
      </div>
    </main>
  );
}

export default function App() {
  useLanguageRefresh();
  const ready = useAuthStore((state) => state.ready);
  const user = useAuthStore((state) => state.user);
  const cachedUserDisplay = useAuthStore((state) => state.cachedUserDisplay);
  const locked = useAuthStore((state) => state.locked);
  const initializationError = useAuthStore((state) => state.initializationError);
  const hydrate = useAuthStore((state) => state.hydrate);
  const [storeAppearanceError, setStoreAppearanceError] = useState<Error | null>(null);
  const [updateReloadError, setUpdateReloadError] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const portalTarget = useOverlayTarget();
  const updateBannerZIndex = useOverlayLifecycle({
    open: Boolean(updateReloadError),
    kind: 'toast',
    lockScroll: false,
    trapFocus: false,
    restoreFocus: false,
  });

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => {};
    void loadUpdateService().then(({ updateService }) => {
      if (!active) return;
      setUpdateReloadError(updateService.getPostUpdateMessage());
      setUpdateResult(updateService.getLastResult());
      unsubscribe = updateService.subscribeResults(setUpdateResult);
    }).catch((error: unknown) => {
      console.error('[updates] Could not load update status.', error);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!ready || !user?.storeId) {
      resetStoreAppearance();
      setStoreAppearanceError(null);
      return;
    }

    let active = true;
    const refreshAppearance = () => {
      void import('./services/userService').then(({ userService }) => userService.getStore(user.storeId!)).then((store) => {
        if (!active) return;
        if (!store) throw new Error('The active store could not be found.');
        applyStoreAppearance(resolveStoreSettings(store.settings).appearance);
        setStoreAppearanceError(null);
      }).catch((error: unknown) => {
        if (!active) return;
        const normalizedError = error instanceof Error ? error : new Error('Unable to load the store theme.', { cause: error });
        console.error('[theme] Could not load the store appearance.', normalizedError);
        setStoreAppearanceError(normalizedError);
      });
    };

    const stopRealtime = subscribeToStoreChanges(user.storeId, ['store_settings'], refreshAppearance);
    window.addEventListener('hanouti:store-settings-updated', refreshAppearance);
    refreshAppearance();
    return () => {
      active = false;
      stopRealtime();
      window.removeEventListener('hanouti:store-settings-updated', refreshAppearance);
    };
  }, [ready, user?.id, user?.storeId]);

  useEffect(() => {
    if (!ready) return;
    void import('./services/permissionService').then(({ permissionService }) =>
      permissionService.createDefaultChannel(),
    ).catch((error: unknown) => {
      console.error('[permissions] Could not create the default notification channel.', error);
    });
  }, [ready]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key?.endsWith(':users') || event.key?.endsWith(':auth-session')) {
        void useAuthStore.getState().refreshCurrentUser();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let checking = false;
    const revalidateSession = () => {
      if (checking) return;
      checking = true;
      void useAuthStore.getState().refreshCurrentUser().finally(() => {
        checking = false;
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') revalidateSession();
    };
    window.addEventListener('focus', revalidateSession);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', revalidateSession);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [ready]);

  useEffect(() => {
    if (!ready || user?.role !== 'owner' || !user.storeId) return;
    let active = true;
    const storeId = user.storeId;
    const userId = user.id;
    void import('./services/notificationService').then(({ notificationService }) => {
      if (!active) return;
      void notificationService.checkOverdueCustomers(storeId, userId).catch((error: unknown) => {
        console.error('[customers] Overdue check on owner sign-in failed.', error);
      });
      void notificationService.checkSubscriptionExpiring(storeId).catch((error: unknown) => {
        console.error('[subscription] Expiry notification check failed.', error);
      });
    }).catch((error: unknown) => {
      if (active) console.error('[notifications] Could not load owner notification checks.', error);
    });
    return () => { active = false; };
  }, [ready, user?.id, user?.role, user?.storeId]);

  useEffect(() => {
    if (!ready || locked || (user?.role !== 'staff' && user?.role !== 'owner') || user.mustChangePassword || user.mustSetPin || user.mustSetVoidPin || !user.storeId) return;
    let active = true;
    let timeoutId = 0;
    let timeoutMs = (user.role === 'staff' ? 5 : 0) * 60_000;
    let lastActivityAt = Date.now();
    const storeId = user.storeId;

    const scheduleLock = () => {
      window.clearTimeout(timeoutId);
      if (timeoutMs <= 0) return;
      const remaining = Math.max(0, timeoutMs - (Date.now() - lastActivityAt));
      timeoutId = window.setTimeout(() => {
        if (!active) return;
        if (Date.now() - lastActivityAt < timeoutMs) {
          scheduleLock();
          return;
        }
        void useAuthStore.getState().lock().catch((error: unknown) => {
          console.error('Unable to lock the inactive staff session.', error);
        });
      }, remaining);
    };
    const noteActivity = () => {
      lastActivityAt = Date.now();
      scheduleLock();
    };
    const checkForIdleLock = () => {
      if (timeoutMs <= 0) return;
      if (Date.now() - lastActivityAt >= timeoutMs) {
        void useAuthStore.getState().lock().catch((error: unknown) => {
          console.error('Unable to lock the inactive staff session.', error);
        });
      }
    };
    const checkVisibility = () => {
      if (document.visibilityState === 'visible') checkForIdleLock();
    };
    const loadAutoLockTimeout = () => {
      void import('./services/userService').then(({ userService }) => userService.getStore(storeId)).then((store) => {
        if (!active) return;
        const minutes = user.role === 'staff'
          ? store?.staffAutoLockMinutes ?? 5
          : store?.ownerAutoLockMinutes ?? 0;
        timeoutMs = minutes * 60_000;
        scheduleLock();
      }).catch((error: unknown) => {
        console.error(`Unable to load the ${user.role} auto-lock timeout; using the default.`, error);
      });
    };

    scheduleLock();
    document.addEventListener('pointerdown', noteActivity);
    document.addEventListener('pointermove', noteActivity);
    document.addEventListener('keydown', noteActivity);
    document.addEventListener('touchstart', noteActivity);
    document.addEventListener('visibilitychange', checkVisibility);
    window.addEventListener('focus', checkForIdleLock);
    window.addEventListener(STORE_AUTO_LOCK_CHANGED_EVENT, loadAutoLockTimeout);
    loadAutoLockTimeout();

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      document.removeEventListener('pointerdown', noteActivity);
      document.removeEventListener('pointermove', noteActivity);
      document.removeEventListener('keydown', noteActivity);
      document.removeEventListener('touchstart', noteActivity);
      document.removeEventListener('visibilitychange', checkVisibility);
      window.removeEventListener('focus', checkForIdleLock);
      window.removeEventListener(STORE_AUTO_LOCK_CHANGED_EVENT, loadAutoLockTimeout);
    };
  }, [ready, locked, user?.id, user?.mustChangePassword, user?.mustSetPin, user?.mustSetVoidPin, user?.role, user?.storeId]);

  useEffect(() => {
    if (!ready) return;
    let stopMonitoring: () => void = () => undefined;
    let active = true;
    const checkOverdueCustomers = async () => {
      const currentUser = useAuthStore.getState().user;
      if (currentUser?.role === 'owner' && currentUser.storeId) {
        try {
          const { notificationService } = await import('./services/notificationService');
          await Promise.all([
            notificationService.checkOverdueCustomers(currentUser.storeId, currentUser.id),
            notificationService.checkSubscriptionExpiring(currentUser.storeId),
          ]);
        } catch (error) {
          console.error('[notifications] Scheduled owner checks failed.', error);
        }
      }
    };
    void loadUpdateService().then(({ updateService }) => {
      if (!active) return;
      return updateService.register().then(() => {
        if (active) stopMonitoring = updateService.startMonitoring(checkOverdueCustomers);
      }).catch((error: unknown) => {
        console.error('Could not register the application service worker.', error);
        if (active) stopMonitoring = updateService.startMonitoring(checkOverdueCustomers);
      });
    }).catch((error: unknown) => {
      console.error('[updates] Could not load update monitoring.', error);
    });
    return () => {
      active = false;
      stopMonitoring();
    };
  }, [ready]);

  async function reloadWithAvailableUpdate() {
    setUpdateReloadError('');
    try {
      const { updateService } = await loadUpdateService();
      await updateService.applyUpdate();
    } catch (error) {
      setUpdateReloadError(error instanceof Error ? error.message : 'Unable to reload the update.');
    }
  }

  if (!ready) return <LoadingScreen message="Preparing your terminal..." cachedUserName={cachedUserDisplay?.name} />;
  if (initializationError) return <InitializationErrorScreen error={initializationError} onRetry={() => void hydrate()} />;

  return (
    <>
      <UpdateRequiredModal result={updateResult} />
      <ActionFeedbackToast />
      {storeAppearanceError && (
        <div role="alert" className="fixed inset-x-3 top-3 z-critical rounded-xl bg-error-container px-4 py-3 text-on-error-container shadow-overlay tablet:inset-x-auto tablet:right-4 tablet:max-w-lg">
          Could not load this store&apos;s theme settings. The default Hanouti Crystal Glass theme is active. {storeAppearanceError.message}
        </div>
      )}
      {updateReloadError && createPortal(
        <div role="status" className="fixed inset-x-0 top-0 flex items-center justify-between gap-3 bg-primary-dark px-4 py-3 text-white shadow-overlay" style={{ zIndex: updateBannerZIndex }}>
          <div>
            <p role="alert" className="font-body text-label-md">{updateReloadError}</p>
          </div>
          <Button variant="secondary" className="shrink-0" onClick={() => { void reloadWithAvailableUpdate(); }}>Retry update</Button>
        </div>,
        portalTarget,
      )}
      <Suspense fallback={null}>
        {user && <PermissionsPrompt />}
        {user && !locked && <NotificationsBridge />}
      </Suspense>
      <PullToRefresh enabled={Boolean(user && !locked && !user.mustChangePassword && !user.mustSetPin && !user.mustSetVoidPin)}>
        <Suspense fallback={<LoadingScreen message={t('app.loading')} />}>
          <Routes>
          <Route path="/" element={<GuestRoute />} />
          <Route path="/set-password" element={<SetPasswordRoute />} />
          <Route path="/lock" element={<LockRoute />} />
          <Route path="/dashboard" element={<ProtectedRoute roles={['staff']}><StaffDashboardScreen /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute roles={['staff']}><StaffProfileScreen /></ProtectedRoute>} />
          <Route path="/pos" element={<ProtectedRoute roles={['staff', 'owner']} permission="take_orders"><PosScreen /></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute roles={['staff', 'owner']} permission="view_order_history"><OrdersScreen /></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute roles={['staff', 'owner']} permission={['customers_view', 'use_tabs', 'settle_tabs']}><CustomersScreen /></ProtectedRoute>} />
          <Route path="/customers/:id" element={<ProtectedRoute roles={['staff', 'owner']} permission={['customers_view', 'use_tabs', 'settle_tabs']}><CustomersScreen /></ProtectedRoute>} />
          <Route path="/shift" element={<ProtectedRoute roles={['staff']} permission={['open_close_shift', 'print_x_report']}><ShiftScreen /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute roles={['staff', 'owner', 'super_admin']}><SettingsScreen /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute roles={['staff', 'owner', 'super_admin']}><NotificationsScreen /></ProtectedRoute>} />
          <Route path="/owner" element={<Navigate to="/owner/dashboard" replace />} />
          <Route path="/owner/dashboard" element={<ProtectedRoute roles={['owner']}><OwnerDashboardScreen /></ProtectedRoute>} />
          <Route path="/owner/catalog" element={<ProtectedRoute roles={['owner']}><OwnerCatalogScreen /></ProtectedRoute>} />
          <Route path="/owner/staff/:id" element={<ProtectedRoute roles={['owner']}><OwnerStaffProfileScreen /></ProtectedRoute>} />
          <Route path="/owner/staff" element={<ProtectedRoute roles={['owner']}><OwnerStaffScreen /></ProtectedRoute>} />
          <Route path="/owner/schedule" element={<ProtectedRoute roles={['owner']}><OwnerScheduleScreen /></ProtectedRoute>} />
          <Route path="/owner/voids" element={<ProtectedRoute roles={['owner']}><OwnerVoidRequestsScreen /></ProtectedRoute>} />
          <Route path="/owner/shifts" element={<ProtectedRoute roles={['owner']}><ShiftScreen ownerMode /></ProtectedRoute>} />
          <Route path="/owner/reports" element={<ProtectedRoute roles={['owner']}><OwnerReportsScreen /></ProtectedRoute>} />
          <Route path="/owner/inventory" element={<ProtectedRoute roles={['owner']}><OwnerInventoryScreen /></ProtectedRoute>} />
          <Route path="/owner/waste" element={<ProtectedRoute roles={['owner']}><OwnerWasteScreen /></ProtectedRoute>} />
          <Route path="/owner/expenses" element={<ProtectedRoute roles={['owner']}><OwnerExpensesScreen /></ProtectedRoute>} />
          <Route path="/owner/suppliers" element={<ProtectedRoute roles={['owner']}><OwnerSuppliersScreen /></ProtectedRoute>} />
          <Route path="/owner/activity" element={<ProtectedRoute roles={['owner']}><OwnerActivityLogScreen /></ProtectedRoute>} />
          <Route path="/owner/notifications" element={<Navigate to="/notifications" replace />} />
          <Route path="/owner/settings" element={<ProtectedRoute roles={['owner']}><SettingsScreen /></ProtectedRoute>} />
          <Route path="/owner/*" element={<ProtectedRoute roles={['owner']}><RolePlaceholder title="Owner workspace" /></ProtectedRoute>} />
          <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />
          <Route path="/admin/overview" element={<ProtectedRoute roles={['super_admin']}><SuperAdminOverviewScreen /></ProtectedRoute>} />
          <Route path="/admin/stores" element={<ProtectedRoute roles={['super_admin']}><SuperAdminStoresScreen /></ProtectedRoute>} />
          <Route path="/admin/stores/:storeId" element={<ProtectedRoute roles={['super_admin']}><StoreReadOnlyScreen /></ProtectedRoute>} />
          <Route path="/admin/settings" element={<ProtectedRoute roles={['super_admin']}><SettingsScreen /></ProtectedRoute>} />
          <Route path="/admin/*" element={<ProtectedRoute roles={['super_admin']}><RolePlaceholder title="Super Admin workspace" /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </PullToRefresh>
    </>
  );
}
