import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LoginScreen } from './screens/LoginScreen';
import { SetNewPasswordScreen } from './screens/SetNewPasswordScreen';
import { PosScreen } from './screens/PosScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { ShiftScreen } from './screens/ShiftScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { updateService } from './services/updateService';
import { notificationService } from './services/notificationService';
import { UpdateBanner } from './components/UpdateBanner';
import { StoreReadOnlyScreen } from './screens/StoreReadOnlyScreen';
import { useAuthStore } from './stores/authStore';
import { PERMISSIONS_CHANGED_EVENT, userService } from './services/userService';
import type { UserRole } from './types/domain';
import { Button } from './components/Button';
import { MaterialIcon } from './components/MaterialIcon';
import { t } from './i18n/translations';
import { StaffDashboardScreen } from './screens/StaffDashboardScreen';
import { StaffProfileScreen } from './screens/StaffProfileScreen';
import { LockScreen } from './components/LockScreen';

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

function homeForRole(role: UserRole): string {
  if (role === 'staff') return '/dashboard';
  return role === 'owner' ? '/owner/dashboard' : '/admin/overview';
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-6 text-center">
      <div>
        <MaterialIcon name="local_cafe" className="text-5xl text-primary" />
        <p className="mt-3 font-body text-body-md text-on-surface-variant">{message}</p>
      </div>
    </main>
  );
}

function GuestRoute() {
  const user = useAuthStore((state) => state.user);
  const locked = useAuthStore((state) => state.locked);
  if (!user) return <LoginScreen />;
  if (locked) return <Navigate to="/lock" replace state={{ from: location.pathname }} />;
  return <Navigate to={user.mustChangePassword ? '/set-password' : homeForRole(user.role)} replace />;
}

function SetPasswordRoute() {
  const user = useAuthStore((state) => state.user);
  const [setupActive, setSetupActive] = useState(Boolean(user?.mustChangePassword));
  if (!user) return <Navigate to="/" replace />;
  if (!user.mustChangePassword && !setupActive) return <Navigate to={homeForRole(user.role)} replace />;
  return <SetNewPasswordScreen onSetupComplete={() => setSetupActive(false)} />;
}

interface ProtectedRouteProps {
  roles: UserRole[];
  children: ReactNode;
  permission?: string | string[];
}

function ProtectedRoute({ roles, children, permission }: ProtectedRouteProps) {
  const user = useAuthStore((state) => state.user);
  const locked = useAuthStore((state) => state.locked);
  const location = useLocation();
  const [permissionAllowed, setPermissionAllowed] = useState<boolean | null>(null);
  const permissionKey = Array.isArray(permission) ? permission.join('|') : permission ?? '';

  useEffect(() => {
    if (!permissionKey || user?.role !== 'staff') return;
    let active = true;
    let requestId = 0;
    const checkPermission = () => {
      const currentRequestId = ++requestId;
      setPermissionAllowed(null);
      void Promise.all(permissionKey.split('|').map((permissionId) => userService.hasPermission(user.id, permissionId))).then((results) => {
        if (active && currentRequestId === requestId) setPermissionAllowed(results.some(Boolean));
      }).catch((error: unknown) => {
        console.error('Could not verify staff permission.', error);
        if (active && currentRequestId === requestId) setPermissionAllowed(false);
      });
    };
    checkPermission();
    window.addEventListener('focus', checkPermission);
    window.addEventListener(PERMISSIONS_CHANGED_EVENT, checkPermission);
    return () => {
      active = false;
      window.removeEventListener('focus', checkPermission);
      window.removeEventListener(PERMISSIONS_CHANGED_EVENT, checkPermission);
    };
  }, [permissionKey, user]);

  if (!user) return <Navigate to="/" replace state={{ from: location.pathname }} />;
  if (locked) return <Navigate to="/lock" replace />;
  if (user.mustChangePassword) return <Navigate to="/set-password" replace />;
  if (!roles.includes(user.role)) return <Navigate to={homeForRole(user.role)} replace />;
  if (permission && user.role === 'staff' && permissionAllowed === null) return <LoadingScreen message={t('app.loading')} />;
  if (permission && user.role === 'staff' && !permissionAllowed) return <AccessDenied />;

  return children;
}

function LockRoute() {
  const user = useAuthStore((state) => state.user);
  const locked = useAuthStore((state) => state.locked);
  const location = useLocation();
  if (!user) return <Navigate to="/" replace />;
  if (user.mustChangePassword) return <Navigate to="/set-password" replace />;
  if (user.role !== 'staff') return <Navigate to={homeForRole(user.role)} replace />;
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
  const ready = useAuthStore((state) => state.ready);
  const user = useAuthStore((state) => state.user);
  const locked = useAuthStore((state) => state.locked);
  const initializationError = useAuthStore((state) => state.initializationError);
  const hydrate = useAuthStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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
    if (!ready || user?.role !== 'owner' || !user.storeId) return;
    void notificationService.checkOverdueCustomers(user.storeId, user.id).catch((error: unknown) => {
      console.error('[customers] Overdue check on owner sign-in failed.', error);
    });
    void notificationService.checkSubscriptionExpiring(user.storeId).catch((error: unknown) => {
      console.error('[subscription] Expiry notification check failed.', error);
    });
  }, [ready, user?.id, user?.role, user?.storeId]);

  useEffect(() => {
    if (!ready || locked || user?.role !== 'staff' || user.mustChangePassword || !user.storeId) return;
    let active = true;
    let timeoutId = 0;
    let timeoutMs = 5 * 60_000;
    let lastActivityAt = Date.now();
    const storeId = user.storeId;

    const scheduleLock = () => {
      window.clearTimeout(timeoutId);
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
      if (Date.now() - lastActivityAt >= timeoutMs) {
        void useAuthStore.getState().lock().catch((error: unknown) => {
          console.error('Unable to lock the inactive staff session.', error);
        });
      }
    };
    const checkVisibility = () => {
      if (document.visibilityState === 'visible') checkForIdleLock();
    };

    scheduleLock();
    document.addEventListener('pointerdown', noteActivity);
    document.addEventListener('pointermove', noteActivity);
    document.addEventListener('keydown', noteActivity);
    document.addEventListener('touchstart', noteActivity);
    document.addEventListener('visibilitychange', checkVisibility);
    window.addEventListener('focus', checkForIdleLock);
    void userService.getStore(storeId).then((store) => {
      if (!active) return;
      timeoutMs = Math.max(1, store?.staffAutoLockMinutes ?? 5) * 60_000;
      scheduleLock();
    }).catch((error: unknown) => {
      console.error('Unable to load the staff auto-lock timeout; using 5 minutes.', error);
    });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      document.removeEventListener('pointerdown', noteActivity);
      document.removeEventListener('pointermove', noteActivity);
      document.removeEventListener('keydown', noteActivity);
      document.removeEventListener('touchstart', noteActivity);
      document.removeEventListener('visibilitychange', checkVisibility);
      window.removeEventListener('focus', checkForIdleLock);
    };
  }, [ready, locked, user?.id, user?.mustChangePassword, user?.role, user?.storeId]);

  useEffect(() => {
    if (!ready) return;
    let stopMonitoring: () => void = () => undefined;
    let active = true;
    const checkOverdueCustomers = async () => {
      const currentUser = useAuthStore.getState().user;
      if (currentUser?.role === 'owner' && currentUser.storeId) {
        await Promise.all([
          notificationService.checkOverdueCustomers(currentUser.storeId, currentUser.id),
          notificationService.checkSubscriptionExpiring(currentUser.storeId),
        ]);
      }
    };
    void updateService.register().then(() => {
      if (active) stopMonitoring = updateService.startMonitoring(checkOverdueCustomers);
    }).catch((error: unknown) => {
      console.error('Could not register the application service worker.', error);
      if (active) stopMonitoring = updateService.startMonitoring(checkOverdueCustomers);
    });
    return () => {
      active = false;
      stopMonitoring();
    };
  }, [ready]);

  if (!ready) return <LoadingScreen message="Preparing your terminal..." />;
  if (initializationError) return <LoadingScreen message={`Could not load local data: ${initializationError}`} />;

  return (
    <>
      <UpdateBanner />
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
          <Route path="/shift" element={<ProtectedRoute roles={['staff']} permission="open_close_shift"><ShiftScreen /></ProtectedRoute>} />
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
    </>
  );
}
