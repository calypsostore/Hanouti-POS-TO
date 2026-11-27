import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDevicePinAutoLoginPreference,
  setDevicePinAutoLoginPreference,
  shouldAutoLoginWithDevicePin,
} from '../src/services/devicePinPreferences';

describe('device PIN login preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('window', { localStorage });
  });

  it('persists the auto-login preference per device', () => {
    expect(getDevicePinAutoLoginPreference()).toBe(false);

    setDevicePinAutoLoginPreference(true);
    expect(getDevicePinAutoLoginPreference()).toBe(true);

    setDevicePinAutoLoginPreference(false);
    expect(getDevicePinAutoLoginPreference()).toBe(false);
  });

  it('auto-submits only a complete four-digit PIN when enabled', () => {
    expect(shouldAutoLoginWithDevicePin('123', true)).toBe(false);
    expect(shouldAutoLoginWithDevicePin('1234', true)).toBe(true);
    expect(shouldAutoLoginWithDevicePin('12a4', true)).toBe(false);
    expect(shouldAutoLoginWithDevicePin('1234', false)).toBe(false);
  });
});
