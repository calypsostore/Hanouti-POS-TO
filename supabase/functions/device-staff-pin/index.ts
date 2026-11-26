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
      return response(400, { error: 'Enter the staff member’s 4-digit PIN.' });
    }

    const deviceContext = await requireDeviceContext(request);
    if (deviceContext.device.must_change_password) {
      return response(403, { error: 'Change the device password before staff sign-in.' });
    }

    const { data: staffId, error: pinError } = await deviceContext.admin.rpc('verify_staff_pin_for_device', {
      p_device_id: deviceContext.device.id,
      p_device_auth_user_id: deviceContext.device.auth_user_id,
      p_session_id: deviceContext.sessionId,
      p_pin: body.pin,
    });
    if (pinError) {
      if (pinError.message.includes('temporarily locked')) {
        return response(429, { error: 'Too many incorrect PIN attempts. Try again in 60 seconds.' });
      }
      if (pinError.code === '28000') return response(401, { error: 'The device session is no longer active.' });
      console.error('[device-pin] PIN verification failed.');
      return response(503, { error: 'Staff PIN verification is temporarily unavailable.' });
    }
    if (typeof staffId !== 'string' || !/^[0-9a-f-]{36}$/i.test(staffId)) {
      return response(401, { error: 'The staff PIN is incorrect or unavailable.' });
    }

    const { data: staff, error: staffError } = await deviceContext.admin
      .from('profiles')
      .select('id, role, store_id, name, is_active, must_change_password, must_set_pin, session_version')
      .eq('id', staffId)
      .maybeSingle();
    if (staffError) throw new HttpError(503, 'Could not load the staff account.');
    if (!staff || staff.role !== 'staff' || staff.store_id !== deviceContext.device.store_id ||
      !staff.is_active || staff.must_set_pin) {
      return response(401, { error: 'The staff PIN is incorrect or unavailable.' });
    }

    const { url, anonKey, admin } = clients();
    const { data: staffAuthData, error: staffAuthError } = await admin.auth.admin.getUserById(staff.id);
    const staffEmail = staffAuthData.user?.email;
    if (staffAuthError || !staffEmail) throw new HttpError(503, 'The staff sign-in account is unavailable.');

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: staffEmail,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkError || !tokenHash) throw new HttpError(503, 'Could not establish the staff sign-in session.');

    const staffAuth = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verified, error: verifyError } = await staffAuth.auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    });
    if (verifyError || !verified.session || verified.user?.id !== staff.id) {
      throw new HttpError(503, 'Could not establish the staff sign-in session.');
    }

    const staffSessionId = sessionIdFromToken(verified.session.access_token);
    const expiresAt = sessionLifetimeExpiresAt();
    const { error: deviceSessionError } = await admin.from('device_sessions').upsert({
      session_id: staffSessionId,
      device_id: deviceContext.device.id,
      session_version: deviceContext.device.session_version,
      expires_at: expiresAt,
    });
    if (deviceSessionError) throw new HttpError(503, 'Could not register the shared device session.');

    const { error: registerError } = await admin.from('auth_sessions').upsert({
      session_id: staffSessionId,
      user_id: staff.id,
      session_version: staff.session_version,
      device_id: deviceContext.device.id,
      expires_at: expiresAt,
    });
    if (registerError) {
      await admin.from('device_sessions').delete().eq('session_id', staffSessionId);
      try {
        const revokeResponse = await fetch(`${url}/auth/v1/logout?scope=local`, {
          method: 'POST',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${verified.session.access_token}`,
          },
        });
        if (!revokeResponse.ok) console.error('[device-pin] Could not revoke an unregistered staff Auth session.');
      } catch {
        console.error('[device-pin] Could not reach Auth to revoke an unregistered staff session.');
      }
      throw new HttpError(503, 'Could not register the staff sign-in session.');
    }

    const { error: activityError } = await staffAuth.rpc('log_activity', {
      p_action: 'device.staff_login',
      p_summary: `${staff.name} signed in on device "${deviceContext.device.name}".`,
      p_entity_type: 'session',
      p_entity_id: deviceContext.device.id,
      p_meta: { deviceId: deviceContext.device.id },
    });
    if (activityError) {
      await admin.from('auth_sessions').delete().eq('session_id', staffSessionId);
      await admin.from('device_sessions').delete().eq('session_id', staffSessionId);
      throw new HttpError(503, 'The staff session could not be recorded. Try again.');
    }

    const { error: lastSeenError } = await admin.from('devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', deviceContext.device.id);
    if (lastSeenError) console.error('[device-pin] Could not update last-used device activity.');
    return response(200, {
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
      must_change_password: staff.must_change_password,
    });
  } catch (error) {
    if (error instanceof HttpError) return response(error.status, { error: error.message });
    if (error instanceof SyntaxError) return response(400, { error: 'The PIN request is invalid.' });
    console.error('[device-pin] Staff sign-in request failed.', error instanceof Error ? error.name : 'UnknownError');
    return response(500, { error: 'Staff sign-in is temporarily unavailable.' });
  }
});
