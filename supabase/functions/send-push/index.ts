import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveNotificationSoundId } from './notificationSounds.ts';

interface NotificationWebhook {
  record?: {
    id?: unknown;
  };
}

function baseChannelForType(type: string): string {
  if (['void_requested', 'customer_credit_warning', 'customer_credit_limit', 'customer_overdue', 'stock_depleted', 'item_86', 'low_stock', 'cash_difference', 'cash_out_alert'].includes(type)) return 'alerts_v2';
  if (['void_approved', 'void_rejected', 'schedule_published', 'shift_opened', 'shift_closed'].includes(type)) return 'orders_v2';
  return 'system_v2';
}

function channelForType(type: string, soundId: string): string {
  return `${baseChannelForType(type)}_${soundId}`;
}

function constantTimeEqual(expected: string, actual: string): boolean {
  let difference = expected.length ^ actual.length;
  for (let index = 0; index < 64; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!webhookSecret || !/^[\da-f]{64}$/i.test(webhookSecret)) {
    return response(500, { error: 'Push webhook secret must be a 32-byte hex value.' });
  }
  if (!constantTimeEqual(webhookSecret, request.headers.get('x-webhook-secret') ?? '')) {
    return response(401, { error: 'Unauthorized.' });
  }

  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const serviceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
  if (!supabaseUrl || !serviceRoleKey || !serviceAccountJson) {
    return response(500, { error: 'FCM push is not configured.' });
  }

  let payload: NotificationWebhook;
  try {
    const parsedPayload: unknown = await request.json();
    if (typeof parsedPayload !== 'object' || parsedPayload === null) {
      return response(400, { error: 'Invalid webhook payload.' });
    }
    payload = parsedPayload as NotificationWebhook;
  } catch {
    return response(400, { error: 'Invalid webhook payload.' });
  }
  if (!payload.record || typeof payload.record !== 'object') return response(200, { ignored: true });
  const notificationId = typeof payload.record.id === 'string' ? payload.record.id : '';
  if (!notificationId) return response(200, { ignored: true });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: record, error: notificationError } = await admin
    .from('notifications')
    .select('id, store_id, user_id, target_role, title, body, type')
    .eq('id', notificationId)
    .maybeSingle();
  if (notificationError) return response(500, { error: notificationError.message });
  if (!record) return response(404, { error: 'Notification not found.' });

  const storeId = typeof record.store_id === 'string' ? record.store_id : '';
  const userId = typeof record.user_id === 'string' ? record.user_id : null;
  const targetRole = typeof record.target_role === 'string' ? record.target_role : null;
  if (!storeId || (!userId && !targetRole)) return response(200, { ignored: true });

  let recipientQuery = admin.from('profiles').select('id').eq('store_id', storeId).eq('is_active', true);
  if (userId) recipientQuery = recipientQuery.eq('id', userId);
  else if (targetRole) recipientQuery = recipientQuery.eq('role', targetRole);
  else return response(200, { ignored: true });
  const { data: recipients, error: recipientError } = await recipientQuery;
  if (recipientError) return response(500, { error: recipientError.message });
  const recipientIds = (recipients ?? []).map((row) => row.id as string);
  if (recipientIds.length === 0) return response(200, { sent: 0 });

  const { data: tokens, error: tokenError } = await admin
    .from('device_tokens')
    .select('user_id, token')
    .eq('store_id', storeId)
    .in('user_id', recipientIds);
  if (tokenError) return response(500, { error: tokenError.message });

  const { data: soundPreferences, error: soundPreferencesError } = await admin
    .from('notification_sound_preferences')
    .select('user_id, general_sound, void_sound')
    .in('user_id', recipientIds);
  if (soundPreferencesError) return response(500, { error: soundPreferencesError.message });
  const soundPreferencesByUser = new Map(
    (soundPreferences ?? []).map((preference) => [preference.user_id, preference]),
  );

  const serviceAccount = JSON.parse(serviceAccountJson) as {
    project_id: string;
    client_email: string;
    private_key: string;
  };
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const encode = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unsigned = `${encode(header)}.${encode(claims)}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(serviceAccount.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')), (char) => char.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  const oauth = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!oauth.ok) return response(502, { error: 'Could not obtain FCM access token.' });
  const oauthJson = await oauth.json() as { access_token: string };

  const unregistered: string[] = [];
  let sent = 0;
  const notificationType = String(record.type ?? '');
  for (const tokenRow of tokens ?? []) {
    const token = tokenRow.token as string;
    const soundPreferences = soundPreferencesByUser.get(tokenRow.user_id);
    const requestedSound = notificationType.startsWith('void_')
      ? soundPreferences?.void_sound
      : soundPreferences?.general_sound;
    const soundId = resolveNotificationSoundId(notificationType, requestedSound);
    const channelId = channelForType(notificationType, soundId);
    const fcm = await fetch(`https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${oauthJson.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: {
            title: String(record.title ?? '7anouti-POS'),
            body: String(record.body ?? ''),
          },
          android: {
            priority: 'HIGH',
            notification: {
              channel_id: channelId,
              icon: 'ic_stat_notification',
              color: '#238636',
              image: 'https://hanoutipos.vercel.app/notification-logo.png',
            },
          },
          data: {
            notificationId: String(record.id ?? ''),
            route: '/notifications',
            channel_id: channelId,
          },
        },
      }),
    });
    if (fcm.ok) sent += 1;
    else {
      const errorText = await fcm.text();
      if (errorText.includes('NOT_FOUND') || errorText.includes('UNREGISTERED')) unregistered.push(token);
    }
  }
  if (unregistered.length > 0) {
    await admin.from('device_tokens').delete().in('token', unregistered);
  }
  return response(200, { sent, removed: unregistered.length });
});
