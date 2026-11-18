import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LoginScreen } from './screens/LoginScreen';
import { SetNewPasswordScreen } from './screens/SetNewPasswordScreen';
import { PosScreen } from './screens/PosScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { ShiftScreen } from './screens/ShiftScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { updateService } from './services/updateService';
import { UpdateBanner } from './components/UpdateBanner';
import { StoreReadOnlyScreen } from './screens/StoreReadOnlyScreen';
import { useAuthStore } from './stores/authStore';
import { userService } from './services/userService';
import type { UserRole } from './types/domain';
import { Button } from './components/Button';
import { MaterialIcon } from './components/MaterialIcon';
import { t } from './i18n/translations';
import { StaffDashboardScreen } from './screens/StaffDashboardScreen';

const OwnerDashboardScreen = lazy(() => import('./screens/OwnerDashboardScreen').then((module) => ({ default: module.OwnerDashboardScreen })));
const OwnerCatalogScreen = lazy(() => import('./screens/OwnerCatalogScreen').then((module) => ({ default: module.OwnerCatalogScreen })));
const OwnerStaffScreen = lazy(() => import('./screens/OwnerStaffScreen').then((module) => ({ default: module.OwnerStaffScreen })));
const OwnerVoidRequestsScreen = lazy(() => import('./screens/OwnerVoidRequestsScreen').then((module) => ({ default: module.OwnerVoidRequestsScreen })));
const OwnerReportsScreen = lazy(() => import('./screens/OwnerReportsScreen').then((module) => ({ default: module.OwnerReportsScreen })));
const OwnerInventoryScreen = lazy(() => import('./screens/OwnerInventoryScreen').then((module) => ({ default: module.OwnerInventoryScreen })));
const CustomersScreen = lazy(() => import('./screens/CustomersScreen').then((module) => ({ default: module.CustomersScreen })));
const SuperAdminStoresScreen = lazy(() => import('./screens/SuperAdminStoresScreen').then((module) => ({ default: module.SuperAdminStoresScreen })));

function homeForRole(role: UserRole): string {
  if (role === 'staff') return '/dashboard';
  return role === 'owner' ? '/owner/dashboard' : '/admin/stores';
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
  if (!user) return <LoginScreen />;
  return <Navigate to={user.mustChangePassword ? '/set-password' : homeForRole(user.role)} replace />;
}

function SetPasswordRoute() {
  const user = useAuthStore((state) => state.user);
  if (!user) return <Navigate to="/" replace />;
  if (!user.mustChangePassword) return <Navigate to={homeForRole(user.role)} replace />;
  return <SetNewPasswordScreen />;
}

interface ProtectedRouteProps {
  roles: UserRole[];
  children: ReactNode;
  permission?: string | string[];
}

function ProtectedRoute({ roles, children, permission }: ProtectedRouteProps) {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const [permissionAllowed, setPermissionAllowed] = useState<boolean | null>(null);
  const permissionKey = Array.isArray(permission) ? permission.join('|') : permission ?? '';

  useEffect(() => {
    if (!permissionKey || user?.role !== 'staff') return;
    let active = true;
    void Promise.all(permissionKey.split('|').map((permissionId) => userService.hasPermission(user.id, permissionId))).then((results) => {
      if (active) setPermissionAllowed(results.some(Boolean));
    }).catch((error: unknown) => {
      console.error('Could not verify staff permission.', error);
      if (active) setPermissionAllowed(false);
    });
    return () => { active = false; };
  }, [permissionKey, user]);

  if (!user) return <Navigate to="/" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword) return <Navigate to="/set-password" replace />;
  if (!roles.includes(user.role)) return <Navigate to={homeForRole(user.role)} replace />;
  if (permission && user.role === 'staff' && permissionAllowed === null) return <LoadingScreen message={t('app.loading')} />;
  if (permission && user.role === 'staff' && !permissionAllowed) return <AccessDenied />;

  return children;
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
  const initializationError = useAuthStore((state) => state.initializationError);
  const hydrate = useAuthStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    let stopMonitoring: () => void = () => undefined;
    let active = true;
    void updateService.register().then(() => {
      if (active) stopMonitoring = updateService.startMonitoring();
    }).catch((error: unknown) => {
      console.error('Could not register the application service worker.', error);
      if (active) stopMonitoring = updateService.startMonitoring();
    });
    return () => {
      active = false;
      stopMonitoring();
    };
  }, []);

  if (!ready) return <LoadingScreen message="Preparing your terminal..." />;
  if (initializationError) return <LoadingScreen message={`Could not load local data: ${initializationError}`} />;

  return (
    <>
      <UpdateBanner />
      <Suspense fallback={<LoadingScreen message={t('app.loading')} />}>
        <Routes>
          <Route path="/" element={<GuestRoute />} />
          <Route path="/set-password" element={<SetPasswordRoute />} />
          <Route path="/dashboard" element={<ProtectedRoute roles={['staff']}><StaffDashboardScreen /></ProtectedRoute>} />
          <Route path="/pos" element={<ProtectedRoute roles={['staff']} permission="take_orders"><PosScreen /></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute roles={['staff', 'owner']} permission="view_order_history"><OrdersScreen /></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute roles={['staff', 'owner']} permission={['use_tabs', 'settle_tabs']}><CustomersScreen /></ProtectedRoute>} />
          <Route path="/shift" element={<ProtectedRoute roles={['staff']} permission="open_close_shift"><ShiftScreen /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute roles={['staff', 'owner', 'super_admin']}><SettingsScreen /></ProtectedRoute>} />
          <Route path="/owner" element={<Navigate to="/owner/dashboard" replace />} />
          <Route path="/owner/dashboard" element={<ProtectedRoute roles={['owner']}><OwnerDashboardScreen /></ProtectedRoute>} />
          <Route path="/owner/catalog" element={<ProtectedRoute roles={['owner']}><OwnerCatalogScreen /></ProtectedRoute>} />
          <Route path="/owner/staff" element={<ProtectedRoute roles={['owner']}><OwnerStaffScreen /></ProtectedRoute>} />
          <Route path="/owner/voids" element={<ProtectedRoute roles={['owner']}><OwnerVoidRequestsScreen /></ProtectedRoute>} />
          <Route path="/owner/shifts" element={<ProtectedRoute roles={['owner']}><ShiftScreen ownerMode /></ProtectedRoute>} />
          <Route path="/owner/reports" element={<ProtectedRoute roles={['owner']}><OwnerReportsScreen /></ProtectedRoute>} />
          <Route path="/owner/inventory" element={<ProtectedRoute roles={['owner']}><OwnerInventoryScreen /></ProtectedRoute>} />
          <Route path="/owner/settings" element={<ProtectedRoute roles={['owner']}><SettingsScreen /></ProtectedRoute>} />
          <Route path="/owner/*" element={<ProtectedRoute roles={['owner']}><RolePlaceholder title="Owner workspace" /></ProtectedRoute>} />
          <Route path="/admin" element={<Navigate to="/admin/stores" replace />} />
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
