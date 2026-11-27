import { getDeviceSupabaseClient } from '../data/deviceSupabaseClient';
import { getSupabaseClient } from '../data/supabaseClient';
import { isSupabaseDriver } from '../data/driver';

const DEVICE_CACHE_KEY = '7anouti-pos:shared-device';
export const DEVICE_PAGE_SIZE = 50;

export interface DeviceSummary {
  id: string;
  storeId: string;
  name: string;
  username: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export type DeviceSessionSummary = Pick<DeviceSummary, 'id' | 'storeId' | 'name' | 'username' | 'mustChangePassword'>;

export interface DeviceCredentialResult {
  device: DeviceSummary;
  temporaryPassword: string;
  auditWarning?: string;
}

export interface DevicePinLockoutStatus {
  failedAttempts: number;
  blocked: boolean;
  retryAfterSeconds: number | null;
}

export class DevicePinLoginError extends Error {
  readonly lockout?: DevicePinLockoutStatus;

  constructor(message: string, lockout?: DevicePinLockoutStatus) {
    super(message);
    this.name = 'DevicePinLoginError';
    this.lockout = lockout;
  }
}

interface DeviceSessionResponse {
  device: DeviceSessionSummary;
}

function getCachedDevice(): DeviceSessionSummary | null {
  try {
    const raw = window.localStorage.getItem(DEVICE_CACHE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null ||
      !('id' in value) || typeof value.id !== 'string' ||
      !('storeId' in value) || typeof value.storeId !== 'string' ||
      !('name' in value) || typeof value.name !== 'string' ||
      !('username' in value) || typeof value.username !== 'string' ||
      !('mustChangePassword' in value) || typeof value.mustChangePassword !== 'boolean') {
      window.localStorage.removeItem(DEVICE_CACHE_KEY);
      return null;
    }
    return {
      id: value.id,
      storeId: value.storeId,
      name: value.name,
      username: value.username,
      mustChangePassword: value.mustChangePassword,
    };
  } catch (error) {
    console.error('[devices] Could not restore cached device details.', error);
    return null;
  }
}

function cacheDevice(device: DeviceSessionSummary): void {
  try {
    window.localStorage.setItem(DEVICE_CACHE_KEY, JSON.stringify(device));
  } catch (error) {
    console.warn('[devices] Could not cache device details for offline display.', error);
  }
}

function clearCachedDevice(): void {
  try {
    window.localStorage.removeItem(DEVICE_CACHE_KEY);
  } catch (error) {
    console.warn('[devices] Could not clear cached device details.', error);
  }
}

function isNetworkFailure(error: { message: string; name?: string }): boolean {
  return /fetcherror|networkerror/i.test(error.name ?? '') ||
    /failed to fetch|fetch failed|network request failed|load failed|offline|timed out|timeout/i.test(error.message);
}

function requireSupabase(): void {
  if (!isSupabaseDriver()) {
    throw new Error('Device accounts require the connected Supabase service.');
  }
}

async function throwFunctionError(error: { message: string; context?: unknown }, fallback: string): Promise<never> {
  const context = error.context;
  if (context instanceof Response) {
    let body: unknown;
    try {
      body = await context.clone().json();
    } catch {
      body = null;
    }
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      throw new Error(body.error);
    }
  }
  throw new Error(`${fallback}: ${error.message}`, { cause: error });
}

function isDevicePinLockoutStatus(value: unknown): value is DevicePinLockoutStatus {
  return typeof value === 'object' && value !== null &&
    'failedAttempts' in value && typeof value.failedAttempts === 'number' &&
    'blocked' in value && typeof value.blocked === 'boolean' &&
    'retryAfterSeconds' in value &&
    (value.retryAfterSeconds === null ||
      (typeof value.retryAfterSeconds === 'number' && Number.isFinite(value.retryAfterSeconds) && value.retryAfterSeconds >= 0));
}

async function throwDevicePinLoginError(error: { message: string; context?: unknown }): Promise<never> {
  if (error.context instanceof Response) {
    let body: unknown;
    try {
      body = await error.context.clone().json();
    } catch {
      body = null;
    }
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      const lockout = 'lockout' in body && isDevicePinLockoutStatus(body.lockout)
        ? body.lockout
        : undefined;
      throw new DevicePinLoginError(body.error, lockout);
    }
  }
  return throwFunctionError(error, 'Could not verify the account PIN');
}

async function invokeOwner<T>(body: Record<string, unknown>): Promise<T> {
  requireSupabase();
  const { data, error } = await getSupabaseClient().functions.invoke<T>('manage-devices', { body });
  if (error) await throwFunctionError(error, 'Could not manage store devices');
  if (!data) throw new Error('The device service returned an empty response.');
  return data;
}

export const deviceService = {
  async getPinLockoutStatus(): Promise<DevicePinLockoutStatus> {
    requireSupabase();
    const { data, error } = await getDeviceSupabaseClient().functions.invoke<{
      lockout: unknown;
    }>('device-staff-pin', { body: { action: 'status' } });
    if (error) await throwFunctionError(error, 'Could not check the device PIN lockout status');
    if (!data || !isDevicePinLockoutStatus(data.lockout)) {
      throw new Error('The device PIN lockout status returned an invalid response.');
    }
    return data.lockout;
  },

  async listForOwner(offset = 0): Promise<{ devices: DeviceSummary[]; totalCount: number }> {
    const result = await invokeOwner<{ devices: DeviceSummary[]; totalCount?: number; count?: number }>({
      action: 'list',
      offset,
      limit: DEVICE_PAGE_SIZE,
    });
    const totalCount = result.totalCount ?? result.count;
    if (!Array.isArray(result.devices) || typeof totalCount !== 'number' ||
      !Number.isSafeInteger(totalCount) || totalCount < 0) {
      throw new Error('The device service returned an invalid device list.');
    }
    return { devices: result.devices, totalCount };
  },

  async createForOwner(name: string): Promise<DeviceCredentialResult> {
    const result = await invokeOwner<DeviceCredentialResult>({ action: 'create', name });
    if (!result.device || typeof result.temporaryPassword !== 'string') {
      throw new Error('The device service returned incomplete setup credentials.');
    }
    return result;
  },

  async updateForOwner(deviceId: string, changes: { name?: string; isActive?: boolean }): Promise<{ device: DeviceSummary; auditWarning?: string }> {
    const result = await invokeOwner<{ device: DeviceSummary; auditWarning?: string }>({
      action: 'update',
      deviceId,
      ...changes,
    });
    if (!result.device) throw new Error('The device service returned an invalid device.');
    return result;
  },

  async resetPasswordForOwner(deviceId: string): Promise<DeviceCredentialResult> {
    const result = await invokeOwner<DeviceCredentialResult>({ action: 'reset-password', deviceId });
    if (!result.device || typeof result.temporaryPassword !== 'string') {
      throw new Error('The device service returned incomplete reset credentials.');
    }
    return result;
  },

  async loginDevice(username: string, password: string): Promise<DeviceSessionSummary> {
    requireSupabase();
    const client = getDeviceSupabaseClient();
    const { data, error } = await client.functions.invoke<{
      access_token: string;
      refresh_token: string;
      device: DeviceSessionSummary;
    }>('device-login', { body: { username, password } });
    if (error) await throwFunctionError(error, 'Could not sign in to this device');
    if (!data?.access_token || !data.refresh_token || !data.device) {
      throw new Error('The device sign-in service returned an invalid session.');
    }
    const { error: sessionError } = await client.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (sessionError) {
      const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
      if (signOutError) console.error('[devices] Could not clear an incomplete device session.', signOutError);
      throw new Error(`Could not establish the device session: ${sessionError.message}`, { cause: sessionError });
    }
    cacheDevice(data.device);
    return data.device;
  },

  async getCurrentDevice(): Promise<DeviceSessionSummary | null> {
    if (!isSupabaseDriver()) return null;
    const client = getDeviceSupabaseClient();
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
      if (isNetworkFailure(sessionError)) {
        const cached = getCachedDevice();
        if (cached) {
          console.warn('[devices] Device status could not be checked offline; retaining cached display details.');
          return cached;
        }
      }
      throw new Error(`Could not restore the device session: ${sessionError.message}`, { cause: sessionError });
    }
    if (!sessionData.session) {
      clearCachedDevice();
      return null;
    }

    const { data, error } = await client.functions.invoke<DeviceSessionResponse>('device-session', {
      body: { action: 'current' },
    });
    if (error) {
      const responseContext = 'context' in error ? error.context : undefined;
      if (responseContext instanceof Response && (responseContext.status === 401 || responseContext.status === 403)) {
        const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
        if (signOutError) console.error('[devices] Could not clear an invalid local device session.', signOutError);
        clearCachedDevice();
        return null;
      }
      if (isNetworkFailure(error)) {
        const cached = getCachedDevice();
        if (cached) {
          console.warn('[devices] Device status could not be checked offline; retaining cached display details.');
          return cached;
        }
      }
      await throwFunctionError(error, 'Could not verify the device session');
    }
    if (!data?.device) throw new Error('The device session service returned an invalid response.');
    cacheDevice(data.device);
    return data.device;
  },

  async changeDevicePassword(password: string): Promise<void> {
    requireSupabase();
    const { data, error } = await getDeviceSupabaseClient().functions.invoke<{ changed: boolean }>('device-session', {
      body: { action: 'change-password', password },
    });
    if (error) await throwFunctionError(error, 'Could not change the device password');
    if (data?.changed !== true) throw new Error('The device password change could not be confirmed.');
    const device = getCachedDevice();
    if (device) cacheDevice({ ...device, mustChangePassword: false });
  },

  async loginWithPin(pin: string): Promise<void> {
    requireSupabase();
    const { data, error } = await getDeviceSupabaseClient().functions.invoke<{
      access_token: string;
      refresh_token: string;
      must_change_password: boolean;
    }>('device-staff-pin', { body: { pin } });
    if (error) await throwDevicePinLoginError(error);
    if (!data?.access_token || !data.refresh_token) {
      throw new Error('The account sign-in service returned an invalid session.');
    }
    const { error: sessionError } = await getSupabaseClient().auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (sessionError) {
      const { error: signOutError } = await getSupabaseClient().auth.signOut({ scope: 'local' });
      if (signOutError) console.error('[devices] Could not clear an incomplete account session.', signOutError);
      throw new Error(`Could not establish the account session: ${sessionError.message}`, { cause: sessionError });
    }
  },

  async logoutDevice(): Promise<void> {
    requireSupabase();
    const client = getDeviceSupabaseClient();
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw new Error(`Could not read the device session: ${sessionError.message}`, { cause: sessionError });
    let remoteError: Error | undefined;
    if (sessionData.session) {
      const { error } = await client.functions.invoke<{ signedOut: boolean }>('device-session', {
        body: { action: 'logout' },
      });
      if (error) {
        try {
          await throwFunctionError(error, 'Could not revoke the device session');
        } catch (logoutError) {
          remoteError = logoutError instanceof Error ? logoutError : new Error('Could not revoke the device session.');
        }
      }
    }
    const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
    clearCachedDevice();
    if (signOutError) throw new Error(`Could not clear the local device session: ${signOutError.message}`, { cause: signOutError });
    if (remoteError) throw remoteError;
  },
};
