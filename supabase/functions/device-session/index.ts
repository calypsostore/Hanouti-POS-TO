import {
  corsHeaders,
  HttpError,
  requireDeviceContext,
  response,
} from '../_shared/deviceAuth.ts';

interface SessionRequest {
  action?: unknown;
  password?: unknown;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' });

  try {
    const body = await request.json() as SessionRequest;
    const context = await requireDeviceContext(request);
    if (body.action === 'current') {
      return response(200, {
        device: {
          id: context.device.id,
          storeId: context.device.store_id,
          name: context.device.name,
          username: context.device.username,
          mustChangePassword: context.device.must_change_password,
        },
      });
    }

    if (body.action === 'change-password') {
      if (!context.device.must_change_password) {
        return response(409, { error: 'This device is not awaiting a password change.' });
      }
      if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 128) {
        return response(400, { error: 'Use a password between 10 and 128 characters.' });
      }

      const { error: passwordError } = await context.admin.auth.admin.updateUserById(context.device.auth_user_id, {
        password: body.password,
      });
      if (passwordError) {
        console.error('[device-session] Device password update failed.', passwordError.code);
        return response(503, { error: 'Could not change the device password.' });
      }
      const { data: updatedDevice, error: updateError } = await context.admin
        .from('devices')
        .update({ must_change_password: false, updated_at: new Date().toISOString() })
        .eq('id', context.device.id)
        .eq('session_version', context.device.session_version)
        .eq('is_active', true)
        .select('id')
        .maybeSingle();
      if (updateError) throw new HttpError(503, 'The password was changed, but device setup could not be completed. Contact the store owner.');
      if (!updatedDevice) throw new HttpError(409, 'Device status changed during setup. Sign in again or contact the store owner.');
      return response(200, { changed: true });
    }

    if (body.action === 'logout') {
      const results = await Promise.all([
        context.admin.from('device_sessions').delete().eq('device_id', context.device.id),
        context.admin.from('auth_sessions').delete().eq('device_id', context.device.id),
      ]);
      if (results.some((result) => result.error)) throw new HttpError(503, 'Could not close every session on this device.');

      const { error: revokeError } = await context.admin.auth.admin.signOut(context.accessToken, 'global');
      if (revokeError) {
        console.error('[device-session] Device Auth session revocation failed.', revokeError.code);
        throw new HttpError(503, 'The device session was closed, but remote sign-out could not be confirmed.');
      }
      return response(200, { signedOut: true });
    }

    return response(400, { error: 'The requested device session action is not supported.' });
  } catch (error) {
    if (error instanceof HttpError) return response(error.status, { error: error.message });
    if (error instanceof SyntaxError) return response(400, { error: 'The device session request is invalid.' });
    console.error('[device-session] Device session request failed.', error instanceof Error ? error.name : 'UnknownError');
    return response(500, { error: 'The device session request could not be completed.' });
  }
});
