import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import capacitorConfig from '../capacitor.config';

describe('Android production configuration', () => {
  it('loads the production website over HTTPS and disables cleartext traffic', () => {
    expect(capacitorConfig.server?.url).toBe('https://hanouti-pos.tn');
    expect(capacitorConfig.server?.androidScheme).toBe('https');
    expect(capacitorConfig.server?.cleartext).toBe(false);

    const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
  });
});
