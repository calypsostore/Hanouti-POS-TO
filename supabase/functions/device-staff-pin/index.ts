import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  clients,
  corsHeaders,
  HttpError,
  requireDeviceContext,
  response,
  sessionIdFromToken,
  sessionLifetimeExpiresAt,
} from '../_shared/deviceAuth.ts';

interface PinRequest {
  pin?: unknown;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' });

  try {
    const body = await request.json() as PinRequest;
    if (typeof body.pin !== 'string' || !/^\d{4}$/.test(body.pin)) {
      return response(400, { error: 'Enter the 4-digit account PIN.' });
    }

    const deviceContext = await requireDeviceContext(request);
    if (deviceContext.device.must_change_password) {
      return response(403, { error: 'Change the device password before PIN sign-in.' });
    }

    const { data: accountId, error: pinError } = await deviceContext.admin.rpc('verify_staff_pin_for_device', {
      p_device_id: deviceContext.device.id,
      p_device_auth_user_id: deviceContext.device.auth_user_id,
      p_session_id: deviceContext.sessionId,
      p_pin: body.pin,
    });
    if (pinError) {
      if (pinError.message.includes('locked until the owner resets')) {
        return response(429, { error: 'PIN sign-in is locked. Ask the store owner to reset this device.' });
      }
      if (pinError.code === '28000') return response(401, { error: 'The device session is no longer active.' });
      console.error('[device-pin] PIN verification failed.');
      return response(503, { error: 'PIN verification is temporarily unavailable.' });
    }
    if (typeof accountId !== 'string' || !/^[0-9a-f-]{36}$/i.test(accountId)) {
      return response(401, { error: 'The PIN is incorrect or unavailable.' });
    }

    const { data: account, error: accountError } = await deviceContext.admin
      .from('profiles')
      .select('id, role, store_id, name, is_active, must_change_password, must_set_pin, session_version')
      .eq('id', accountId)
      .maybeSingle();
    if (accountError) throw new HttpError(503, 'Could not load the account.');
    if (!account || !['staff', 'owner'].includes(account.role) ||
      account.store_id !== deviceContext.device.store_id || !account.is_active || account.must_set_pin) {
      return response(401, { error: 'The PIN is incorrect or unavailable.' });
    }

    const { url, anonKey, admin } = clients();
    const { data: accountAuthData, error: accountAuthError } = await admin.auth.admin.getUserById(account.id);
    const accountEmail = accountAuthData.user?.email;
    if (accountAuthError || !accountEmail) throw new HttpError(503, 'The account sign-in is unavailable.');

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: accountEmail,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkError || !tokenHash) throw new HttpError(503, 'Could not establish the account session.');

    const accountAuth = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verified, error: verifyError } = await accountAuth.auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    });
    if (verifyError || !verified.session || verified.user?.id !== account.id) {
      throw new HttpError(503, 'Could not establish the account session.');
    }

    const accountSessionId = sessionIdFromToken(verified.session.access_token);
    const expiresAt = sessionLifetimeExpiresAt();
    const { error: deviceSessionError } = await admin.from('device_sessions').upsert({
      session_id: accountSessionId,
      device_id: deviceContext.device.id,
      session_version: deviceContext.device.session_version,
      expires_at: expiresAt,
    });
    if (deviceSessionError) throw new HttpError(503, 'Could not register the shared device session.');

    const { error: registerError } = await admin.from('auth_sessions').upsert({
      session_id: accountSessionId,
      user_id: account.id,
      session_version: account.session_version,
      device_id: deviceContext.device.id,
      expires_at: expiresAt,
    });
    if (registerError) {
      await admin.from('device_sessions').delete().eq('session_id', accountSessionId);
      try {
        const revokeResponse = await fetch(`${url}/auth/v1/logout?scope=local`, {
          method: 'POST',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${verified.session.access_token}`,
          },
        });
        if (!revokeResponse.ok) console.error('[device-pin] Could not revoke an unregistered account Auth session.');
      } catch {
        console.error('[device-pin] Could not reach Auth to revoke an unregistered account session.');
      }
      throw new HttpError(503, 'Could not register the account session.');
    }

    const { error: activityError } = await accountAuth.rpc('log_activity', {
      p_action: `device.${account.role}_login`,
      p_summary: `${account.name} signed in on device "${deviceContext.device.name}".`,
      p_entity_type: 'session',
      p_entity_id: deviceContext.device.id,
      p_meta: { deviceId: deviceContext.device.id },
    });
    if (activityError) {
      await admin.from('auth_sessions').delete().eq('session_id', accountSessionId);
      await admin.from('device_sessions').delete().eq('session_id', accountSessionId);
      throw new HttpError(503, 'The account session could not be recorded. Try again.');
    }

    const { error: lastSeenError } = await admin.from('devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', deviceContext.device.id);
    if (lastSeenError) console.error('[device-pin] Could not update last-used device activity.');
    return response(200, {
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
      must_change_password: account.must_change_password,
    });
  } catch (error) {
    if (error instanceof HttpError) return response(error.status, { error: error.message });
    if (error instanceof SyntaxError) return response(400, { error: 'The PIN request is invalid.' });
    console.error('[device-pin] Account sign-in request failed.', error instanceof Error ? error.name : 'UnknownError');
    return response(500, { error: 'PIN sign-in is temporarily unavailable.' });
  }
});
