import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authGetCurrentUser: vi.fn(),
  authGetCachedUserDisplay: vi.fn(() => null),
  authIsSessionLocked: vi.fn(),
  authLockCurrentSession: vi.fn(),
  authLockDeviceSession: vi.fn(),
  authLogout: vi.fn(),
  deviceLogin: vi.fn(),
  devicePinLogin: vi.fn(),
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
    lockCurrentSession: mocks.authLockCurrentSession,
    lockDeviceSession: mocks.authLockDeviceSession,
    logout: mocks.authLogout,
  },
}));
vi.mock('../src/services/deviceService', () => ({
  deviceService: {
    loginDevice: mocks.deviceLogin,
    loginWithPin: mocks.devicePinLogin,
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

const owner = {
  ...staff,
  id: 'owner-1',
  role: 'owner',
  name: 'Mo',
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
    mocks.devicePinLogin.mockResolvedValue(undefined);
    mocks.deviceChangePassword.mockResolvedValue(undefined);
    mocks.deviceLogout.mockResolvedValue(undefined);
    mocks.authGetCurrentUser.mockResolvedValue(staff);
    mocks.getEffectivePermissions.mockResolvedValue(['take_orders']);
    mocks.authLockDeviceSession.mockResolvedValue(undefined);
    mocks.authLockCurrentSession.mockResolvedValue(undefined);
    mocks.authLogout.mockResolvedValue(undefined);
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it('keeps the employee role, store identity, and permissions after device PIN sign-in', async () => {
    await useAuthStore.getState().loginDevice(device.username, 'temporary-password');
    const signedInStaff = await useAuthStore.getState().loginWithDevicePin('4826');

    expect(signedInStaff).toMatchObject({ id: staff.id, role: 'staff', storeId: device.storeId });
    expect(useAuthStore.getState()).toMatchObject({
      user: { id: staff.id, role: 'staff', storeId: device.storeId },
      device: { id: device.id, storeId: device.storeId },
      locked: false,
      permissions: ['take_orders'],
    });
  });

  it('allows the store owner to sign in with their personal PIN on the shared device', async () => {
    await useAuthStore.getState().loginDevice(device.username, 'temporary-password');
    mocks.authGetCurrentUser.mockResolvedValue(owner);

    const signedInOwner = await useAuthStore.getState().loginWithDevicePin('4826');

    expect(signedInOwner).toMatchObject({ id: owner.id, role: 'owner', storeId: device.storeId });
    expect(useAuthStore.getState()).toMatchObject({
      user: { id: owner.id, role: 'owner', storeId: device.storeId },
      device: { id: device.id, storeId: device.storeId },
      locked: false,
      permissions: [],
      permissionsReady: true,
    });
  });

  it('rejects an account from a different store instead of switching terminal identity', async () => {
    await useAuthStore.getState().loginDevice(device.username, 'temporary-password');
    mocks.authGetCurrentUser.mockResolvedValue({ ...staff, storeId: 'another-store' });

    await expect(useAuthStore.getState().loginWithDevicePin('4826'))
      .rejects.toThrow('The account could not be matched to this store device.');
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().device?.id).toBe(device.id);
  });

  it('locks by revoking the employee session while retaining device authentication', async () => {
    useAuthStore.setState({ user: staff, device, locked: false });

    await useAuthStore.getState().lock();

    expect(mocks.authLockDeviceSession).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      device,
      locked: true,
      permissions: [],
    });
    expect(mocks.clearOrder).toHaveBeenCalledOnce();
  });

  it('returns the owner to the shared-device PIN screen when locking', async () => {
    useAuthStore.setState({ user: owner, device, locked: false });

    await useAuthStore.getState().lock();

    expect(mocks.authLockDeviceSession).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      cachedUserDisplay: null,
      device,
      locked: true,
      permissions: [],
    });
    expect(mocks.authLockCurrentSession).not.toHaveBeenCalled();
    expect(mocks.deviceLogout).not.toHaveBeenCalled();
    expect(mocks.clearOrder).toHaveBeenCalledOnce();
  });

  it('locks a regular owner session without clearing or signing out the account', async () => {
    useAuthStore.setState({ user: owner, device: null, locked: false });

    await useAuthStore.getState().lock();

    expect(mocks.authLockCurrentSession).toHaveBeenCalledOnce();
    expect(mocks.authLockDeviceSession).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ user: owner, device: null, locked: true });
    expect(mocks.authLogout).not.toHaveBeenCalled();
  });

  it('prevents a staff PIN session from signing out the shared device', async () => {
    useAuthStore.setState({ user: staff, device, locked: false });

    await expect(useAuthStore.getState().logout())
      .rejects.toThrow('Lock the account session before signing out of a shared device.');
    await expect(useAuthStore.getState().logoutDevice())
      .rejects.toThrow('Lock the account session before signing out of a shared device.');

    expect(mocks.authLogout).not.toHaveBeenCalled();
    expect(mocks.deviceLogout).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ user: staff, device, locked: false });
  });

  it('prevents the store owner from signing out of the shared device', async () => {
    useAuthStore.setState({ user: owner, device, locked: false });

    await expect(useAuthStore.getState().logout())
      .rejects.toThrow('Lock the account session before signing out of a shared device.');
    expect(mocks.authLogout).not.toHaveBeenCalled();
    expect(mocks.deviceLogout).not.toHaveBeenCalled();
  });

  it('allows device sign-out from its PIN screen', async () => {
    useAuthStore.setState({ user: null, device, locked: true });

    await useAuthStore.getState().logoutDevice();

    expect(mocks.authLogout).toHaveBeenCalledOnce();
    expect(mocks.deviceLogout).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({ user: null, device: null, locked: false });
  });
});
