import {
  clients,
  corsHeaders,
  deviceEmail,
  HttpError,
  randomTemporaryPassword,
  randomDeviceUsername,
  requireOwnerContext,
  response,
} from '../_shared/deviceAuth.ts';

interface RequestBody {
  action?: unknown;
  deviceId?: unknown;
  name?: unknown;
  isActive?: unknown;
  offset?: unknown;
  limit?: unknown;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeDevice(device: {
  id: string;
  name: string;
  username: string;
  is_active: boolean;
  must_change_password: boolean;
  last_seen_at: string | null;
  created_at: string;
}) {
  return {
    id: device.id,
    name: device.name,
    username: device.username,
    isActive: device.is_active,
    mustChangePassword: device.must_change_password,
    lastSeenAt: device.last_seen_at,
    createdAt: device.created_at,
  };
}

async function logOwnerAction(
  ownerClient: Awaited<ReturnType<typeof requireOwnerContext>>['ownerClient'],
  action: string,
  summary: string,
  deviceId: string,
  meta: Record<string, unknown> = {},
): Promise<boolean> {
  const { error } = await ownerClient.rpc('log_activity', {
    p_action: action,
    p_summary: summary,
    p_entity_type: 'device',
    p_entity_id: deviceId,
    p_meta: meta,
  });
  if (error) {
    console.error('[devices] Could not write the owner activity record.', error.code ?? 'UnknownError');
    return false;
  }
  return true;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' });

  try {
    const body = await request.json() as RequestBody;
    const { admin, ownerClient, ownerId, storeId } = await requireOwnerContext(request);
    if (body.action === 'list') {
      const offset = body.offset ?? 0;
      const limit = body.limit ?? 50;
      if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000 ||
        typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
        return response(400, { error: 'The device list page is invalid.' });
      }

      const { data, error, count } = await admin
        .from('devices')
        .select('id, name, username, is_active, must_change_password, last_seen_at, created_at', { count: 'exact' })
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw new HttpError(503, 'Could not load the store devices.');
      if (typeof count !== 'number') throw new HttpError(503, 'Could not count the store devices.');
      return response(200, { devices: (data ?? []).map(safeDevice), totalCount: count });
    }

    if (body.action === 'create') {
      if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 80) {
        return response(400, { error: 'Enter a device name between 1 and 80 characters.' });
      }

      const id = crypto.randomUUID();
      const username = randomDeviceUsername();
      const temporaryPassword = randomTemporaryPassword();
      const { admin: serverAdmin } = clients();
      const { data: authData, error: authError } = await serverAdmin.auth.admin.createUser({
        email: deviceEmail(username),
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { device_id: id },
      });
      if (authError || !authData.user) {
        console.error('[devices] Device Auth account could not be created.', authError?.code ?? 'UnknownError');
        return response(503, { error: 'Could not create the device account.' });
      }

      const { data: device, error: insertError } = await admin
        .from('devices')
        .insert({
          id,
          store_id: storeId,
          auth_user_id: authData.user.id,
          name: body.name.trim(),
          username,
          created_by: ownerId,
        })
        .select('id, name, username, is_active, must_change_password, last_seen_at, created_at')
        .single();
      if (insertError || !device) {
        const { error: cleanupError } = await serverAdmin.auth.admin.deleteUser(authData.user.id);
        if (cleanupError) console.error('[devices] Could not remove an orphaned device Auth account.', cleanupError.code);
        console.error('[devices] Device record could not be created.', insertError?.code ?? 'UnknownError');
        return response(503, { error: 'Could not save the device record.' });
      }

      const auditRecorded = await logOwnerAction(ownerClient, 'device.created', `Created device "${device.name}".`, device.id);
      return response(201, {
        device: safeDevice(device),
        temporaryPassword,
        ...(auditRecorded ? {} : { auditWarning: 'The device was created, but its activity record could not be written.' }),
      });
    }

    if (!validId(body.deviceId)) return response(400, { error: 'A valid device is required.' });
    const { data: device, error: loadError } = await admin
      .from('devices')
      .select('id, auth_user_id, name, username, is_active, must_change_password, session_version, last_seen_at, created_at')
      .eq('id', body.deviceId)
      .eq('store_id', storeId)
      .maybeSingle();
    if (loadError) throw new HttpError(503, 'Could not load the device.');
    if (!device) return response(404, { error: 'The device could not be found in this store.' });

    if (body.action === 'reset-password') {
      const temporaryPassword = randomTemporaryPassword();
      const { admin: serverAdmin } = clients();
      const { data: resetState, error: updateError } = await admin.from('devices').update({
        is_active: false,
        must_change_password: true,
        session_version: device.session_version + 1,
        updated_at: new Date().toISOString(),
      }).eq('id', device.id).eq('store_id', storeId).eq('session_version', device.session_version)
        .select('id').maybeSingle();
      if (updateError) throw new HttpError(503, 'Could not revoke the previous device sessions.');
      if (!resetState) throw new HttpError(409, 'The device changed in another session. Refresh and try again.');
      const sessionResults = await Promise.all([
        admin.from('device_sessions').delete().eq('device_id', device.id),
        admin.from('auth_sessions').delete().eq('device_id', device.id),
      ]);
      if (sessionResults.some((result) => result.error)) {
        throw new HttpError(503, 'The device password was reset, but active sessions could not all be revoked.');
      }
      const { error: pinAttemptsError } = await admin.from('device_pin_attempts').delete().eq('device_id', device.id);
      if (pinAttemptsError) {
        throw new HttpError(503, 'Device sessions were revoked, but staff PIN access could not be reset. Retry the device reset.');
      }
      const { error: passwordError } = await serverAdmin.auth.admin.updateUserById(device.auth_user_id, {
        password: temporaryPassword,
      });
      if (passwordError) {
        console.error('[devices] Device password reset failed.', passwordError.code);
        return response(503, { error: 'Device sessions were revoked, but the password could not be reset. Retry the reset.' });
      }
      const { data: restoredStatus, error: restoreStatusError } = await admin.from('devices')
        .update({ is_active: device.is_active, updated_at: new Date().toISOString() })
        .eq('id', device.id)
        .eq('session_version', device.session_version + 1)
        .select('is_active')
        .maybeSingle();
      if (restoreStatusError || !restoredStatus) {
        console.error('[devices] The password was reset but the previous device status could not be restored.', restoreStatusError?.code ?? 'DeviceStatusUpdateMissing');
        const auditRecorded = await logOwnerAction(ownerClient, 'device.password_reset', `Reset the password for "${device.name}".`, device.id);
        return response(200, {
          device: safeDevice({ ...device, is_active: false, must_change_password: true }),
          temporaryPassword,
          auditWarning: auditRecorded
            ? 'The password was reset, but the device remains deactivated. Record the credentials, then activate it.'
            : 'The password was reset, but the device remains deactivated and its activity record could not be written. Record the credentials, then activate it.',
        });
      }
      const auditRecorded = await logOwnerAction(ownerClient, 'device.password_reset', `Reset the password for "${device.name}".`, device.id);
      return response(200, {
        device: safeDevice({ ...device, is_active: restoredStatus.is_active, must_change_password: true }),
        temporaryPassword,
        ...(auditRecorded ? {} : { auditWarning: 'The password was reset, but its activity record could not be written.' }),
      });
    }

    if (body.action !== 'update') return response(400, { error: 'The requested device action is not supported.' });
    if ((body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 80)) ||
      (body.isActive !== undefined && typeof body.isActive !== 'boolean') ||
      (body.name === undefined && body.isActive === undefined)) {
      return response(400, { error: 'Provide a valid device name or active status.' });
    }

    const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === 'string') changes.name = body.name.trim();
    if (typeof body.isActive === 'boolean') changes.is_active = body.isActive;
    if (body.isActive === false) changes.session_version = device.session_version + 1;
    const { data: updated, error: updateError } = await admin
      .from('devices')
      .update(changes)
      .eq('id', device.id)
      .eq('store_id', storeId)
      .eq('session_version', device.session_version)
      .select('id, name, username, is_active, must_change_password, last_seen_at, created_at')
      .maybeSingle();
    if (updateError) throw new HttpError(503, 'Could not update the device.');
    if (!updated) throw new HttpError(409, 'The device changed in another session. Refresh and try again.');
    if (body.isActive === false) {
      const results = await Promise.all([
        admin.from('device_sessions').delete().eq('device_id', device.id),
        admin.from('auth_sessions').delete().eq('device_id', device.id),
      ]);
      if (results.some((result) => result.error)) {
        throw new HttpError(503, 'The device was deactivated, but not all active sessions could be revoked.');
      }
    }
    const auditRecorded = await logOwnerAction(
      ownerClient,
      body.isActive === false ? 'device.deactivated' : body.isActive === true ? 'device.activated' : 'device.updated',
      `${body.isActive === false ? 'Deactivated' : body.isActive === true ? 'Activated' : 'Updated'} device "${updated.name}".`,
      device.id,
    );
    return response(200, {
      device: safeDevice(updated),
      ...(auditRecorded ? {} : { auditWarning: 'The device was updated, but its activity record could not be written.' }),
    });
  } catch (error) {
    if (error instanceof HttpError) return response(error.status, { error: error.message });
    if (error instanceof SyntaxError) return response(400, { error: 'The device request is invalid.' });
    console.error('[devices] Device management request failed.', error instanceof Error ? error.name : 'UnknownError');
    return response(500, { error: 'The device request could not be completed.' });
  }
});
