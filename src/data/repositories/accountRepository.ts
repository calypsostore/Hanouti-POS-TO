import type { PermissionOverrides, StoreRecord, UserSummary } from '../../types/domain';
import { getSupabaseClient } from '../supabaseClient';

interface ProvisionResult {
  owner?: UserSummary;
  staff?: UserSummary;
  store?: StoreRecord;
  temporaryPassword?: string;
}

async function invokeProvisioner(body: Record<string, unknown>): Promise<ProvisionResult> {
  const { data, error } = await getSupabaseClient().functions.invoke('provision-account', { body });
  if (error) {
    let message = error.message;
    if (error.context instanceof Response) {
      const payload = await error.context.json() as { error?: string };
      message = payload.error ?? message;
    }
    throw new Error(`Account operation failed: ${message}`, { cause: error });
  }
  if (typeof data !== 'object' || data === null) throw new Error('Account operation returned an invalid response.');
  return data as ProvisionResult;
}

export async function createOwnerAccount(input: {
  name: string;
  email: string;
  storeName: string;
  storeCode: string;
}): Promise<{ owner: UserSummary; store: StoreRecord; temporaryPassword: string }> {
  const result = await invokeProvisioner({ action: 'create_owner', ...input });
  if (!result.owner || !result.store || !result.temporaryPassword) {
    throw new Error('Owner creation did not return the account, store, and temporary password.');
  }
  return { owner: result.owner, store: result.store, temporaryPassword: result.temporaryPassword };
}

export async function createStaff(input: {
  storeId: string;
  name: string;
  phone?: string;
  notes?: string;
  positionId: string;
  usernameSuffix?: string;
  permissionOverrides?: PermissionOverrides;
}): Promise<{ staff: UserSummary; temporaryPassword: string }> {
  const result = await invokeProvisioner({ action: 'create_staff', ...input });
  if (!result.staff || !result.temporaryPassword) {
    throw new Error('Staff creation did not return the account and temporary password.');
  }
  return { staff: result.staff, temporaryPassword: result.temporaryPassword };
}

export async function resetPassword(userId: string): Promise<string> {
  const result = await invokeProvisioner({ action: 'reset_password', userId });
  if (!result.temporaryPassword) throw new Error('Password reset did not return a temporary password.');
  return result.temporaryPassword;
}
