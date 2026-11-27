import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ownerWorkspaceLinks } from '../app/navigation';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { deviceService, DEVICE_PAGE_SIZE, type DeviceCredentialResult, type DeviceSummary } from '../services/deviceService';
import { getLanguage, localizeErrorMessage } from '../i18n';
import { t } from '../i18n/translations';

function formatLastSeen(value: string | null): string {
  if (!value) return t('devices.neverUsed');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t('devices.neverUsed') : date.toLocaleString(getLanguage());
}

export function OwnerDevicesScreen() {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [credentials, setCredentials] = useState<DeviceCredentialResult | null>(null);
  const loadingMoreRef = useRef(false);
  const nextOffsetRef = useRef(DEVICE_PAGE_SIZE);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const page = await deviceService.listForOwner();
      setDevices(page.devices);
      setTotalCount(page.totalCount);
      nextOffsetRef.current = page.devices.length;
    } catch (loadError) {
      setError(localizeErrorMessage(loadError, t('devices.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, []);

  async function loadMoreDevices() {
    if (loading || loadingMoreRef.current || devices.length >= totalCount) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError('');
    const offset = nextOffsetRef.current;
    try {
      const page = await deviceService.listForOwner(offset);
      setDevices((current) => {
        const existingIds = new Set(current.map((device) => device.id));
        return [...current, ...page.devices.filter((device) => !existingIds.has(device.id))];
      });
      setTotalCount(page.totalCount);
      nextOffsetRef.current = offset + page.devices.length;
    } catch (loadError) {
      setError(localizeErrorMessage(loadError, t('devices.loadFailed')));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  async function createDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || loading || loadingMoreRef.current || !name.trim()) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await deviceService.createForOwner(name.trim());
      setDevices((current) => [result.device, ...current].slice(0, DEVICE_PAGE_SIZE));
      setTotalCount((current) => current + 1);
      setCredentials(result);
      setName('');
      setNotice(result.auditWarning ?? '');
    } catch (createError) {
      setError(localizeErrorMessage(createError, t('devices.createFailed')));
    } finally {
      setSaving(false);
    }
  }

  async function updateDevice(device: DeviceSummary, changes: { name?: string; isActive?: boolean }) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await deviceService.updateForOwner(device.id, changes);
      setDevices((current) => current.map((item) => item.id === device.id ? result.device : item));
      setNotice(result.auditWarning ?? '');
    } catch (updateError) {
      setError(localizeErrorMessage(updateError, t('devices.updateFailed')));
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(device: DeviceSummary) {
    if (saving) return;
    if (!window.confirm(t('devices.confirmReset'))) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await deviceService.resetPasswordForOwner(device.id);
      setDevices((current) => current.map((item) => item.id === device.id ? result.device : item));
      setCredentials(result);
      setNotice(result.auditWarning ?? '');
    } catch (resetError) {
      setError(localizeErrorMessage(resetError, t('devices.resetFailed')));
    } finally {
      setSaving(false);
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(
        `Username: ${credentials.device.username}\nPassword: ${credentials.temporaryPassword}`,
      );
      setNotice(t('devices.copied'));
    } catch {
      setError(t('devices.copyFailed'));
    }
  }

  return (
    <WorkspaceLayout title={t('devices.title')} links={ownerWorkspaceLinks}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 tablet:p-6">
        <header className="rounded-3xl bg-surface-container-lowest p-5 shadow-card tablet:p-7">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-fixed text-primary">
              <MaterialIcon name="devices" className="text-2xl" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-headline-md text-on-surface">{t('devices.title')}</h1>
              <p className="mt-1 max-w-2xl font-body text-body-md text-on-surface-variant">
                {t('devices.description')}
              </p>
            </div>
          </div>
        </header>

        <form onSubmit={(event) => { void createDevice(event); }} className="flex flex-col gap-4 rounded-3xl bg-surface-container-lowest p-5 shadow-card tablet:flex-row tablet:items-end tablet:p-6">
          <label className="flex min-w-0 flex-1 flex-col gap-2 font-body text-label-md text-on-surface">
            {t('devices.name')}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
              autoComplete="off"
              className="h-12 w-full rounded-xl border border-outline-variant bg-surface px-4 font-body text-body-md text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder={t('devices.namePlaceholder')}
            />
          </label>
          <Button type="submit" disabled={saving || loading || loadingMore || !name.trim()} className="min-h-12 shrink-0">
            <MaterialIcon name={saving ? 'sync' : 'add'} className={saving ? 'animate-spin' : ''} />
            {t('devices.create')}
          </Button>
        </form>

        {credentials && (
          <section aria-labelledby="device-credentials-title" className="rounded-3xl border border-primary/30 bg-primary-fixed/40 p-5 shadow-card tablet:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="device-credentials-title" className="font-display text-title-lg text-on-surface">{t('devices.credentialsTitle')}</h2>
                <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('devices.credentialsWarning')}</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => { void copyCredentials(); }}>
                <MaterialIcon name="content_copy" />
                {t('devices.copyCredentials')}
              </Button>
            </div>
            <dl className="mt-4 grid gap-3 tablet:grid-cols-2">
              <div className="rounded-xl bg-surface-container-lowest p-3">
                <dt className="font-body text-label-sm text-on-surface-variant">{t('devices.username')}</dt>
                <dd className="mt-1 break-all font-mono text-body-md text-on-surface">{credentials.device.username}</dd>
              </div>
              <div className="rounded-xl bg-surface-container-lowest p-3">
                <dt className="font-body text-label-sm text-on-surface-variant">{t('devices.temporaryPassword')}</dt>
                <dd className="mt-1 break-all font-mono text-body-md text-on-surface">{credentials.temporaryPassword}</dd>
              </div>
            </dl>
            <Button type="button" variant="ghost" className="mt-3" onClick={() => setCredentials(null)}>
              {t('common.done')}
            </Button>
          </section>
        )}

        {notice && <p role="status" className="rounded-xl bg-secondary-container p-3 font-body text-body-sm text-on-secondary-container">{notice}</p>}
        {error && <p role="alert" className="rounded-xl bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}

        <section className="rounded-3xl bg-surface-container-lowest p-5 shadow-card tablet:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-title-lg text-on-surface">{t('devices.registeredDevices')}</h2>
              <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('devices.deviceCount', { count: totalCount })}</p>
            </div>
            <Button type="button" variant="ghost" disabled={loading || loadingMore || saving} onClick={() => { void loadDevices(); }}>
              <MaterialIcon name="refresh" className={loading ? 'animate-spin' : ''} />
              {t('devices.refresh')}
            </Button>
          </div>

          {loading ? (
            <p role="status" className="mt-5 font-body text-body-md text-on-surface-variant">{t('devices.loading')}</p>
          ) : devices.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-outline-variant p-6 text-center">
              <MaterialIcon name="devices" className="text-3xl text-on-surface-variant" />
              <p className="mt-2 font-body text-body-md text-on-surface-variant">{t('devices.empty')}</p>
            </div>
          ) : (
            <ul className="mt-5 flex flex-col gap-3">
              {devices.map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  disabled={saving || loadingMore}
                  onRename={(nextName) => updateDevice(device, { name: nextName })}
                  onToggle={() => {
                    if (device.isActive && !window.confirm(t('devices.confirmDeactivate'))) return;
                    void updateDevice(device, { isActive: !device.isActive });
                  }}
                  onResetPassword={() => { void resetPassword(device); }}
                />
              ))}
            </ul>
          )}
          {!loading && devices.length < totalCount && (
            <Button
              type="button"
              variant="secondary"
              className="mt-4 w-full"
              disabled={loadingMore || saving}
              onClick={() => { void loadMoreDevices(); }}
            >
              <MaterialIcon name={loadingMore ? 'sync' : 'expand_more'} className={loadingMore ? 'animate-spin' : ''} />
              {t(loadingMore ? 'devices.loadingMore' : 'devices.loadMore')}
            </Button>
          )}
        </section>
      </div>
    </WorkspaceLayout>
  );
}

function DeviceCard({
  device,
  disabled,
  onRename,
  onToggle,
  onResetPassword,
}: {
  device: DeviceSummary;
  disabled: boolean;
  onRename: (name: string) => void;
  onToggle: () => void;
  onResetPassword: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);

  function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || name.trim() === device.name) {
      setEditing(false);
      setName(device.name);
      return;
    }
    onRename(name.trim());
    setEditing(false);
  }

  return (
    <li className="rounded-2xl border border-outline-variant/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={saveName} className="flex flex-wrap gap-2">
              <input
                aria-label={t('devices.name')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                required
                autoFocus
                className="h-10 min-w-40 flex-1 rounded-lg border border-outline-variant bg-surface px-3 font-body text-body-md outline-none focus:border-primary"
              />
              <Button type="submit" disabled={disabled || !name.trim()}>{t('devices.saveName')}</Button>
              <Button type="button" variant="ghost" onClick={() => { setEditing(false); setName(device.name); }}>{t('devices.cancelEdit')}</Button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words font-display text-title-md text-on-surface">{device.name}</h3>
              <span className={`rounded-full px-2.5 py-1 font-body text-label-sm ${device.isActive ? 'bg-secondary-container text-on-secondary-container' : 'bg-error-container text-on-error-container'}`}>
                {device.isActive ? t('common.active') : t('common.suspended')}
              </span>
            </div>
          )}
          <p className="mt-2 font-body text-body-sm text-on-surface-variant">
            {t('devices.username')}: <span className="font-mono text-on-surface">{device.username}</span>
          </p>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">
            {t('devices.lastUsed')}: {formatLastSeen(device.lastSeenAt)}
          </p>
          {device.mustChangePassword && (
            <p className="mt-1 font-body text-label-sm text-tertiary">{t('devices.passwordChangeRequired')}</p>
          )}
        </div>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={disabled} onClick={() => setEditing(true)}>
              <MaterialIcon name="edit" />
              {t('devices.edit')}
            </Button>
            <Button type="button" variant="secondary" disabled={disabled} onClick={onResetPassword}>
              <MaterialIcon name="key" />
              {t('devices.resetPassword')}
            </Button>
            <Button type="button" variant={device.isActive ? 'ghost' : 'primary'} disabled={disabled} onClick={onToggle}>
              <MaterialIcon name={device.isActive ? 'block' : 'check_circle'} />
              {device.isActive ? t('devices.deactivate') : t('devices.activate')}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}
