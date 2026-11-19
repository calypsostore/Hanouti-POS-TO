import { describe, expect, it } from 'vitest';
import { isUpdateCheckDue, parseAppUpdateManifest } from '../src/services/appUpdateManifest';

describe('parseAppUpdateManifest', () => {
  const repository = 'calypsostore/Hanouti-POS-TO';

  it('accepts a valid version manifest for the configured repository', () => {
    expect(parseAppUpdateManifest({
      versionCode: 10001,
      versionName: '1.0.1',
      apkUrl: 'https://github.com/calypsostore/Hanouti-POS-TO/releases/download/v1.0.1/7anouti-POS-v1.0.1.apk',
      notes: 'Bug fixes',
    }, repository)?.versionCode).toBe(10001);
  });

  it('rejects invalid versions and APK URLs outside the configured repository', () => {
    expect(parseAppUpdateManifest({
      versionCode: 10001,
      versionName: 'invalid',
      apkUrl: 'https://github.com/calypsostore/Hanouti-POS-TO/releases/download/v1.0.1/app.apk',
      notes: '',
    }, repository)).toBeNull();
    expect(parseAppUpdateManifest({
      versionCode: 10001,
      versionName: '1.0.1',
      apkUrl: 'https://example.com/app.apk',
      notes: '',
    }, repository)).toBeNull();
  });
});

describe('isUpdateCheckDue', () => {
  const now = Date.parse('2026-11-19T12:00:00.000Z');
  const sixHours = 6 * 60 * 60 * 1000;

  it('checks when there is no prior timestamp or the interval elapsed', () => {
    expect(isUpdateCheckDue(null, now, sixHours)).toBe(true);
    expect(isUpdateCheckDue(new Date(now - sixHours).toISOString(), now, sixHours)).toBe(true);
  });

  it('does not check again inside the interval', () => {
    expect(isUpdateCheckDue(new Date(now - sixHours + 1).toISOString(), now, sixHours)).toBe(false);
  });

  it('treats a malformed timestamp as due', () => {
    expect(isUpdateCheckDue('not-a-date', now, sixHours)).toBe(true);
  });
});
