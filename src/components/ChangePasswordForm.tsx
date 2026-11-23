import { useState, type FormEvent } from 'react';
import { Button } from './Button';
import { authService } from '../services/authService';
import { useAuthStore } from '../stores/authStore';
import { t } from '../i18n/translations';
import { SettingsGlassSection } from './settings/SettingsGlassSection';

interface ChangePasswordFormProps {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export function ChangePasswordForm({ onError, onNotice }: ChangePasswordFormProps) {
  const user = useAuthStore((state) => state.user);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError('');
    onNotice('');
    if (newPassword !== confirmation) {
      onError('New passwords do not match.');
      return;
    }
    if (!user) return;
    try {
      await authService.changePassword(user.id, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      onNotice(t('settings.passwordChanged'));
    } catch (passwordError) {
      onError(passwordError instanceof Error ? passwordError.message : 'Unable to change password.');
    }
  }

  return (
    <SettingsGlassSection heading={t('settings.password')} description="Update the password used to access your account." icon="lock_reset">
      <form onSubmit={(event) => { void changePassword(event); }} className="settings-glass-form flex flex-col gap-3">
      <label className="font-body text-label-md">{t('settings.currentPassword')}<input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
      <label className="font-body text-label-md">{t('settings.newPassword')}<input required minLength={6} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
      <label className="font-body text-label-md">{t('settings.confirmPassword')}<input required minLength={6} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
      <Button type="submit" className="self-start">{t('settings.password')}</Button>
      </form>
    </SettingsGlassSection>
  );
}
