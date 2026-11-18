import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { useAuthStore } from '../stores/authStore';

type LoginRole = 'staff' | 'admin';

export function LoginScreen() {
  const navigate = useNavigate();
  const [role, setRole] = useState<LoginRole>('staff');
  const [identifier, setIdentifier] = useState('cafe12.sarah');
  const [password, setPassword] = useState('1234');
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const login = useAuthStore((state) => state.login);

  function chooseRole(nextRole: LoginRole) {
    setRole(nextRole);
    setIdentifier(nextRole === 'staff' ? 'cafe12.sarah' : 'owner@cafelamarsa.tn');
    setPassword('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const allowedRoles = role === 'staff' ? ['staff'] as const : ['owner', 'super_admin'] as const;
      const user = await login(identifier, password, [...allowedRoles]);
      navigate(user.mustChangePassword ? '/set-password' : user.role === 'staff' ? '/pos' : user.role === 'owner' ? '/owner/dashboard' : '/admin/stores');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-b from-surface via-surface-container-low to-surface px-4 pb-8 pt-5 text-on-surface">
      <div className="pointer-events-none absolute -right-20 top-8 h-64 w-64 rounded-full bg-primary-fixed/30 blur-3xl" />
      <div className="pointer-events-none absolute -left-20 top-1/3 h-56 w-56 rounded-full bg-secondary-container/10 blur-3xl" />
      <div className="relative mx-auto flex w-full max-w-xl flex-col">
        <header className="flex flex-col items-center pb-5 pt-4 text-center">
          <div className="relative mb-3 flex h-20 w-20 items-center justify-center rounded-2xl bg-surface-container-lowest p-3 shadow-card">
            <MaterialIcon name="local_cafe" className="text-5xl text-primary" filled />
            <span className="absolute -right-3 -top-2 rounded-full bg-success px-3 py-1 font-body text-label-sm text-on-surface">
              POS v2.4
            </span>
          </div>
          <h1 className="font-display text-headline-xl-mobile text-on-surface">
            7anouti<span className="text-primary">-POS</span>
          </h1>
          <p className="mt-1 font-body text-body-lg text-on-surface-variant">Fast orders. Clear shifts.</p>
        </header>

        <div className="mb-4 flex items-center gap-1 rounded-xl bg-surface-container-high p-1 shadow-inner">
          <button
            type="button"
            onClick={() => chooseRole('admin')}
            className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg px-2 font-body text-label-lg transition active:scale-[0.98] ${
              role === 'admin' ? 'bg-primary text-on-primary shadow-card' : 'text-on-surface-variant'
            }`}
          >
            <MaterialIcon name="storefront" className="text-lg" />
            Owner / Super Admin
          </button>
          <button
            type="button"
            onClick={() => chooseRole('staff')}
            className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg px-2 font-body text-label-lg transition active:scale-[0.98] ${
              role === 'staff' ? 'bg-primary text-on-primary shadow-card' : 'text-on-surface-variant'
            }`}
          >
            <MaterialIcon name="badge" className="text-lg" filled={role === 'staff'} />
            Staff
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            chooseRole('staff');
            setPassword('1234');
          }}
          className="mb-4 flex min-h-12 items-center justify-between gap-2 rounded-xl bg-surface-container-low px-4 py-2.5 text-left shadow-card active:bg-surface-container"
        >
          <span className="flex min-w-0 items-center gap-2">
            <MaterialIcon name="bolt" className="shrink-0 text-xl text-secondary" filled />
            <span className="truncate font-body text-body-sm text-on-surface">
              Quick test PIN: <strong className="text-primary">1234</strong> (Staff: cafe12.sarah)
            </span>
          </span>
          <span className="rounded-md bg-primary-fixed/40 px-2 py-1 font-body text-label-sm text-primary">FILL</span>
        </button>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-2xl bg-surface-container-lowest p-4 shadow-sheet">
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor="identifier" className="flex items-center gap-1 font-body text-label-md text-on-surface">
                <MaterialIcon name={role === 'staff' ? 'account_circle' : 'storefront'} className="text-base text-primary" />
                {role === 'staff' ? 'Staff Username & Store Code' : 'Owner / Super Admin Email'}
              </label>
              <span className="shrink-0 font-body text-label-sm text-outline">{role === 'staff' ? 'e.g. cafe12.sarah' : 'email address'}</span>
            </div>
            <div className="relative">
              <MaterialIcon name={role === 'staff' ? 'person' : 'mail'} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xl text-on-surface-variant" />
              <input
                autoComplete="username"
                id="identifier"
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder={role === 'staff' ? 'cafe12.sarah' : 'owner@7anouti.tn'}
                className="h-14 w-full rounded-xl bg-surface-container-low pl-12 pr-4 font-body text-body-lg text-on-surface shadow-card outline-none transition focus:bg-white focus:ring-2 focus:ring-primary"
              />
            </div>
            {role === 'staff' && (
              <p className="mt-1.5 flex items-center gap-1 font-body text-body-sm text-on-surface-variant">
                <MaterialIcon name="info" className="text-sm text-primary" />
                Format: [Store Code].[Staff Name]
              </p>
            )}
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="password" className="flex items-center gap-1 font-body text-label-md text-on-surface">
                <MaterialIcon name="pin" className="text-base text-primary" />
                Password
              </label>
              <button type="button" onClick={() => setVisible((value) => !value)} className="flex min-h-10 items-center gap-1 text-primary">
                <MaterialIcon name={visible ? 'visibility_off' : 'visibility'} className="text-lg" />
                <span className="font-body text-label-md">{visible ? 'Hide' : 'Show'}</span>
              </button>
            </div>
            <div className="relative">
              <MaterialIcon name="lock" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xl text-on-surface-variant" />
              <input
                autoComplete="current-password"
                id="password"
                required
                type={visible ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                className="h-14 w-full rounded-xl bg-surface-container-low pl-12 pr-4 font-body text-body-lg tracking-widest text-on-surface shadow-card outline-none transition focus:bg-white focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <div>
              <p className="font-body text-label-md text-on-surface">Remember on this terminal</p>
              <p className="font-body text-body-sm text-on-surface-variant">Keep register unlocked for current shift</p>
            </div>
            <button
              type="button"
              aria-pressed={remember}
              onClick={() => setRemember((value) => !value)}
              className={`relative h-7 w-12 shrink-0 rounded-full p-0.5 shadow-inner transition ${remember ? 'bg-primary' : 'bg-surface-container-highest'}`}
            >
              <span className={`block h-6 w-6 rounded-full bg-white transition ${remember ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit" disabled={submitting} className="mt-1 min-h-[54px] w-full rounded-xl text-body-lg">
            {submitting ? 'Verifying...' : 'Log in'} <MaterialIcon name={submitting ? 'sync' : 'arrow_forward'} className={`text-xl ${submitting ? 'animate-spin' : ''}`} />
          </Button>
        </form>

        <footer className="mt-5 flex flex-col items-center gap-3 text-center">
          <p className="flex items-center gap-1.5 font-body text-body-sm text-on-surface-variant">
            <MaterialIcon name="admin_panel_settings" className="text-base text-outline" />
            No account? Contact your 7anouti administrator.
          </p>
          <div className="flex items-center gap-3 font-body text-label-sm text-on-surface-variant">
            <span className="flex items-center gap-1 rounded-md bg-surface-container-high px-2 py-1">
              <span className="h-2 w-2 rounded-full bg-success" />
              Tunis-Station #04
            </span>
            <span className="text-outline">•</span>
            <span className="flex items-center gap-1">
              <MaterialIcon name="wifi" className="text-sm text-success-dark" />
              Sync: Ready
            </span>
          </div>
        </footer>
      </div>
    </main>
  );
}
