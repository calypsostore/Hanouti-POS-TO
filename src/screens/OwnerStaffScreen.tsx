import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { t } from '../i18n/translations';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import type { PermissionDefinition, PositionRecord, UserSummary } from '../types/domain';

type StaffSheet = 'new-staff' | 'new-position' | 'edit-staff' | null;

function OwnerStaffContent() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [staff, setStaff] = useState<UserSummary[]>([]);
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [permissions, setPermissions] = useState<PermissionDefinition[]>([]);
  const [storeName, setStoreName] = useState<string>();
  const [sheet, setSheet] = useState<StaffSheet>(null);
  const [name, setName] = useState('');
  const [positionId, setPositionId] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [temporaryCredentials, setTemporaryCredentials] = useState<{ username: string; password: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const [users, nextPositions, nextPermissions] = await Promise.all([
      userService.listUsers(storeId),
      userService.listPositions(storeId),
      userService.listPermissionDefinitions(),
    ]);
    setStaff(users.filter((entry) => entry.role === 'staff'));
    setPositions(nextPositions);
    setPermissions(nextPermissions);
  }, [storeId]);

  useEffect(() => {
    void refresh().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : t('common.loadFailed')));
    if (user?.storeId) void userService.getStore(user.storeId).then((store) => setStoreName(store?.name)).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : t('common.storeLoadFailed')));
  }, [refresh, storeId, user?.storeId]);

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const result = await userService.createStaff({ storeId, name, positionId: positionId || positions[0]?.id || '' });
      setTemporaryCredentials({ username: result.staff.username ?? '', password: result.temporaryPassword });
      await refresh();
      setName('');
      setSheet(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create staff.');
    }
  }

  async function createPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await userService.createPosition(storeId, name, selectedPermissions);
      await refresh();
      setName('');
      setSelectedPermissions([]);
      setSheet(null);
      setNotice('Position created.');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create position.');
    }
  }

  async function editStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setError('');
    try {
      await userService.updateStaff(editing.id, { name, positionId: positionId || editing.positionId });
      await refresh();
      setSheet(null);
      setEditing(null);
      setNotice('Staff profile updated.');
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update staff.');
    }
  }

  function openEdit(staffMember: UserSummary) {
    setEditing(staffMember);
    setName(staffMember.name);
    setPositionId(staffMember.positionId ?? '');
    setError('');
    setSheet('edit-staff');
  }

  async function toggleStaff(staffMember: UserSummary) {
    setError('');
    try {
      await userService.updateStaff(staffMember.id, { isActive: !staffMember.isActive });
      await refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update staff status.');
    }
  }

  function positionFor(staffMember: UserSummary) {
    return positions.find((position) => position.id === staffMember.positionId)?.name ?? 'Unassigned';
  }

  return (
    <WorkspaceLayout title={t('staff.title')} storeName={storeName} links={ownerWorkspaceLinks}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-headline-lg text-on-surface">{t('staff.title')}</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">Manage staff accounts and permission-based positions.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { setError(''); setSheet('new-position'); }}><MaterialIcon name="badge" />{t('staff.newPosition')}</Button>
          <Button onClick={() => { setError(''); setSheet('new-staff'); }}><MaterialIcon name="person_add" />{t('staff.addStaff')}</Button>
        </div>
      </header>

      <section className="mb-5 grid gap-3 sm:grid-cols-2">
        {positions.map((position) => <PositionCard key={position.id} position={position} permissions={permissions} />)}
      </section>
      <section className="flex flex-col gap-3">
        {staff.map((staffMember) => (
          <article key={staffMember.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-primary"><MaterialIcon name="person" /></span>
              <div className="min-w-0">
                <p className="truncate font-body text-label-lg text-on-surface">{staffMember.name}</p>
                <p className="truncate font-body text-body-sm text-outline">{staffMember.username} • {positionFor(staffMember)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusTag status={staffMember.isActive ? 'open' : 'suspended'}>{staffMember.isActive ? t('common.active') : t('common.suspended')}</StatusTag>
              <Button variant="secondary" className="min-h-10 px-3 text-label-md" onClick={() => openEdit(staffMember)}><MaterialIcon name="edit" className="text-lg" />Edit</Button>
              <Button variant={staffMember.isActive ? 'danger' : 'secondary'} className="min-h-10 px-3 text-label-md" onClick={() => { void toggleStaff(staffMember); }}>{staffMember.isActive ? t('staff.disable') : t('staff.enable')}</Button>
            </div>
          </article>
        ))}
        {staff.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
      </section>

      {temporaryCredentials && (
        <section role="status" className="mt-4 rounded-xl border border-success/30 bg-success-container p-4 text-on-success-container">
          <h2 className="font-display text-headline-sm">Give these temporary credentials to the new staff member</h2>
          <p className="mt-2 font-body text-body-md"><strong>{t('staff.username')}:</strong> {temporaryCredentials.username}</p>
          <p className="font-body text-body-md"><strong>{t('staff.temporaryPassword')}:</strong> {temporaryCredentials.password}</p>
          <p className="mt-1 font-body text-body-sm">They will be asked to set a new password at first login.</p>
          <button type="button" onClick={() => setTemporaryCredentials(null)} className="mt-2 min-h-10 font-body text-label-md underline">Dismiss</button>
        </section>
      )}
      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mt-4 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}

      <BottomSheet open={sheet === 'new-staff'} onClose={() => setSheet(null)} title={t('staff.addStaff')}>
        <form onSubmit={createStaff} className="flex flex-col gap-3">
          <label className="font-body text-label-md">{t('common.name')}<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
          <label className="font-body text-label-md">{t('staff.position')}<select required value={positionId || positions[0]?.id || ''} onChange={(event) => setPositionId(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3">{positions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}</select></label>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit">{t('staff.addStaff')}</Button>
        </form>
      </BottomSheet>

      <BottomSheet open={sheet === 'edit-staff'} onClose={() => { setSheet(null); setEditing(null); }} title="Edit staff">
        <form onSubmit={editStaff} className="flex flex-col gap-3">
          <label className="font-body text-label-md">{t('common.name')}<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
          <label className="font-body text-label-md">{t('staff.position')}<select required value={positionId} onChange={(event) => setPositionId(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3">{positions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}</select></label>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit">{t('common.save')}</Button>
        </form>
      </BottomSheet>

      <BottomSheet open={sheet === 'new-position'} onClose={() => setSheet(null)} title={t('staff.newPosition')}>
        <form onSubmit={createPosition} className="flex flex-col gap-3">
          <label className="font-body text-label-md">{t('common.name')}<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-body text-label-md">{t('staff.permissions')}</legend>
            {permissions.map((permission) => (
              <label key={permission.id} className="flex min-h-10 items-center gap-3 rounded-lg bg-surface-container-low px-3 font-body text-body-sm">
                <input type="checkbox" checked={selectedPermissions.includes(permission.id)} onChange={(event) => setSelectedPermissions((current) => event.target.checked ? [...current, permission.id] : current.filter((value) => value !== permission.id))} className="h-5 w-5 accent-primary" />
                {permission.label}
              </label>
            ))}
          </fieldset>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit">{t('staff.createPosition')}</Button>
        </form>
      </BottomSheet>
    </WorkspaceLayout>
  );
}

function PositionCard({ position, permissions }: { position: PositionRecord; permissions: PermissionDefinition[] }) {
  const enabled = permissions.filter((permission) => position.permissionIds.includes(permission.id));
  return (
    <article className="rounded-xl bg-surface-container-lowest p-4 shadow-card">
      <h2 className="font-body text-label-lg text-on-surface">{position.name}</h2>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {enabled.map((permission) => <span key={permission.id} className="rounded-full bg-primary-fixed/50 px-2 py-1 font-body text-label-sm text-primary">{permission.label}</span>)}
        {enabled.length === 0 && <span className="font-body text-body-sm text-outline">No permissions assigned</span>}
      </div>
    </article>
  );
}

export function OwnerStaffScreen() {
  return <OwnerStaffContent />;
}
