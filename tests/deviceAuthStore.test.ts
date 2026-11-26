import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authGetCurrentUser: vi.fn(),
  authGetCachedUserDisplay: vi.fn(() => null),
  authIsSessionLocked: vi.fn(),
  authLockDeviceStaffSession: vi.fn(),
  authLogout: vi.fn(),
  deviceLogin: vi.fn(),
  deviceStaffLogin: vi.fn(),
  deviceChangePassword: vi.fn(),
  deviceLogout: vi.fn(),
  deviceGetCurrent: vi.fn(),
  getEffectivePermissions: vi.fn(),
  signOut: vi.fn(),
  clearOrder: vi.fn(),
}));

vi.mock('../src/services/authService', () => ({
  authService: {
    getCurrentUser: mocks.authGetCurrentUser,
    getCachedUserDisplay: mocks.authGetCachedUserDisplay,
    isSessionLocked: mocks.authIsSessionLocked,
    lockDeviceStaffSession: mocks.authLockDeviceStaffSession,
    logout: mocks.authLogout,
  },
}));
vi.mock('../src/services/deviceService', () => ({
  deviceService: {
    loginDevice: mocks.deviceLogin,
    loginStaffWithPin: mocks.deviceStaffLogin,
    changeDevicePassword: mocks.deviceChangePassword,
    logoutDevice: mocks.deviceLogout,
    getCurrentDevice: mocks.deviceGetCurrent,
  },
}));
vi.mock('../src/services/userService', () => ({
  userService: { getEffectivePermissions: mocks.getEffectivePermissions },
}));
vi.mock('../src/services/mockDataService', () => ({ initializeMockData: vi.fn() }));
vi.mock('../src/services/schemaVersionService', () => ({ assertExpectedSchemaVersion: vi.fn() }));
vi.mock('../src/data/driver', () => ({ isSupabaseDriver: () => false }));
vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: () => ({ auth: { signOut: mocks.signOut } }),
}));
vi.mock('../src/stores/cartStore', () => ({
  useCartStore: { getState: () => ({ clearOrder: mocks.clearOrder }) },
}));
vi.mock('../src/lib/storeAppearance', () => ({ resetStoreAppearance: vi.fn() }));

import { useAuthStore } from '../src/stores/authStore';
import type { UserSummary } from '../src/types/domain';

const device = {
  id: 'terminal-1',
  storeId: 'store-1',
  name: 'Front counter',
  username: 'd-a1b2c3d4',
  mustChangePassword: false,
};

const staff = {
  id: 'staff-1',
  storeId: 'store-1',
  role: 'staff',
  name: 'Sam',
  mustChangePassword: false,
  mustSetPin: false,
  isActive: true,
} satisfies UserSummary;

describe('shared device authentication state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      device: null,
      cachedUserDisplay: null,
      permissions: [],
      permissionsReady: true,
      locked: false,
      ready: true,
      initializationError: null,
    });
    mocks.deviceLogin.mockResolvedValue(device);
    mocks.deviceStaffLogin.mockResolvedValue(undefined);
    mocks.deviceChangePassword.mockResolvedValue(undefined);
    mocks.deviceLogout.mockResolvedValue(undefined);
    mocks.authGetCurrentUser.mockResolvedValue(staff);
    mocks.getEffectivePermissions.mockResolvedValue(['take_orders']);
    mocks.authLockDeviceStaffSession.mockResolvedValue(undefined);
    mocks.authLogout.mockResolvedValue(undefined);
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it('keeps the employee role, store identity, and permissions after device PIN sign-in', async () => {
    await useAuthStore.getState().loginDevice(device.username, 'temporary-password');
    const signedInStaff = await useAuthStore.getState().loginStaffWithDevicePin('4826');

    expect(signedInStaff).toMatchObject({ id: staff.id, role: 'staff', storeId: device.storeId });
    expect(useAuthStore.getState()).toMatchObject({
      user: { id: staff.id, role: 'staff', storeId: device.storeId },
      device: { id: device.id, storeId: device.storeId },
      locked: false,
      permissions: ['take_orders'],
    });
  });

  it('rejects a staff session from a different store instead of switching terminal identity', async () => {
    await useAuthStore.getState().loginDevice(device.username, 'temporary-password');
    mocks.authGetCurrentUser.mockResolvedValue({ ...staff, storeId: 'another-store' });

    await expect(useAuthStore.getState().loginStaffWithDevicePin('4826'))
      .rejects.toThrow('The staff account could not be matched to this store device.');
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().device?.id).toBe(device.id);
  });

  it('locks by revoking the employee session while retaining device authentication', async () => {
    useAuthStore.setState({ user: staff, device, locked: false });

    await useAuthStore.getState().lock();

    expect(mocks.authLockDeviceStaffSession).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      device,
      locked: true,
      permissions: [],
    });
    expect(mocks.clearOrder).toHaveBeenCalledOnce();
  });

  it('ends both device and employee state on explicit device logout', async () => {
    useAuthStore.setState({ user: staff, device, locked: false });

    await useAuthStore.getState().logoutDevice();

    expect(mocks.authLogout).toHaveBeenCalledOnce();
    expect(mocks.deviceLogout).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({ user: null, device: null, locked: false });
  });
});
