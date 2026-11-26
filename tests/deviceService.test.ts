import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mainInvoke: vi.fn(),
  mainSetSession: vi.fn(),
  mainSignOut: vi.fn(),
  deviceInvoke: vi.fn(),
  deviceSetSession: vi.fn(),
  deviceGetSession: vi.fn(),
  deviceSignOut: vi.fn(),
}));

vi.mock('../src/data/driver', () => ({ isSupabaseDriver: () => true }));
vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: () => ({
    functions: { invoke: mocks.mainInvoke },
    auth: { setSession: mocks.mainSetSession, signOut: mocks.mainSignOut },
  }),
}));
vi.mock('../src/data/deviceSupabaseClient', () => ({
  getDeviceSupabaseClient: () => ({
    functions: { invoke: mocks.deviceInvoke },
    auth: {
      setSession: mocks.deviceSetSession,
      getSession: mocks.deviceGetSession,
      signOut: mocks.deviceSignOut,
    },
  }),
}));

import { deviceService } from '../src/services/deviceService';

describe('device service authentication boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('window', { localStorage });
    mocks.mainSetSession.mockResolvedValue({ error: null });
    mocks.mainSignOut.mockResolvedValue({ error: null });
    mocks.deviceSetSession.mockResolvedValue({ error: null });
    mocks.deviceGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mocks.deviceSignOut.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the owner management Edge Function for store device listings', async () => {
    mocks.mainInvoke.mockResolvedValue({ data: { devices: [], totalCount: 0 }, error: null });

    await expect(deviceService.listForOwner()).resolves.toEqual({ devices: [], totalCount: 0 });
    expect(mocks.mainInvoke).toHaveBeenCalledWith('manage-devices', {
      body: { action: 'list', offset: 0, limit: 50 },
    });
  });

  it('requests subsequent device pages using the requested offset', async () => {
    mocks.mainInvoke.mockResolvedValue({ data: { devices: [], totalCount: 73 }, error: null });

    await expect(deviceService.listForOwner(50)).resolves.toEqual({ devices: [], totalCount: 73 });
    expect(mocks.mainInvoke).toHaveBeenCalledWith('manage-devices', {
      body: { action: 'list', offset: 50, limit: 50 },
    });
  });

  it('rejects device-list responses without an exact total count', async () => {
    mocks.mainInvoke.mockResolvedValue({ data: { devices: [] }, error: null });

    await expect(deviceService.listForOwner()).rejects.toThrow('invalid device list');
  });

  it('establishes device authentication separately from the employee Supabase session', async () => {
    const device = {
      id: 'device-id',
      storeId: 'store-id',
      name: 'Front counter',
      username: 'd-a1b2c3d4',
      mustChangePassword: true,
    };
    mocks.deviceInvoke.mockResolvedValue({
      data: { access_token: 'device-access', refresh_token: 'device-refresh', device },
      error: null,
    });

    await expect(deviceService.loginDevice(device.username, 'temporary-password')).resolves.toEqual(device);

    expect(mocks.deviceInvoke).toHaveBeenCalledWith('device-login', {
      body: { username: device.username, password: 'temporary-password' },
    });
    expect(mocks.deviceSetSession).toHaveBeenCalledWith({
      access_token: 'device-access',
      refresh_token: 'device-refresh',
    });
    expect(mocks.mainSetSession).not.toHaveBeenCalled();
  });

  it('uses the server-issued staff session after PIN verification, not the device identity', async () => {
    mocks.deviceInvoke.mockResolvedValue({
      data: {
        access_token: 'staff-access',
        refresh_token: 'staff-refresh',
        must_change_password: false,
      },
      error: null,
    });

    await deviceService.loginStaffWithPin('4826');

    expect(mocks.deviceInvoke).toHaveBeenCalledWith('device-staff-pin', { body: { pin: '4826' } });
    expect(mocks.mainSetSession).toHaveBeenCalledWith({
      access_token: 'staff-access',
      refresh_token: 'staff-refresh',
    });
  });

  it('surfaces a rejected PIN without attempting to establish an employee session', async () => {
    mocks.deviceInvoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: new Response(JSON.stringify({ error: 'The staff PIN is incorrect or unavailable.' }), { status: 401 }),
      },
    });

    await expect(deviceService.loginStaffWithPin('0000')).rejects.toThrow('The staff PIN is incorrect or unavailable.');
    expect(mocks.mainSetSession).not.toHaveBeenCalled();
  });

  it('revokes the device session remotely and clears the local device token on logout', async () => {
    mocks.deviceGetSession.mockResolvedValue({
      data: { session: { access_token: 'device-access' } },
      error: null,
    });
    mocks.deviceInvoke.mockResolvedValue({ data: { signedOut: true }, error: null });

    await deviceService.logoutDevice();

    expect(mocks.deviceInvoke).toHaveBeenCalledWith('device-session', { body: { action: 'logout' } });
    expect(mocks.deviceSignOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('restores cached device display details if the server session cannot be checked offline', async () => {
    const device = {
      id: 'device-id',
      storeId: 'store-id',
      name: 'Front counter',
      username: 'd-a1b2c3d4',
      mustChangePassword: false,
    };
    localStorage.setItem('7anouti-pos:shared-device', JSON.stringify(device));
    mocks.deviceGetSession.mockResolvedValue({
      data: { session: { access_token: 'device-access' } },
      error: null,
    });
    mocks.deviceInvoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' },
    });

    await expect(deviceService.getCurrentDevice()).resolves.toEqual(device);
  });
});
