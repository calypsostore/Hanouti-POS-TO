import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { ListSkeleton } from '../components/ListSkeleton';
import { StatusTag } from '../components/StatusTag';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { CardGrid, PageHeader, StatGrid } from '../components/layout';
import { t } from '../i18n/translations';
import { catalogService } from '../services/catalogService';
import { shiftService } from '../services/shiftService';
import { shareTextAsPdf } from '../services/receiptExport';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import type { CatalogItemRecord, CategoryRecord, PermissionDefinition, PermissionOverrides, PositionRecord, ShiftRecord, UserSummary } from '../types/domain';

type StaffSheet = 'new-staff' | 'new-position' | 'edit-staff' | 'edit-position' | null;
type PermissionOverrideState = 'Inherited' | 'Granted' | 'Blocked';
type StaffStatusFilter = 'all' | 'active' | 'suspended';
type StaffSort = 'name' | 'newest' | 'position';

function isStaffSort(value: string): value is StaffSort {
  return value === 'name' || value === 'newest' || value === 'position';
}

interface StaffCredentials {
  userId: string;
  staffName: string;
  username: string;
  password: string;
}

function OwnerStaffContent() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [staff, setStaff] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [permissions, setPermissions] = useState<PermissionDefinition[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItemRecord[]>([]);
  const [openShifts, setOpenShifts] = useState<ShiftRecord[]>([]);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [storeName, setStoreName] = useState<string>();
  const [storeCode, setStoreCode] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StaffStatusFilter>('all');
  const [positionFilter, setPositionFilter] = useState('');
  const [sortBy, setSortBy] = useState<StaffSort>('name');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<StaffSheet>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [positionId, setPositionId] = useState('');
  const [permissionOverrides, setPermissionOverrides] = useState<PermissionOverrides>({ granted: [], revoked: [] });
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [selfServiceItemIds, setSelfServiceItemIds] = useState<string[]>([]);
  const [selfServiceCategoryIds, setSelfServiceCategoryIds] = useState<string[]>([]);
  const [maxStaffDrinkQuantity, setMaxStaffDrinkQuantity] = useState('0');
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [editingPosition, setEditingPosition] = useState<PositionRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PositionRecord | null>(null);
  const [replacementPositionId, setReplacementPositionId] = useState('');
  const [credentialHistory, setCredentialHistory] = useState<Record<string, Omit<StaffCredentials, 'userId' | 'staffName'>>>({});
  const [activeCredentials, setActiveCredentials] = useState<(StaffCredentials & { title: string }) | null>(null);
  const [resetTarget, setResetTarget] = useState<UserSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const [users, nextPositions, nextPermissions, nextOpenShifts, nextShifts, nextCategories, nextCatalogItems] = await Promise.all([
      userService.listUsers(storeId),
      userService.listPositions(storeId),
      userService.listPermissionDefinitions(),
      shiftService.listOpenShifts(storeId),
      shiftService.listShifts(storeId),
      catalogService.listCategories(storeId),
      catalogService.listItems(storeId),
    ]);
    setStaff(users.filter((entry) => entry.role === 'staff'));
    setPositions(nextPositions);
    setPermissions(nextPermissions);
    setOpenShifts(nextOpenShifts);
    setShifts(nextShifts);
    setCategories(nextCategories);
    setCatalogItems(nextCatalogItems);
  }, [storeId]);

  useEffect(() => {
    const load = () => {
      setLoading(true);
      void refresh().catch((loadError: unknown) => {
        console.error('Unable to load staff.', loadError);
        setError(t('common.loadFailed'));
      }).finally(() => setLoading(false));
    };
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [refresh]);

  useEffect(() => {
    if (user?.storeId) void userService.getStore(user.storeId).then((store) => {
      setStoreName(store?.name);
      setStoreCode(store?.code ?? '');
    }).catch((loadError: unknown) => {
      console.error('Unable to load store information for staff.', loadError);
      setError(t('common.storeLoadFailed'));
    });
  }, [user?.storeId]);

  function openNewStaff() {
    setName('');
    setPhone('');
    setNotes('');
    setPositionId(positions[0]?.id ?? '');
    setPermissionOverrides({ granted: [], revoked: [] });
    setError('');
    setNotice('');
    setSheet('new-staff');
  }

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await userService.createStaff({
        storeId,
        name,
        phone,
        notes,
        positionId,
        permissionOverrides,
      });
      const createdCredentials = {
        userId: result.staff.id,
        staffName: result.staff.name,
        username: result.staff.username ?? '',
        password: result.temporaryPassword,
      };
      setCredentialHistory((current) => ({ ...current, [createdCredentials.userId]: { username: createdCredentials.username, password: createdCredentials.password } }));
      setActiveCredentials({ ...createdCredentials, title: 'Staff created' });
      setName('');
      setPhone('');
      setNotes('');
      setSheet(null);
      try {
        await refresh();
      } catch (refreshError) {
        setError(`Staff was created, but the staff list could not be refreshed: ${refreshError instanceof Error ? refreshError.message : t('common.loadFailed')}`);
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create staff.');
    } finally {
      setBusy(false);
    }
  }

  function permissionOverrideState(permissionId: string): PermissionOverrideState {
    if (permissionOverrides.revoked.includes(permissionId)) return 'Blocked';
    if (permissionOverrides.granted.includes(permissionId)) return 'Granted';
    return 'Inherited';
  }

  function cyclePermissionOverride(permissionId: string) {
    const state = permissionOverrideState(permissionId);
    const nextState: PermissionOverrideState = state === 'Inherited' ? 'Granted' : state === 'Granted' ? 'Blocked' : 'Inherited';
    setPermissionOverrides((current) => ({
      granted: current.granted.filter((value) => value !== permissionId).concat(nextState === 'Granted' ? [permissionId] : []),
      revoked: current.revoked.filter((value) => value !== permissionId).concat(nextState === 'Blocked' ? [permissionId] : []),
    }));
  }

  async function copyValue(label: string, value: string) {
    setError('');
    setNotice('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : `Unable to copy ${label.toLocaleLowerCase()}.`);
    }
  }

  async function copyAllCredentials() {
    if (!activeCredentials) return;
    await copyValue('Credentials', `Username: ${activeCredentials.username}\nTemporary password: ${activeCredentials.password}`);
  }

  async function shareCredentials() {
    if (!activeCredentials) return;
    const text = `Username: ${activeCredentials.username}\nTemporary password: ${activeCredentials.password}`;
    setError('');
    try {
      await shareTextAsPdf(text, `staff-credentials-${activeCredentials.username}`, activeCredentials.title);
      setNotice('Credentials PDF shared or downloaded.');
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
      setError(shareError instanceof Error ? shareError.message : 'Unable to share credentials.');
    }
  }

  function showCredentials(staffMember: UserSummary) {
    setError('');
    setNotice('');
    const savedCredentials = credentialHistory[staffMember.id];
    if (!savedCredentials) {
      setResetTarget(staffMember);
      return;
    }
    setActiveCredentials({
      userId: staffMember.id,
      staffName: staffMember.name,
      ...savedCredentials,
      title: 'Credentials',
    });
  }

  async function resetPassword() {
    if (!resetTarget) return;
    setError('');
    setBusy(true);
    try {
      const password = await userService.resetStaffPassword(resetTarget.id);
      const resetCredentials = {
        userId: resetTarget.id,
        staffName: resetTarget.name,
        username: resetTarget.username ?? '',
        password,
      };
      setCredentialHistory((current) => ({ ...current, [resetCredentials.userId]: { username: resetCredentials.username, password } }));
      setResetTarget(null);
      setActiveCredentials({ ...resetCredentials, title: 'Password reset' });
      try {
        await refresh();
      } catch (refreshError) {
        setError(`Password was reset, but the staff list could not be refreshed: ${refreshError instanceof Error ? refreshError.message : t('common.loadFailed')}`);
      }
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Unable to reset the staff password.');
    } finally {
      setBusy(false);
    }
  }

  async function createPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await userService.createPosition(storeId, name, selectedPermissions, positionCompRules());
      setName('');
      setSelectedPermissions([]);
      setSelfServiceItemIds([]);
      setSelfServiceCategoryIds([]);
      setMaxStaffDrinkQuantity('0');
      setSheet(null);
      setNotice('Position created.');
      try {
        await refresh();
      } catch (refreshError) {
        setError(`Position was created, but the list could not be refreshed: ${refreshError instanceof Error ? refreshError.message : t('common.loadFailed')}`);
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create position.');
    }
  }

  function openNewPosition() {
    setName('');
    setSelectedPermissions([]);
    setSelfServiceItemIds([]);
    setSelfServiceCategoryIds([]);
    setMaxStaffDrinkQuantity('0');
    setError('');
    setNotice('');
    setSheet('new-position');
  }

  function openEditPosition(position: PositionRecord) {
    setEditingPosition(position);
    setName(position.name);
    setSelectedPermissions([...position.permissionIds]);
    setSelfServiceItemIds([...(position.selfServiceItemIds ?? [])]);
    setSelfServiceCategoryIds([...(position.selfServiceCategoryIds ?? [])]);
    setMaxStaffDrinkQuantity(String(position.maxStaffDrinkQuantityPerShift ?? 0));
    setError('');
    setNotice('');
    setSheet('edit-position');
  }

  async function savePosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingPosition) return;
    setError('');
    setNotice('');
    try {
      await userService.updatePosition(editingPosition.id, { name, permissionIds: selectedPermissions, ...positionCompRules() });
      setSheet(null);
      setEditingPosition(null);
      setNotice('Position updated.');
      try {
        await refresh();
      } catch (refreshError) {
        setError(`Position was updated, but the list could not be refreshed: ${refreshError instanceof Error ? refreshError.message : t('common.loadFailed')}`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to update this position.');
    }
  }

  async function duplicatePosition() {
    if (!editingPosition) return;
    setError('');
    setNotice('');
    try {
      const duplicateName = `${editingPosition.name} copy`;
      await userService.createPosition(storeId, duplicateName, editingPosition.permissionIds, {
        selfServiceItemIds: editingPosition.selfServiceItemIds,
        selfServiceCategoryIds: editingPosition.selfServiceCategoryIds,
        maxStaffDrinkQuantityPerShift: editingPosition.maxStaffDrinkQuantityPerShift,
      });
      setSheet(null);
      setEditingPosition(null);
      setNotice('Position duplicated.');
      try {
        await refresh();
      } catch (refreshError) {
        setError(`Position was duplicated, but the list could not be refreshed: ${refreshError instanceof Error ? refreshError.message : t('common.loadFailed')}`);
      }
    } catch (duplicateError) {
      setError(duplicateError instanceof Error ? duplicateError.message : 'Unable to duplicate this position.');
    }
  }

  function openDeletePosition(position: PositionRecord) {
    const assignedCount = staff.filter((staffMember) => staffMember.positionId === position.id).length;
    const replacement = positions.find((candidate) => candidate.id !== position.id);
    setEditingPosition(null);
    setSheet(null);
    setDeleteTarget(position);
    setReplacementPositionId(assignedCount > 0 ? replacement?.id ?? '' : '');
    setError('');
  }

  async function deletePosition() {
    if (!deleteTarget) return;
    const assignedCount = staff.filter((staffMember) => staffMember.positionId === deleteTarget.id).length;
    setError('');
    setBusy(true);
    try {
      await userService.deletePosition(deleteTarget.id, assignedCount > 0 ? replacementPositionId : undefined);
      setDeleteTarget(null);
      setNotice('Position deleted.');
      try {
        await refresh();
      } catch (refreshError) {
        setError(`Position was deleted, but the list could not be refreshed: ${refreshError instanceof Error ? refreshError.message : t('common.loadFailed')}`);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete this position.');
    } finally {
      setBusy(false);
    }
  }

  function togglePositionPermission(permissionId: string) {
    setSelectedPermissions((current) => current.includes(permissionId)
      ? current.filter((value) => value !== permissionId)
      : [...current, permissionId]);
  }

  function selectPermissionGroup(group: string, selected: boolean) {
    const permissionIds = permissions.filter((permission) => permission.group === group).map((permission) => permission.id);
    setSelectedPermissions((current) => selected
      ? [...new Set([...current, ...permissionIds])]
      : current.filter((permissionId) => !permissionIds.includes(permissionId)));
  }

  function positionCompRules() {
    const maximum = Number(maxStaffDrinkQuantity);
    if (!Number.isInteger(maximum) || maximum < 0) {
      throw new Error('Staff drink limit must be a non-negative whole number.');
    }
    return {
      selfServiceItemIds,
      selfServiceCategoryIds,
      maxStaffDrinkQuantityPerShift: maximum,
    };
  }

  function toggleSelfServiceItem(id: string) {
    setSelfServiceItemIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function toggleSelfServiceCategory(id: string) {
    setSelfServiceCategoryIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
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

  function openShiftFor(staffMember: UserSummary) {
    return openShifts.find((shift) => shift.staffId === staffMember.id);
  }

  function lastShiftFor(staffMember: UserSummary) {
    return shifts
      .filter((shift) => shift.staffId === staffMember.id)
      .reduce<ShiftRecord | undefined>((latest, shift) =>
        !latest || shift.openedAt > latest.openedAt ? shift : latest, undefined);
  }

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const visibleStaff = staff
    .filter((staffMember) => {
      const matchesSearch = !normalizedSearch ||
        staffMember.name.toLocaleLowerCase().includes(normalizedSearch) ||
        (staffMember.username ?? '').toLocaleLowerCase().includes(normalizedSearch);
      const matchesStatus = statusFilter === 'all' ||
        (statusFilter === 'active' ? staffMember.isActive : !staffMember.isActive);
      const matchesPosition = !positionFilter || staffMember.positionId === positionFilter;
      return matchesSearch && matchesStatus && matchesPosition;
    })
    .sort((left, right) => {
      if (sortBy === 'newest') return right.createdAt.localeCompare(left.createdAt);
      if (sortBy === 'position') return positionFor(left).localeCompare(positionFor(right)) || left.name.localeCompare(right.name);
      return left.name.localeCompare(right.name);
    });
  const staffIds = new Set(staff.map((staffMember) => staffMember.id));
  const onShiftCount = new Set(openShifts.filter((shift) => staffIds.has(shift.staffId)).map((shift) => shift.staffId)).size;
  const usernamePreview = name.trim()
    ? userService.formatStaffUsername(storeCode, name, staff.flatMap((staffMember) => staffMember.username ? [staffMember.username] : []))
    : '';
  const inheritedPermissions = positions.find((position) => position.id === positionId)?.permissionIds ?? [];

  return (
    <WorkspaceLayout title={t('staff.title')} storeName={storeName} links={ownerWorkspaceLinks}>
      <PageHeader title={t('staff.title')} subtitle="Manage staff accounts and permission-based positions." actions={
        <>
          <Button variant="secondary" onClick={openNewPosition}><MaterialIcon name="badge" />{t('staff.newPosition')}</Button>
          <Button onClick={openNewStaff}><MaterialIcon name="person_add" />{t('staff.addStaff')}</Button>
        </>
      } />

      <CardGrid className="mb-5 mobile-gap-3">
        {positions.map((position) => (
          <PositionCard
            key={position.id}
            position={position}
            permissions={permissions}
            staffCount={staff.filter((staffMember) => staffMember.positionId === position.id).length}
            onClick={() => openEditPosition(position)}
          />
        ))}
      </CardGrid>
      <StatGrid className="mb-5">
        <StaffSummaryCard label="Total staff" value={staff.length} />
        <StaffSummaryCard label="Active" value={staff.filter((staffMember) => staffMember.isActive).length} />
        <StaffSummaryCard label="Suspended" value={staff.filter((staffMember) => !staffMember.isActive).length} />
        <StaffSummaryCard label="Currently on shift" value={onShiftCount} />
      </StatGrid>

      <div className="sticky top-[7.5rem] z-10 -mx-4 bg-surface/95 px-4 py-2 backdrop-blur-xl">
        <label className="relative block">
          <span className="sr-only">Search staff by name or username</span>
          <MaterialIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search name or username"
            className="h-12 w-full rounded-xl bg-surface-container-lowest pl-11 pr-3 font-body text-body-md text-on-surface shadow-card outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
      </div>

      <div className="mb-4 flex flex-col gap-3">
        <div className="scrollbar-hidden flex gap-2 overflow-x-auto py-1" aria-label="Filter staff list">
          {([
            ['all', 'All'],
            ['active', 'Active'],
            ['suspended', 'Suspended'],
          ] as const).map(([filter, label]) => (
            <button
              key={filter}
              type="button"
              aria-pressed={statusFilter === filter}
              onClick={() => {
                setStatusFilter(filter);
                if (filter === 'all') setPositionFilter('');
              }}
              className={`min-h-12 shrink-0 rounded-full px-4 font-body text-label-md ${statusFilter === filter ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant'}`}
            >
              {label}
            </button>
          ))}
          {positions.map((position) => (
            <button
              key={position.id}
              type="button"
              aria-pressed={positionFilter === position.id}
              onClick={() => setPositionFilter(positionFilter === position.id ? '' : position.id)}
              className={`min-h-12 shrink-0 rounded-full px-4 font-body text-label-md ${positionFilter === position.id ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant'}`}
            >
              {position.name}
            </button>
          ))}
        </div>
        <label className="flex min-h-12 items-center gap-3 font-body text-label-md text-on-surface-variant sm:ml-auto">
          Sort
          <select
            value={sortBy}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (isStaffSort(value)) setSortBy(value);
            }}
            className="h-12 min-w-0 flex-1 rounded-lg bg-surface-container-lowest px-3 text-on-surface outline-none focus:ring-2 focus:ring-primary sm:flex-none"
          >
            <option value="name">Name</option>
            <option value="newest">Newest</option>
            <option value="position">Position</option>
          </select>
        </label>
      </div>

      <CardGrid className="mobile-card-list mobile-gap-3">
        {loading ? <ListSkeleton label="Loading staff" /> : visibleStaff.map((staffMember) => {
          const currentShift = openShiftFor(staffMember);
          const lastShift = lastShiftFor(staffMember);
          const initials = staffMember.name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0] ?? '').join('').toLocaleUpperCase();
          return (
            <article key={staffMember.id} className="flex items-start gap-2 rounded-xl bg-surface-container-lowest p-3 shadow-card sm:p-4">
              <button
                type="button"
                onClick={() => { setOpenMenuId(null); navigate(`/owner/staff/${staffMember.id}`); }}
                className="flex min-h-20 min-w-0 flex-1 items-start gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-fixed font-body text-label-lg text-primary">
                  {initials || '?'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="max-w-full truncate font-body text-label-lg text-on-surface">{staffMember.name}</span>
                    <span className="rounded-full bg-secondary-container px-2.5 py-1 font-body text-label-sm text-on-secondary-container">{positionFor(staffMember)}</span>
                    <StatusTag status={staffMember.isActive ? 'open' : 'suspended'}>{staffMember.isActive ? t('common.active') : t('common.suspended')}</StatusTag>
                  </span>
                  <span className="mt-1 block truncate font-body text-body-sm text-outline">{staffMember.username ?? 'No username'}</span>
                  <span className={`mt-1 block font-body text-body-sm ${currentShift ? 'text-success-dark' : 'text-outline'}`}>
                    {currentShift
                      ? `On shift since ${new Date(currentShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`
                      : 'Off'}
                  </span>
                  <span className="mt-0.5 block font-body text-label-sm text-outline">
                    {lastShift ? `Last shift ${new Date(lastShift.openedAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : 'No shifts yet'}
                  </span>
                </span>
              </button>
              <div className="relative shrink-0">
                <button
                  type="button"
                  aria-label={`More actions for ${staffMember.name}`}
                  aria-haspopup="menu"
                  aria-expanded={openMenuId === staffMember.id}
                  onClick={() => setOpenMenuId(openMenuId === staffMember.id ? null : staffMember.id)}
                  className="flex h-12 w-12 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <MaterialIcon name="more_vert" />
                </button>
                {openMenuId === staffMember.id && (
                  <div role="menu" className="absolute right-0 top-12 z-20 min-w-52 rounded-xl bg-surface-container-lowest p-1 shadow-dialog">
                    <StaffMenuAction icon="key" label="Credentials" onClick={() => { setOpenMenuId(null); showCredentials(staffMember); }} />
                    <StaffMenuAction icon="edit" label="Edit" onClick={() => { setOpenMenuId(null); openEdit(staffMember); }} />
                    <StaffMenuAction icon="lock_reset" label="Reset password" onClick={() => { setOpenMenuId(null); setError(''); setResetTarget(staffMember); }} />
                    <StaffMenuAction
                      icon={staffMember.isActive ? 'person_off' : 'person'}
                      label={staffMember.isActive ? 'Suspend' : 'Activate'}
                      onClick={() => { setOpenMenuId(null); void toggleStaff(staffMember); }}
                    />
                  </div>
                )}
              </div>
            </article>
          );
        })}
        {!loading && !error && visibleStaff.length === 0 && (
          <div className="rounded-xl bg-surface-container-lowest px-5 py-8 text-center shadow-card">
            <MaterialIcon name="person_search" className="text-3xl text-outline" />
            <p className="mt-2 font-body text-label-lg text-on-surface">No staff found</p>
            <p className="mt-1 font-body text-body-sm text-outline">Try a different search or filter.</p>
          </div>
        )}
      </CardGrid>

      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mt-4 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}

      <BottomSheet open={sheet === 'new-staff'} onClose={() => setSheet(null)} title={t('staff.addStaff')}>
        <form onSubmit={createStaff} className="flex flex-col gap-4">
          <label className="font-body text-label-md">Full name
            <input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" />
          </label>
          <label className="font-body text-label-md">Phone (optional)
            <input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" />
          </label>
          <label className="font-body text-label-md">Position
            <select required value={positionId} onChange={(event) => setPositionId(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary">
              <option value="">Select a position</option>
              {positions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
            </select>
          </label>
          <label className="font-body text-label-md">Notes (optional)
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded-lg bg-surface-container-low px-3 py-3 outline-none focus:ring-2 focus:ring-primary" />
          </label>

          <section className="flex flex-col gap-3 rounded-xl border border-outline-variant p-3">
            <h3 className="font-body text-label-lg text-on-surface">Credentials</h3>
            <label className="min-w-0 font-body text-label-md">Username preview
              <input readOnly value={usernamePreview} placeholder="Enter a name to preview" className="mt-1 h-12 w-full min-w-0 rounded-lg bg-surface-container-low px-3 font-mono text-body-sm" />
            </label>
            <p className="font-body text-body-sm text-on-surface-variant">Duplicate first names are numbered automatically. A temporary password is generated after creation; the staff member must set a new password and PIN at their next sign-in.</p>
          </section>

          <details className="rounded-xl border border-outline-variant p-3">
            <summary className="flex min-h-12 cursor-pointer items-center font-body text-label-lg text-on-surface">Extra permissions for this person</summary>
            <p className="mb-3 font-body text-body-sm text-outline">Permissions inherit from the selected position unless explicitly granted or blocked.</p>
            <div className="flex flex-col gap-4">
              {[...new Set(permissions.map((permission) => permission.group))].map((group) => (
                <section key={group} className="flex flex-col gap-2">
                  <h4 className="font-body text-label-md text-on-surface">{group}</h4>
                  {permissions.filter((permission) => permission.group === group).map((permission) => {
                    const state = permissionOverrideState(permission.id);
                    const enabled = state === 'Granted' || (state === 'Inherited' && inheritedPermissions.includes(permission.id));
                    return (
                      <div key={permission.id} className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-surface-container-low px-3">
                        <div className="min-w-0">
                          <p className="font-body text-body-sm text-on-surface">{permission.label}</p>
                          <p className="font-body text-label-sm text-outline">{state}</p>
                        </div>
                        <ToggleSwitch
                          checked={enabled}
                          label={`${permission.label}: ${state}`}
                          onChange={() => cyclePermissionOverride(permission.id)}
                        />
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          </details>

          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit" disabled={busy || positions.length === 0}>{t('staff.addStaff')}</Button>
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
          <PermissionGroupSwitches permissions={permissions} selectedPermissions={selectedPermissions} onToggle={togglePositionPermission} onSelectAll={(group) => selectPermissionGroup(group, true)} onClearAll={(group) => selectPermissionGroup(group, false)} />
          <StaffDrinkRulesEditor
            categories={categories}
            items={catalogItems}
            selectedCategoryIds={selfServiceCategoryIds}
            selectedItemIds={selfServiceItemIds}
            maxQuantity={maxStaffDrinkQuantity}
            onCategoryToggle={toggleSelfServiceCategory}
            onItemToggle={toggleSelfServiceItem}
            onMaxQuantityChange={setMaxStaffDrinkQuantity}
          />
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit">{t('staff.createPosition')}</Button>
        </form>
      </BottomSheet>

      <BottomSheet open={sheet === 'edit-position'} onClose={() => { setSheet(null); setEditingPosition(null); }} title="Edit position">
        {editingPosition && (
          <form onSubmit={savePosition} className="flex flex-col gap-4">
            <label className="font-body text-label-md">Position name
              <input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" />
            </label>
            <p className="rounded-lg bg-surface-container-low p-3 font-body text-body-sm text-on-surface-variant">
              {staff.filter((staffMember) => staffMember.positionId === editingPosition.id).length} staff use this position.
            </p>
            <PermissionGroupSwitches permissions={permissions} selectedPermissions={selectedPermissions} onToggle={togglePositionPermission} onSelectAll={(group) => selectPermissionGroup(group, true)} onClearAll={(group) => selectPermissionGroup(group, false)} />
            <StaffDrinkRulesEditor
              categories={categories}
              items={catalogItems}
              selectedCategoryIds={selfServiceCategoryIds}
              selectedItemIds={selfServiceItemIds}
              maxQuantity={maxStaffDrinkQuantity}
              onCategoryToggle={toggleSelfServiceCategory}
              onItemToggle={toggleSelfServiceItem}
              onMaxQuantityChange={setMaxStaffDrinkQuantity}
            />
            {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
            <Button type="submit">{t('common.save')}</Button>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={() => { void duplicatePosition(); }}><MaterialIcon name="content_copy" />Duplicate</Button>
              <Button type="button" variant="danger" onClick={() => openDeletePosition(editingPosition)}><MaterialIcon name="delete" />Delete position</Button>
            </div>
          </form>
        )}
      </BottomSheet>

      <BottomSheet open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="Delete position?">
        {deleteTarget && (
          <div className="flex flex-col gap-3">
            {staff.filter((staffMember) => staffMember.positionId === deleteTarget.id).length > 0 ? (
              <>
                <p className="font-body text-body-md text-on-surface-variant">
                  Move {staff.filter((staffMember) => staffMember.positionId === deleteTarget.id).length} staff to a replacement position before deleting {deleteTarget.name}.
                </p>
                <label className="font-body text-label-md">Move staff to...
                  <select required value={replacementPositionId} onChange={(event) => setReplacementPositionId(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary">
                    <option value="">Select a replacement position</option>
                    {positions.filter((position) => position.id !== deleteTarget.id).map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
                  </select>
                </label>
                {positions.filter((position) => position.id !== deleteTarget.id).length === 0 && <p className="font-body text-body-sm text-error-dark">Create another position before deleting this one.</p>}
              </>
            ) : <p className="font-body text-body-md text-on-surface-variant">Delete {deleteTarget.name}? This position has no assigned staff.</p>}
            {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button type="button" variant="danger" disabled={busy || (staff.some((staffMember) => staffMember.positionId === deleteTarget.id) && !replacementPositionId)} onClick={() => { void deletePosition(); }}>Delete position</Button>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={Boolean(activeCredentials)} onClose={() => setActiveCredentials(null)} title={activeCredentials?.title}>
        {activeCredentials && (
          <div className="flex flex-col gap-4">
            <p className="font-body text-body-md text-on-surface">Credentials for {activeCredentials.staffName}</p>
            <label className="font-body text-label-md">Username
              <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input readOnly value={activeCredentials.username} className="h-12 min-w-0 rounded-lg bg-surface-container-low px-3 font-mono text-body-sm" />
                <Button type="button" variant="secondary" className="px-3" onClick={() => { void copyValue('Username', activeCredentials.username); }}>Copy</Button>
              </div>
            </label>
            <label className="font-body text-label-md">Temporary password
              <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input readOnly value={activeCredentials.password} className="h-12 min-w-0 rounded-lg bg-surface-container-low px-3 font-mono tracking-widest" />
                <Button type="button" variant="secondary" className="px-3" onClick={() => { void copyValue('Temporary password', activeCredentials.password); }}>Copy</Button>
              </div>
            </label>
            <p className="rounded-lg bg-primary-fixed/40 p-3 font-body text-body-sm text-on-surface">They must set a new password and personal PIN at their next sign-in.</p>
            {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={() => { void copyAllCredentials(); }}>Copy all</Button>
              <Button type="button" onClick={() => { void shareCredentials(); }}><MaterialIcon name="share" />Share</Button>
            </div>
            {notice && <p role="status" className="font-body text-body-sm text-success-dark">{notice}</p>}
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={Boolean(resetTarget)} onClose={() => setResetTarget(null)} title="Reset password?">
        <div className="flex flex-col gap-3">
          <p className="font-body text-body-md text-on-surface-variant">Reset the temporary password for {resetTarget?.name}? This also clears their current PIN and requires them to set a new password and PIN at their next sign-in.</p>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={() => { void resetPassword(); }}>Reset password</Button>
          </div>
        </div>
      </BottomSheet>
    </WorkspaceLayout>
  );
}

function StaffSummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface-container-lowest p-3 shadow-card sm:p-4">
      <p className="font-body text-body-sm text-outline">{label}</p>
      <p className="mt-1 font-display text-headline-md tabular-nums text-on-surface">{value}</p>
    </div>
  );
}

function StaffMenuAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left font-body text-label-md text-on-surface hover:bg-surface-container-low focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    >
      <MaterialIcon name={icon} className="text-lg text-on-surface-variant" />
      {label}
    </button>
  );
}

function PositionCard({ position, permissions, staffCount, onClick }: { position: PositionRecord; permissions: PermissionDefinition[]; staffCount: number; onClick: () => void }) {
  const enabled = permissions.filter((permission) => position.permissionIds.includes(permission.id));
  return (
    <button type="button" onClick={onClick} className="rounded-xl bg-surface-container-lowest p-4 text-left shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      <span className="flex items-center justify-between gap-2">
        <span className="font-body text-label-lg text-on-surface">{position.name}</span>
        <MaterialIcon name="edit" className="text-lg text-outline" />
      </span>
      <span className="mt-1 block font-body text-body-sm text-outline">{staffCount} staff</span>
      <span className="mt-2 flex flex-wrap gap-1.5">
        {enabled.map((permission) => <span key={permission.id} className="rounded-full bg-primary-fixed/50 px-2 py-1 font-body text-label-sm text-primary">{permission.label}</span>)}
        {enabled.length === 0 && <span className="font-body text-body-sm text-outline">No permissions assigned</span>}
      </span>
    </button>
  );
}

function PermissionGroupSwitches({
  permissions,
  selectedPermissions,
  onToggle,
  onSelectAll,
  onClearAll,
}: {
  permissions: PermissionDefinition[];
  selectedPermissions: string[];
  onToggle: (permissionId: string) => void;
  onSelectAll: (group: string) => void;
  onClearAll: (group: string) => void;
}) {
  const groups = [...new Set(permissions.map((permission) => permission.group))];
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-body text-label-md text-on-surface">{group}</h3>
            <div className="flex gap-2">
              <button type="button" onClick={() => onSelectAll(group)} className="min-h-12 rounded-lg px-3 font-body text-label-sm text-primary hover:bg-surface-container-low">Select all</button>
              <button type="button" onClick={() => onClearAll(group)} className="min-h-12 rounded-lg px-3 font-body text-label-sm text-primary hover:bg-surface-container-low">Clear all</button>
            </div>
          </div>
          {permissions.filter((permission) => permission.group === group).map((permission) => {
            const enabled = selectedPermissions.includes(permission.id);
            return (
              <div key={permission.id} className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-surface-container-low px-3">
                <span className="font-body text-body-sm text-on-surface">{permission.label}</span>
                <ToggleSwitch
                  checked={enabled}
                  label={`${permission.label}: ${enabled ? 'On' : 'Off'}`}
                  onChange={() => onToggle(permission.id)}
                />
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function StaffDrinkRulesEditor({
  categories,
  items,
  selectedCategoryIds,
  selectedItemIds,
  maxQuantity,
  onCategoryToggle,
  onItemToggle,
  onMaxQuantityChange,
}: {
  categories: CategoryRecord[];
  items: CatalogItemRecord[];
  selectedCategoryIds: string[];
  selectedItemIds: string[];
  maxQuantity: string;
  onCategoryToggle: (id: string) => void;
  onItemToggle: (id: string) => void;
  onMaxQuantityChange: (value: string) => void;
}) {
  const [categorySearch, setCategorySearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const categoryQuery = categorySearch.trim().toLocaleLowerCase();
  const itemQuery = itemSearch.trim().toLocaleLowerCase();
  const visibleCategories = categories.filter((category) => category.name.toLocaleLowerCase().includes(categoryQuery));
  const visibleItems = items.filter((item) => item.name.toLocaleLowerCase().includes(itemQuery));

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-3">
      <div>
        <h3 className="font-body text-label-lg text-on-surface">Staff drinks (Prompt 5.8)</h3>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">Select categories or items staff may take for themselves. The limit applies to the combined quantity per shift.</p>
      </div>
      <label className="font-body text-label-md">Maximum quantity per shift
        <input type="number" min="0" step="1" required value={maxQuantity} onChange={(event) => onMaxQuantityChange(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-lowest px-3 outline-none focus:ring-2 focus:ring-primary" />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 flex w-full items-center justify-between gap-2 font-body text-label-md">
          <span>Allowed categories</span>
          <span className="text-label-sm text-outline">{selectedCategoryIds.length} selected</span>
        </legend>
        <label className="relative block">
          <span className="sr-only">Search categories</span>
          <MaterialIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-outline" />
          <input
            type="search"
            value={categorySearch}
            onChange={(event) => setCategorySearch(event.target.value)}
            placeholder="Search categories"
            aria-label="Search allowed categories"
            className="h-11 w-full rounded-lg bg-surface-container-lowest pl-10 pr-3 font-body text-body-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
        <div className="max-h-40 space-y-2 overflow-y-auto overscroll-contain pr-1">
          {visibleCategories.map((category) => (
            <label key={category.id} className="flex min-h-11 items-center gap-3 rounded-lg bg-surface-container-lowest px-3 font-body text-body-sm">
              <input type="checkbox" checked={selectedCategoryIds.includes(category.id)} onChange={() => onCategoryToggle(category.id)} />
              {category.name}
            </label>
          ))}
          {visibleCategories.length === 0 && <p className="px-1 py-2 font-body text-body-sm text-outline">{categories.length === 0 ? 'No categories available.' : 'No matching categories.'}</p>}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 flex w-full items-center justify-between gap-2 font-body text-label-md">
          <span>Allowed items</span>
          <span className="text-label-sm text-outline">{selectedItemIds.length} selected</span>
        </legend>
        <label className="relative block">
          <span className="sr-only">Search items</span>
          <MaterialIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-outline" />
          <input
            type="search"
            value={itemSearch}
            onChange={(event) => setItemSearch(event.target.value)}
            placeholder="Search items"
            aria-label="Search allowed items"
            className="h-11 w-full rounded-lg bg-surface-container-lowest pl-10 pr-3 font-body text-body-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
        <div className="max-h-40 space-y-2 overflow-y-auto overscroll-contain pr-1">
          {visibleItems.map((item) => (
            <label key={item.id} className="flex min-h-11 items-center gap-3 rounded-lg bg-surface-container-lowest px-3 font-body text-body-sm">
              <input type="checkbox" checked={selectedItemIds.includes(item.id)} onChange={() => onItemToggle(item.id)} />
              {item.name}
            </label>
          ))}
          {visibleItems.length === 0 && <p className="px-1 py-2 font-body text-body-sm text-outline">{items.length === 0 ? 'No active catalog items.' : 'No matching items.'}</p>}
        </div>
      </fieldset>
    </section>
  );
}

export function OwnerStaffScreen() {
  return <OwnerStaffContent />;
}
