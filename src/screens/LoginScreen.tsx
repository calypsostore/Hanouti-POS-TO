import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { t } from '../i18n/translations';
import { updateService } from '../services/updateService';
import { useAuthStore } from '../stores/authStore';

type LoginRole = 'staff' | 'admin';

export function LoginScreen() {
  const navigate = useNavigate();
  const [role, setRole] = useState<LoginRole>('staff');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const login = useAuthStore((state) => state.login);

  function chooseRole(nextRole: LoginRole) {
    setRole(nextRole);
    setIdentifier('');
    setPassword('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const allowedRoles = role === 'staff' ? ['staff'] as const : ['owner', 'super_admin'] as const;
      const user = await login(identifier, password, [...allowedRoles]);
      navigate(user.mustChangePassword ? '/set-password' : user.role === 'staff' ? '/dashboard' : user.role === 'owner' ? '/owner/dashboard' : '/admin/overview');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : t('login.unableToSignIn'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-main">
      <div className="login-decoration login-decoration--northwest" aria-hidden="true" />
      <div className="login-decoration login-decoration--northeast" aria-hidden="true" />
      <div className="login-decoration login-decoration--southeast" aria-hidden="true" />
      <div className="login-decoration login-decoration--southwest" aria-hidden="true" />
      <span className="login-bubble login-bubble--one" aria-hidden="true" />
      <span className="login-bubble login-bubble--two" aria-hidden="true" />
      <span className="login-bubble login-bubble--three" aria-hidden="true" />

      <div className="login-content">
        <header className="login-brand">
          <span className="login-version">
            {t('login.versionLabel', { version: updateService.getCurrentVersion() })}
          </span>
          <div className="login-logo-orbit">
            <div className="login-logo-frame">
              <img src="/logo1.png" alt="7anouti" />
            </div>
          </div>
          <h1 className="login-title">
            7anouti<span>-POS</span>
          </h1>
          <p className="login-tagline">{t('login.tagline')}</p>
        </header>

        <div className="login-role-switch" role="group" aria-label="Choose account type">
          <span
            className={`login-role-indicator${role === 'staff' ? ' login-role-indicator--staff' : ''}`}
            aria-hidden="true"
          />
          <button
            type="button"
            aria-pressed={role === 'admin'}
            onClick={() => chooseRole('admin')}
            className={`login-role-button${role === 'admin' ? ' is-selected' : ''}`}
          >
            <MaterialIcon name="storefront" />
            {t('login.ownerAdmin')}
          </button>
          <button
            type="button"
            aria-pressed={role === 'staff'}
            onClick={() => chooseRole('staff')}
            className={`login-role-button${role === 'staff' ? ' is-selected' : ''}`}
          >
            <MaterialIcon name="badge" filled={role === 'staff'} />
            {t('common.staff')}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="login-card">
          <div className="login-field">
            <div className="login-field-heading">
              <label htmlFor="identifier" className="login-label">
                <MaterialIcon name={role === 'staff' ? 'account_circle' : 'storefront'} />
                {role === 'staff' ? t('login.staffIdentifier') : t('login.adminIdentifier')}
              </label>
              <span className="login-field-helper">
                {role === 'staff' ? t('login.exampleStaff') : t('login.emailAddress')}
              </span>
            </div>
            <div className="login-input-wrap">
              <MaterialIcon name={role === 'staff' ? 'person' : 'mail'} className="login-input-icon" />
              <input
                autoComplete="username"
                id="identifier"
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder={role === 'staff' ? t('login.exampleStaff') : t('login.identifierPlaceholder')}
                className="login-input"
              />
            </div>
            {role === 'staff' && (
              <p className="login-staff-hint">
                <MaterialIcon name="info" />
                {t('login.staffFormat')}
              </p>
            )}
          </div>

          <div className="login-field">
            <div className="login-field-heading">
              <label htmlFor="password" className="login-label">
                <MaterialIcon name="lock" />
                {t('login.password')}
              </label>
              <button
                type="button"
                onClick={() => setVisible((value) => !value)}
                className="login-visibility"
                aria-label={visible ? t('common.hide') : t('common.show')}
              >
                <MaterialIcon name={visible ? 'visibility_off' : 'visibility'} />
                <span>{visible ? t('common.hide') : t('common.show')}</span>
              </button>
            </div>
            <div className="login-input-wrap">
              <MaterialIcon name="lock" className="login-input-icon" />
              <input
                autoComplete="current-password"
                id="password"
                required
                type={visible ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t('login.enterPassword')}
                className="login-input login-input--password"
              />
            </div>
          </div>

          <div className="login-remember">
            <div>
              <p className="login-remember-title">{t('login.rememberTerminal')}</p>
              <p className="login-remember-subtitle">{t('login.keepUnlocked')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={remember}
              aria-label={t('login.rememberTerminal')}
              onClick={() => setRemember((value) => !value)}
              className={`login-toggle${remember ? ' is-on' : ''}`}
            >
              <span />
            </button>
          </div>

          {error && <p role="alert" className="login-error">{error}</p>}
          <Button type="submit" disabled={submitting} className="login-submit">
            {submitting ? t('login.verifying') : t('login.logIn')}
            <MaterialIcon name={submitting ? 'sync' : 'arrow_forward'} className={submitting ? 'is-spinning' : ''} />
          </Button>
        </form>

        <footer className="login-footer">
          <MaterialIcon name="admin_panel_settings" />
          <span>{t('login.noAccount')}</span>
        </footer>
      </div>
    </main>
  );
}
