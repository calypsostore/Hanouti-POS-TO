const DEVICE_PIN_AUTO_LOGIN_KEY = '7anouti-pos:device-pin-auto-login';

export function getDevicePinAutoLoginPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(DEVICE_PIN_AUTO_LOGIN_KEY) === 'true';
  } catch (error) {
    console.error('[devices] Could not read the PIN sign-in preference.', error);
    return false;
  }
}

export function setDevicePinAutoLoginPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DEVICE_PIN_AUTO_LOGIN_KEY, String(enabled));
}

export function shouldAutoLoginWithDevicePin(pin: string, enabled: boolean): boolean {
  return enabled && /^\d{4}$/.test(pin);
}
