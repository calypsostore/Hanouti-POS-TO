import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { useAuthStore } from '../stores/authStore';
import { userService } from '../services/userService';
import { t } from '../i18n/translations';

export function SetNewPasswordScreen() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const setInitialPassword = useAuthStore((state) => state.setInitialPassword);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');

  const longEnough = password.length >= 6;
  const matching = password.length > 0 && password === confirmation;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!longEnough) {
      setError(t('password.useSixCharacters'));
      return;
    }
    if (!matching) {
      setError(t('password.mismatch'));
      return;
    }
    setError('');
    try {
      await setInitialPassword(password);
      if (!user) throw new Error(t('auth.signInBeforePassword'));
      navigate(user.role === 'staff' ? '/pos' : user.role === 'owner' ? '/owner/dashboard' : '/admin/stores');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('password.unableToUpdate'));
    }
  }

  const accountName = user?.username ?? user?.email ?? '';
  const [store, setStore] = useState<Awaited<ReturnType<typeof userService.getStore>>>();
  useEffect(() => {
    if (user?.storeId) void userService.getStore(user.storeId).then(setStore);
  }, [user?.storeId]);
  const accountRole = user?.role === 'staff' ? t('password.verifiedStaff') : user?.role === 'owner' ? t('password.verifiedOwner') : t('password.verifiedAdmin');

  return (
    <main className="min-h-screen bg-gradient-to-b from-surface via-surface-container-low to-surface px-4 pb-8 pt-3">
      <div className="mx-auto flex w-full max-w-xl flex-col">
        <div className="flex items-center justify-between py-2">
          <button type="button" aria-label={t('common.back')} onClick={() => navigate('/')} className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-container-lowest text-primary shadow-card">
            <MaterialIcon name="arrow_back" />
          </button>
          <span className="w-12" />
        </div>

        <header className="mb-6 mt-3 flex flex-col items-center text-center">
          <div className="relative mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary-fixed text-primary shadow-card">
            <MaterialIcon name="shield_locked" className="text-[42px]" filled />
            <span className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-success-dark text-white shadow-card">
              <MaterialIcon name="key" className="text-base" />
            </span>
          </div>
          <h1 className="font-display text-headline-lg text-on-surface">{t('password.setNew')}</h1>
          <p className="mt-1.5 max-w-sm font-body text-body-md text-on-surface-variant">
            {t('password.firstLoginRequirement', { account: user?.role === 'staff' ? t('password.storeTerminal') : t('password.account') })}
          </p>
        </header>

        <section className="mb-5 rounded-xl bg-surface-container-lowest p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-body text-label-sm uppercase tracking-wider text-outline">{t('password.storeAccount')}</span>
            <span className="font-body text-label-sm text-on-surface-variant">{accountRole}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-container text-primary">
              <MaterialIcon name="lock_person" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-headline-sm text-on-surface">{accountName}</p>
              <p className="flex items-center gap-1 truncate font-body text-body-sm text-on-surface-variant">
                <MaterialIcon name="storefront" className="text-sm text-outline" />
                {store?.name ?? '7anouti Platform'}
              </p>
            </div>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="new-password" className="mb-1.5 flex items-center justify-between font-body text-label-lg text-on-surface">
              {t('password.newPassword')}
              <span className="font-body text-label-sm text-outline">{t('password.minimumCharacters')}</span>
            </label>
            <div className="relative">
              <MaterialIcon name="lock_reset" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[22px] text-primary" />
              <input
                id="new-password"
                autoComplete="new-password"
                required
                minLength={6}
                type={visible ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t('password.enterNew')}
                className="h-14 w-full rounded-xl bg-surface-container-lowest pl-12 pr-14 font-body text-title-md tracking-wider shadow-card outline-none focus:ring-2 focus:ring-primary"
              />
              <button type="button" aria-label={t('password.toggleVisibility')} onClick={() => setVisible((value) => !value)} className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-outline">
                <MaterialIcon name={visible ? 'visibility_off' : 'visibility'} />
              </button>
            </div>
            <div className="mt-3 flex gap-2 px-1">
              {[0, 1, 2].map((index) => (
                <span key={index} className={`h-1.5 flex-1 rounded-full ${password.length >= 6 + index * 3 ? 'bg-success-dark' : 'bg-surface-container-highest'}`} />
              ))}
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className={`flex items-center gap-1 font-body text-label-sm ${longEnough ? 'text-success-dark' : 'text-outline'}`}>
                <MaterialIcon name={longEnough ? 'check_circle' : 'info'} className="text-sm" filled={longEnough} />
                {longEnough ? t('password.passwordMeetsRequirements') : t('password.atLeastSix')}
              </span>
            </div>
          </div>

          <div>
            <label htmlFor="confirm-password" className="mb-1.5 block font-body text-label-lg text-on-surface">{t('password.confirm')}</label>
            <div className="relative">
              <MaterialIcon name="verified_user" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[22px] text-primary" />
              <input
                id="confirm-password"
                autoComplete="new-password"
                required
                type={visible ? 'text' : 'password'}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder={t('password.reenter')}
                className="h-14 w-full rounded-xl bg-surface-container-lowest pl-12 pr-12 font-body text-title-md tracking-wider shadow-card outline-none focus:ring-2 focus:ring-primary"
              />
              {matching && <MaterialIcon name="check_circle" className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[22px] text-success-dark" filled />}
            </div>
          </div>

          <section className="flex flex-col gap-2 rounded-xl bg-surface-container-low p-4">
            <h2 className="mb-0.5 font-body text-label-sm uppercase tracking-wider text-outline">{t('password.rules')}</h2>
            <p className="flex items-center gap-2 font-body text-body-sm"><MaterialIcon name={longEnough ? 'check_circle' : 'radio_button_unchecked'} className={longEnough ? 'text-lg text-success-dark' : 'text-lg text-outline'} />{t('password.atLeastSix')}</p>
            <p className="flex items-center gap-2 font-body text-body-sm"><MaterialIcon name="check_circle" className="text-lg text-success-dark" />{t('password.easyToRemember')}</p>
            <p className="flex items-center gap-2 font-body text-body-sm"><MaterialIcon name={matching ? 'check_circle' : 'radio_button_unchecked'} className={matching ? 'text-lg text-success-dark' : 'text-lg text-outline'} />{t('password.match')}</p>
          </section>

          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit" disabled={!matching || !longEnough} className="mt-1 min-h-14 w-full text-body-lg">
            <MaterialIcon name="check" filled />
            {t('password.saveContinue')}
          </Button>
        </form>

        <footer className="mt-6 flex flex-col items-center text-center">
          <p className="flex items-center gap-1.5 font-body text-body-sm text-on-surface-variant">
            <MaterialIcon name="support_agent" className="text-lg text-secondary" />
            {t('password.needAssistance')}
          </p>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('password.contactAdministrator')}</p>
        </footer>
      </div>
    </main>
  );
}
