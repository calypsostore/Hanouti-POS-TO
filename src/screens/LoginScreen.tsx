import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { t } from '../i18n/translations';
import { useAuthStore } from '../stores/authStore';
import { requiresCredentialSetup } from '../services/credentialSetup';
import apk1Logo from '../../logos/apk1.png';

type LoginRole = 'staff' | 'admin';

const LATEST_APK_URL = 'https://github.com/calypsostore/Hanouti-POS-TO/releases/download/v1.0.6/7anouti-POS-v1.0.6.apk';

interface LoginLogoMotion {
  x: number;
  y: number;
  size: number;
  rotation: number;
  dragging: boolean;
}

export function LoginScreen() {
  const navigate = useNavigate();
  const [role, setRole] = useState<LoginRole>('staff');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [apkTouchCount, setApkTouchCount] = useState(0);
  const login = useAuthStore((state) => state.login);
  const [logoMotion, setLogoMotion] = useState<LoginLogoMotion | null>(null);
  const logoPhysics = useRef({
    x: 0,
    y: 0,
    size: 0,
    rotation: 0,
    velocityX: 0,
    velocityY: 0,
    dragOffsetX: 0,
    dragOffsetY: 0,
    startX: 0,
    startY: 0,
    lastPointerX: 0,
    lastPointerY: 0,
    lastPointerTime: 0,
    lastFrameTime: 0,
    pointerId: null as number | null,
    dragging: false,
    moved: false,
    animationFrame: 0,
  });

  useEffect(() => () => cancelAnimationFrame(logoPhysics.current.animationFrame), []);

  function publishLogoMotion(dragging: boolean) {
    const motion = logoPhysics.current;
    setLogoMotion({
      x: motion.x,
      y: motion.y,
      size: motion.size,
      rotation: motion.rotation,
      dragging,
    });
  }

  function handleLogoPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const motion = logoPhysics.current;
    const bounds = event.currentTarget.getBoundingClientRect();
    const alreadyMoving = logoMotion !== null;
    if (motion.animationFrame) cancelAnimationFrame(motion.animationFrame);
    motion.animationFrame = 0;
    motion.x = alreadyMoving ? motion.x : bounds.left;
    motion.y = alreadyMoving ? motion.y : bounds.top;
    motion.size = alreadyMoving ? motion.size : Number.parseFloat(window.getComputedStyle(event.currentTarget).width);
    motion.startX = motion.x;
    motion.startY = motion.y;
    motion.dragOffsetX = event.clientX - motion.x;
    motion.dragOffsetY = event.clientY - motion.y;
    motion.lastPointerX = event.clientX;
    motion.lastPointerY = event.clientY;
    motion.lastPointerTime = performance.now();
    motion.velocityX = 0;
    motion.velocityY = 0;
    motion.pointerId = event.pointerId;
    motion.dragging = true;
    motion.moved = false;
    publishLogoMotion(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleLogoPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const motion = logoPhysics.current;
    if (!motion.dragging || motion.pointerId !== event.pointerId) return;
    event.preventDefault();
    const now = performance.now();
    const elapsed = Math.max(1, now - motion.lastPointerTime);
    const deltaX = event.clientX - motion.lastPointerX;
    const deltaY = event.clientY - motion.lastPointerY;
    motion.velocityX = deltaX / elapsed;
    motion.velocityY = deltaY / elapsed;
    motion.x = Math.min(Math.max(0, event.clientX - motion.dragOffsetX), Math.max(0, window.innerWidth - motion.size));
    motion.y = Math.min(Math.max(0, event.clientY - motion.dragOffsetY), Math.max(0, window.innerHeight - motion.size));
    motion.moved ||= Math.hypot(motion.x - motion.startX, motion.y - motion.startY) > 3;
    motion.lastPointerX = event.clientX;
    motion.lastPointerY = event.clientY;
    motion.lastPointerTime = now;
    publishLogoMotion(true);
  }

  function handleLogoPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const motion = logoPhysics.current;
    if (!motion.dragging || motion.pointerId !== event.pointerId) return;
    motion.dragging = false;
    motion.pointerId = null;

    if (motion.moved) {
      motion.velocityX = Math.max(-2.8, Math.min(2.8, motion.velocityX * 1.35));
      motion.velocityY = Math.max(-2.8, Math.min(2.8, motion.velocityY * 1.35));
      if (Math.hypot(motion.velocityX, motion.velocityY) < 0.5) {
        const travelX = motion.x - motion.startX;
        const travelY = motion.y - motion.startY;
        const distance = Math.hypot(travelX, travelY);
        if (distance > 0) {
          motion.velocityX = travelX / distance * 0.85;
          motion.velocityY = travelY / distance * 0.85;
        }
      }
    } else {
      motion.velocityX = 0;
      motion.velocityY = 0;
    }
    motion.lastFrameTime = performance.now();

    const bounce = (timestamp: number) => {
      const delta = Math.min(32, Math.max(0, timestamp - motion.lastFrameTime));
      motion.lastFrameTime = timestamp;
      motion.velocityY = Math.min(3.2, motion.velocityY + 0.0015 * delta);
      motion.x += motion.velocityX * delta;
      motion.y += motion.velocityY * delta;

      const maxX = Math.max(0, window.innerWidth - motion.size);
      const maxY = Math.max(0, window.innerHeight - motion.size);
      if (maxX === 0) {
        motion.x = 0;
        motion.velocityX = 0;
      } else if (motion.x <= 0 || motion.x >= maxX) {
        motion.x = Math.min(maxX, Math.max(0, motion.x));
        motion.velocityX *= -0.82;
      }
      if (motion.y <= 0) {
        motion.y = 0;
        motion.velocityY = Math.abs(motion.velocityY) * 0.82;
      } else if (motion.y >= maxY) {
        motion.y = Math.min(maxY, Math.max(0, motion.y));
        motion.velocityY = motion.velocityY > 0.28 ? -motion.velocityY * 0.62 : 0;
      }

      const onGround = motion.y >= maxY && motion.velocityY === 0;
      motion.velocityX *= Math.pow(onGround ? 0.999 : 0.9997, delta);
      motion.velocityY *= Math.pow(0.9995, delta);
      motion.rotation += (motion.velocityX - motion.velocityY) * delta * 0.12;
      publishLogoMotion(false);

      if (onGround && Math.abs(motion.velocityX) < 0.025) {
        motion.velocityX = 0;
        motion.animationFrame = 0;
        publishLogoMotion(false);
        return;
      }
      motion.animationFrame = requestAnimationFrame(bounce);
    };

    publishLogoMotion(false);
    motion.animationFrame = requestAnimationFrame(bounce);
  }

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
      const identifierIsEmail = identifier.trim().includes('@');
      const allowedRoles = identifierIsEmail
        ? ['owner', 'super_admin'] as const
        : ['staff'] as const;
      const user = await login(identifier, password, [...allowedRoles]);
      navigate(requiresCredentialSetup(user) ? '/set-password' : user.role === 'staff' ? '/dashboard' : user.role === 'owner' ? '/owner/dashboard' : '/admin/overview');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : t('login.unableToSignIn'));
    } finally {
      setSubmitting(false);
    }
  }

  const apkSpeech = apkTouchCount === 1
    ? t('login.apkTapPrompt')
    : apkTouchCount === 2
      ? t('login.apkJokeOne')
      : apkTouchCount === 3
        ? t('login.apkJokeTwo')
        : apkTouchCount === 4
          ? t('login.apkJokeThree')
          : null;

  return (
    <main className="login-main">
      <div className="login-apk-widget">
        <button
          type="button"
          className="login-apk-logo"
          aria-label={t('login.apkLogoTapLabel')}
          aria-controls="login-apk-speech"
          aria-expanded={apkSpeech !== null}
          aria-describedby={apkSpeech !== null ? 'login-apk-speech' : undefined}
          onClick={() => setApkTouchCount((count) => Math.min(count + 1, 4))}
          disabled={apkTouchCount >= 4}
        >
          <img src={apk1Logo} alt="" draggable={false} />
        </button>
        {apkSpeech !== null && (
          <div
            key={apkTouchCount}
            id="login-apk-speech"
            className="login-apk-speech"
            role="status"
            aria-live="polite"
          >
            {apkSpeech}
          </div>
        )}
      </div>
      <div className="login-decoration login-decoration--northwest" aria-hidden="true" />
      <div className="login-decoration login-decoration--northeast" aria-hidden="true" />
      <div className="login-decoration login-decoration--southeast" aria-hidden="true" />
      <div className="login-decoration login-decoration--southwest" aria-hidden="true" />
      <span className="login-bubble login-bubble--one" aria-hidden="true" />
      <span className="login-bubble login-bubble--two" aria-hidden="true" />
      <span className="login-bubble login-bubble--three" aria-hidden="true" />

      <div className={`login-content${logoMotion ? ' login-content--logo-playing' : ''}`}>
        <header className="login-brand">
          <span className="login-version">
            {t('login.versionLabel', { version: __APP_VERSION__ })}
          </span>
          <div className={`login-logo-orbit${logoMotion ? ' login-logo-orbit--playing' : ''}`}>
            <div
              className={`login-logo-frame${logoMotion ? ' login-logo-frame--active' : ''}${logoMotion?.dragging ? ' is-dragging' : ''}`}
              style={logoMotion ? {
                position: 'fixed',
                left: logoMotion.x,
                top: logoMotion.y,
                width: logoMotion.size,
                height: logoMotion.size,
                zIndex: 100,
                transform: `rotate(${logoMotion.rotation}deg)`,
              } : undefined}
              onPointerDown={handleLogoPointerDown}
              onPointerMove={handleLogoPointerMove}
              onPointerUp={handleLogoPointerEnd}
              onPointerCancel={handleLogoPointerEnd}
              onDragStart={(event) => event.preventDefault()}
            >
              <img src="/logo1.png" alt="7anouti" draggable={false} />
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
              {role === 'admin' && <span className="login-field-helper">{t('login.emailAddress')}</span>}
            </div>
            <div className="login-input-wrap">
              <MaterialIcon name={role === 'staff' ? 'person' : 'mail'} className="login-input-icon" />
              <input
                autoComplete="username"
                id="identifier"
                required
                value={identifier}
                onChange={(event) => {
                  const nextIdentifier = event.target.value;
                  setIdentifier(nextIdentifier);
                  setRole(nextIdentifier.trim().includes('@') ? 'admin' : role === 'admin' && nextIdentifier.trim() === '' ? 'staff' : role);
                }}
                placeholder={role === 'staff' ? t('login.exampleStaff') : t('login.identifierPlaceholder')}
                className="login-input"
              />
            </div>
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
            <ToggleSwitch
              checked={remember}
              label={t('login.rememberTerminal')}
              onChange={() => setRemember((value) => !value)}
            />
          </div>

          {error && <p role="alert" className="login-error">{error}</p>}
          <Button type="submit" disabled={submitting} className="login-submit">
            {submitting ? t('login.verifying') : t('login.logIn')}
            <MaterialIcon name={submitting ? 'sync' : 'arrow_forward'} className={submitting ? 'is-spinning' : ''} />
          </Button>
        </form>

        <footer className="login-footer">
          <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => navigate('/device-login')}>
            {t('devices.deviceLoginLink')}
          </button>
          <a
            href={LATEST_APK_URL}
            className="login-footer-download"
            aria-label={t('login.downloadLatestApk')}
            title={t('login.downloadLatestApk')}
          >
            <MaterialIcon name="admin_panel_settings" />
          </a>
          <span>{t('login.noAccount')}</span>
        </footer>
      </div>
    </main>
  );
}
