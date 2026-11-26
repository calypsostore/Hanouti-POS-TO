import type { UserSummary } from '../types/domain';

export type CredentialSetupStep = 'password' | 'personal-pin' | 'store-pin' | 'complete';

type CredentialSetupUser = Pick<UserSummary, 'role' | 'mustChangePassword' | 'mustSetPin' | 'mustSetVoidPin'>;

export function getCredentialSetupStep(user: CredentialSetupUser | null | undefined): CredentialSetupStep {
  if (!user) return 'complete';
  if (user.mustChangePassword) return 'password';
  if (user.role === 'owner' && user.mustSetPin) return 'personal-pin';
  if (user.role === 'owner' && user.mustSetVoidPin) return 'store-pin';
  return 'complete';
}

export function requiresCredentialSetup(user: CredentialSetupUser | null | undefined): boolean {
  return getCredentialSetupStep(user) !== 'complete';
}

export function isValidPinConfirmation(pin: string, confirmation: string): boolean {
  return /^\d{4}$/.test(pin) && pin === confirmation;
}
