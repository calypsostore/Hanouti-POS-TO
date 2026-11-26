import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const authHelperPath = fileURLToPath(new URL('../supabase/functions/_shared/deviceAuth.ts', import.meta.url));
const deviceSessionPath = fileURLToPath(new URL('../supabase/functions/device-session/index.ts', import.meta.url));
const manageDevicesPath = fileURLToPath(new URL('../supabase/functions/manage-devices/index.ts', import.meta.url));

describe('device Edge Function bearer verification', () => {
  it('passes the supplied bearer token when verifying device and owner callers', () => {
    const source = readFileSync(authHelperPath, 'utf8');

    expect(source).toContain('caller.auth.getUser(token)');
    expect(source).toContain('ownerClient.auth.getUser(token)');
  });

  it('only confirms device password setup when the active device row still matches', () => {
    const source = readFileSync(deviceSessionPath, 'utf8');

    expect(source).toContain(".eq('session_version', context.device.session_version)");
    expect(source).toContain(".eq('is_active', true)");
    expect(source).toContain('if (!updatedDevice) throw new HttpError(409');
  });

  it('limits device listing queries to store-scoped pages', () => {
    const source = readFileSync(manageDevicesPath, 'utf8');

    expect(source).toContain(".eq('store_id', storeId)");
    expect(source).toContain("{ count: 'exact' }");
    expect(source).toContain('.range(offset, offset + limit - 1)');
    expect(source).toContain('limit > 50');
  });
});
