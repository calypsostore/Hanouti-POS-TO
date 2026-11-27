import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { ListSkeleton } from '../components/ListSkeleton';
import { LazyBatch } from '../components/LazyBatch';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { StatusTag } from '../components/StatusTag';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { CardGrid, PageHeader, StatGrid } from '../components/layout';
import { getLanguage, localizeErrorMessage } from '../i18n';
import { t, type TranslationKey } from '../i18n/translations';
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
  const [maxStaffDrinkQuantity, setMaxStaffDrinkQuantity] = useState('');
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
      setActiveCredentials({ ...createdCredentials, title: 'staff.owner.credentials.createdTitle' });
      setName('');
      setPhone('');
      setNotes('');
      setSheet(null);
      try {
        await refresh();
      } catch (refreshError) {
        setError(t('staff.owner.error.refreshCreated' as TranslationKey, { details: localizeErrorMessage(refreshError, t('common.loadFailed')) }));
      }
    } catch (createError) {
      setError(localizeErrorMessage(createError, t('staff.owner.error.create' as TranslationKey)));
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
      if (!navigator.clipboard?.writeText) throw new Error(t('staff.owner.error.clipboardUnavailable' as TranslationKey));
      await navigator.clipboard.writeText(value);
      setNotice(t('staff.owner.notice.credentialsCopied' as TranslationKey, { label }));
    } catch (copyError) {
      setError(localizeErrorMessage(copyError, t('staff.owner.error.copy' as TranslationKey, { label: label.toLocaleLowerCase() })));
    }
  }

  async function copyAllCredentials() {
    if (!activeCredentials) return;
    await copyValue(t('staff.owner.credentials.title' as TranslationKey), `${t('staff.owner.credentials.usernameLine' as TranslationKey, { username: activeCredentials.username })}\n${t('staff.owner.credentials.passwordLine' as TranslationKey, { password: activeCredentials.password })}`);
  }

  async function shareCredentials() {
    if (!activeCredentials) return;
    const text = `${t('staff.owner.credentials.usernameLine' as TranslationKey, { username: activeCredentials.username })}\n${t('staff.owner.credentials.passwordLine' as TranslationKey, { password: activeCredentials.password })}`;
    setError('');
    try {
      await shareTextAsPdf(text, `staff-credentials-${activeCredentials.username}`, t(activeCredentials.title as TranslationKey));
      setNotice(t('staff.owner.notice.credentialsShared' as TranslationKey));
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
      setError(localizeErrorMessage(shareError, t('staff.owner.error.shareCredentials' as TranslationKey)));
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
      title: 'staff.owner.credentials.title',
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
      setActiveCredentials({ ...resetCredentials, title: 'staff.owner.credentials.resetTitle' });
      try {
        await refresh();
      } catch (refreshError) {
        setError(t('staff.owner.error.refreshPasswordReset' as TranslationKey, { details: localizeErrorMessage(refreshError, t('common.loadFailed')) }));
      }
    } catch (resetError) {
      setError(localizeErrorMessage(resetError, t('staff.owner.error.resetPassword' as TranslationKey)));
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
      setMaxStaffDrinkQuantity('');
      setSheet(null);
      setNotice(t('staff.owner.notice.positionCreated' as TranslationKey));
      try {
        await refresh();
      } catch (refreshError) {
        setError(t('staff.owner.error.refreshPositionCreated' as TranslationKey, { details: localizeErrorMessage(refreshError, t('common.loadFailed')) }));
      }
    } catch (createError) {
      setError(localizeErrorMessage(createError, t('staff.owner.error.createPosition' as TranslationKey)));
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
      setNotice(t('staff.owner.notice.positionUpdated' as TranslationKey));
      try {
        await refresh();
      } catch (refreshError) {
        setError(t('staff.owner.error.refreshPositionUpdated' as TranslationKey, { details: localizeErrorMessage(refreshError, t('common.loadFailed')) }));
      }
    } catch (saveError) {
      setError(localizeErrorMessage(saveError, t('staff.owner.error.updatePosition' as TranslationKey)));
    }
  }

  async function duplicatePosition() {
    if (!editingPosition) return;
    setError('');
    setNotice('');
    try {
      const duplicateName = t('staff.owner.position.copyName' as TranslationKey, { name: editingPosition.name });
      await userService.createPosition(storeId, duplicateName, editingPosition.permissionIds, {
        selfServiceItemIds: editingPosition.selfServiceItemIds,
        selfServiceCategoryIds: editingPosition.selfServiceCategoryIds,
        maxStaffDrinkQuantityPerShift: editingPosition.maxStaffDrinkQuantityPerShift,
      });
      setSheet(null);
      setEditingPosition(null);
      setNotice(t('staff.owner.notice.positionDuplicated' as TranslationKey));
      try {
        await refresh();
      } catch (refreshError) {
        setError(t('staff.owner.error.refreshPositionDuplicated' as TranslationKey, { details: localizeErrorMessage(refreshError, t('common.loadFailed')) }));
      }
    } catch (duplicateError) {
      setError(localizeErrorMessage(duplicateError, t('staff.owner.error.duplicatePosition' as TranslationKey)));
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
      setNotice(t('staff.owner.notice.positionDeleted' as TranslationKey));
      try {
        await refresh();
      } catch (refreshError) {
        setError(t('staff.owner.error.refreshPositionDeleted' as TranslationKey, { details: localizeErrorMessage(refreshError, t('common.loadFailed')) }));
      }
    } catch (deleteError) {
      setError(localizeErrorMessage(deleteError, t('staff.owner.error.deletePosition' as TranslationKey)));
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
    if (!maxStaffDrinkQuantity.trim() || !Number.isInteger(maximum) || maximum < 0) {
      throw new Error(t('staff.owner.error.invalidDrinkLimit' as TranslationKey));
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
      setNotice(t('staff.owner.notice.profileUpdated' as TranslationKey));
    } catch (updateError) {
      setError(localizeErrorMessage(updateError, t('staff.owner.error.updateStaff' as TranslationKey)));
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
      setError(localizeErrorMessage(updateError, t('staff.owner.error.updateStaffStatus' as TranslationKey)));
    }
  }

  function positionFor(staffMember: UserSummary) {
    return positions.find((position) => position.id === staffMember.positionId)?.name ?? t('staff.self.positionUnassigned' as TranslationKey);
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
      <PageHeader title={t('staff.title')} subtitle={t('staff.owner.subtitle' as TranslationKey)} actions={
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
        <StaffSummaryCard label={t('staff.owner.summary.total' as TranslationKey)} value={staff.length} />
        <StaffSummaryCard label={t('staff.owner.summary.active' as TranslationKey)} value={staff.filter((staffMember) => staffMember.isActive).length} />
        <StaffSummaryCard label={t('staff.owner.summary.suspended' as TranslationKey)} value={staff.filter((staffMember) => !staffMember.isActive).length} />
        <StaffSummaryCard label={t('staff.owner.summary.onShift' as TranslationKey)} value={onShiftCount} />
      </StatGrid>

      <div className="sticky top-[7.5rem] z-10 -mx-4 bg-surface/95 px-4 py-2 backdrop-blur-xl">
        <label className="relative block">
          <span className="sr-only">{t('staff.owner.search.label' as TranslationKey)}</span>
          <MaterialIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('staff.owner.search.placeholder' as TranslationKey)}
            className="h-12 w-full rounded-xl bg-surface-container-lowest pl-11 pr-3 font-body text-body-md text-on-surface shadow-card outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
      </div>

      <div className="mb-4 flex flex-col gap-3">
        <div className="scrollbar-hidden flex gap-2 overflow-x-auto py-1" aria-label={t('staff.owner.filter.label' as TranslationKey)}>
          {([
            ['all', t('staff.owner.filter.all' as TranslationKey)],
            ['active', t('staff.owner.filter.active' as TranslationKey)],
            ['suspended', t('staff.owner.filter.suspended' as TranslationKey)],
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
          {t('staff.owner.sort.label' as TranslationKey)}
          <select
            value={sortBy}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (isStaffSort(value)) setSortBy(value);
            }}
            className="h-12 min-w-0 flex-1 rounded-lg bg-surface-container-lowest px-3 text-on-surface outline-none focus:ring-2 focus:ring-primary sm:flex-none"
          >
            <option value="name">{t('staff.owner.sort.name' as TranslationKey)}</option>
            <option value="newest">{t('staff.owner.sort.newest' as TranslationKey)}</option>
            <option value="position">{t('staff.owner.sort.position' as TranslationKey)}</option>
          </select>
        </label>
      </div>

      <CardGrid className="mobile-card-list mobile-gap-3">
        {loading ? <ListSkeleton label={t('staff.owner.loading' as TranslationKey)} /> : <LazyBatch items={visibleStaff} resetKey={`${statusFilter}-${positionFilter}-${sortBy}-${searchQuery}`} renderItem={(staffMember) => {
          const currentShift = openShiftFor(staffMember);
          const lastShift = lastShiftFor(staffMember);
          return (
            <article key={staffMember.id} className="flex items-start gap-2 rounded-xl bg-surface-container-lowest p-3 shadow-card sm:p-4">
              <button
                type="button"
                onClick={() => { setOpenMenuId(null); navigate(`/owner/staff/${staffMember.id}`); }}
                className="flex min-h-20 min-w-0 flex-1 items-start gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-full">
                  <ProfileAvatar avatarId={staffMember.avatarId} className="h-full w-full" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="max-w-full truncate font-body text-label-lg text-on-surface">{staffMember.name}</span>
                    <span className="rounded-full bg-secondary-container px-2.5 py-1 font-body text-label-sm text-on-secondary-container">{positionFor(staffMember)}</span>
                    <StatusTag status={staffMember.isActive ? 'open' : 'suspended'}>{staffMember.isActive ? t('common.active') : t('common.suspended')}</StatusTag>
                    <span className={`rounded-full px-2.5 py-1 font-body text-label-sm ${staffMember.mustSetPin ? 'bg-warning-container text-on-warning-container' : 'bg-success-container text-success-dark'}`}>
                      {t(staffMember.mustSetPin ? 'staff.owner.pin.unassigned' as TranslationKey : 'staff.owner.pin.assigned' as TranslationKey)}
                    </span>
                  </span>
                  <span className="mt-1 block truncate font-body text-body-sm text-outline">{staffMember.username ?? t('staff.owner.username.none' as TranslationKey)}</span>
                  <span className={`mt-1 block font-body text-body-sm ${currentShift ? 'text-success-dark' : 'text-outline'}`}>
                    {currentShift
                      ? t('staff.owner.shift.since' as TranslationKey, { time: new Date(currentShift.openedAt).toLocaleTimeString(getLanguage(), { hour: '2-digit', minute: '2-digit', hour12: false }) })
                      : t('staff.owner.shift.off' as TranslationKey)}
                  </span>
                  <span className="mt-0.5 block font-body text-label-sm text-outline">
                    {lastShift ? t('staff.owner.shift.last' as TranslationKey, { date: new Date(lastShift.openedAt).toLocaleDateString(getLanguage(), { day: 'numeric', month: 'short', year: 'numeric' }) }) : t('staff.owner.shift.none' as TranslationKey)}
                  </span>
                </span>
              </button>
              <div className="relative shrink-0">
                <button
                  type="button"
                  aria-label={t('staff.owner.actions.more' as TranslationKey, { name: staffMember.name })}
                  aria-haspopup="menu"
                  aria-expanded={openMenuId === staffMember.id}
                  onClick={() => setOpenMenuId(openMenuId === staffMember.id ? null : staffMember.id)}
                  className="flex h-12 w-12 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <MaterialIcon name="more_vert" />
                </button>
                {openMenuId === staffMember.id && (
                  <div role="menu" className="absolute right-0 top-12 z-20 min-w-52 rounded-xl bg-surface-container-lowest p-1 shadow-dialog">
                    <StaffMenuAction icon="key" label={t('staff.owner.action.credentials' as TranslationKey)} onClick={() => { setOpenMenuId(null); showCredentials(staffMember); }} />
                    <StaffMenuAction icon="edit" label={t('staff.owner.action.edit' as TranslationKey)} onClick={() => { setOpenMenuId(null); openEdit(staffMember); }} />
                    <StaffMenuAction icon="lock_reset" label={t('staff.owner.action.resetPassword' as TranslationKey)} onClick={() => { setOpenMenuId(null); setError(''); setResetTarget(staffMember); }} />
                    <StaffMenuAction
                      icon={staffMember.isActive ? 'person_off' : 'person'}
                      label={t(staffMember.isActive ? 'staff.owner.action.suspend' as TranslationKey : 'staff.owner.action.activate' as TranslationKey)}
                      onClick={() => { setOpenMenuId(null); void toggleStaff(staffMember); }}
                    />
                  </div>
                )}
              </div>
            </article>
          );
        }} />}
        {!loading && !error && visibleStaff.length === 0 && (
          <div className="rounded-xl bg-surface-container-lowest px-5 py-8 text-center shadow-card">
            <MaterialIcon name="person_search" className="text-3xl text-outline" />
            <p className="mt-2 font-body text-label-lg text-on-surface">{t('staff.owner.empty.title' as TranslationKey)}</p>
            <p className="mt-1 font-body text-body-sm text-outline">{t('staff.owner.empty.body' as TranslationKey)}</p>
          </div>
        )}
      </CardGrid>

      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mt-4 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}

      <BottomSheet open={sheet === 'new-staff'} onClose={() => setSheet(null)} title={t('staff.addStaff')}>
        <form onSubmit={createStaff} className="flex flex-col gap-4">
          <label className="font-body text-label-md">{t('staff.owner.form.fullName' as TranslationKey)}
            <input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" />
          </label>
          <label className="font-body text-label-md">{t('staff.owner.form.phoneOptional' as TranslationKey)}
            <input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" />
          </label>
          <label className="font-body text-label-md">{t('staff.owner.form.position' as TranslationKey)}
            <select required value={positionId} onChange={(event) => setPositionId(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary">
              <option value="">{t('staff.owner.form.selectPosition' as TranslationKey)}</option>
              {positions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
            </select>
          </label>
          <label className="font-body text-label-md">{t('staff.owner.form.notesOptional' as TranslationKey)}
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded-lg bg-surface-container-low px-3 py-3 outline-none focus:ring-2 focus:ring-primary" />
          </label>

          <section className="flex flex-col gap-3 rounded-xl border border-outline-variant p-3">
            <h3 className="font-body text-label-lg text-on-surface">{t('staff.owner.credentials.title' as TranslationKey)}</h3>
            <label className="min-w-0 font-body text-label-md">{t('staff.owner.credentials.usernamePreview' as TranslationKey)}
              <input readOnly value={usernamePreview} placeholder={t('staff.owner.credentials.enterName' as TranslationKey)} className="mt-1 h-12 w-full min-w-0 rounded-lg bg-surface-container-low px-3 font-mono text-body-sm" />
            </label>
            <p className="font-body text-body-sm text-on-surface-variant">{t('staff.owner.credentials.creationHelp' as TranslationKey)}</p>
          </section>

          <details className="rounded-xl border border-outline-variant p-3">
            <summary className="flex min-h-12 cursor-pointer items-center font-body text-label-lg text-on-surface">{t('staff.owner.permissions.extra' as TranslationKey)}</summary>
            <p className="mb-3 font-body text-body-sm text-outline">{t('staff.owner.permissions.inheritHelp' as TranslationKey)}</p>
            <div className="flex flex-col gap-4">
              {[...new Set(permissions.map((permission) => permission.group))].map((group) => (
                <section key={group} className="flex flex-col gap-2">
                  <h4 className="font-body text-label-md text-on-surface">{group}</h4>
                  {permissions.filter((permission) => permission.group === group).map((permission) => {
                    const state = permissionOverrideState(permission.id);
                    const stateLabel = t(state === 'Granted' ? 'staff.owner.permissions.granted' as TranslationKey : state === 'Blocked' ? 'staff.owner.permissions.blocked' as TranslationKey : 'staff.owner.permissions.inherited' as TranslationKey);
                    const enabled = state === 'Granted' || (state === 'Inherited' && inheritedPermissions.includes(permission.id));
                    return (
                      <div key={permission.id} className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-surface-container-low px-3">
                        <div className="min-w-0">
                          <p className="font-body text-body-sm text-on-surface">{permission.label}</p>
                          <p className="font-body text-label-sm text-outline">{stateLabel}</p>
                        </div>
                        <ToggleSwitch
                          checked={enabled}
                          label={`${permission.label}: ${stateLabel}`}
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

      <BottomSheet open={sheet === 'edit-staff'} onClose={() => { setSheet(null); setEditing(null); }} title={t('staff.owner.form.editStaff' as TranslationKey)}>
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

      <BottomSheet open={sheet === 'edit-position'} onClose={() => { setSheet(null); setEditingPosition(null); }} title={t('staff.owner.form.editPosition' as TranslationKey)}>
        {editingPosition && (
          <form onSubmit={savePosition} className="flex flex-col gap-4">
            <label className="font-body text-label-md">{t('staff.owner.form.positionName' as TranslationKey)}
              <input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" />
            </label>
            <p className="rounded-lg bg-surface-container-low p-3 font-body text-body-sm text-on-surface-variant">
              {t(staff.filter((staffMember) => staffMember.positionId === editingPosition.id).length === 1 ? 'staff.owner.position.staffCountUsed.one' as TranslationKey : 'staff.owner.position.staffCountUsed.many' as TranslationKey, { count: staff.filter((staffMember) => staffMember.positionId === editingPosition.id).length })}
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
              <Button type="button" variant="secondary" onClick={() => { void duplicatePosition(); }}><MaterialIcon name="content_copy" />{t('staff.owner.position.duplicate' as TranslationKey)}</Button>
              <Button type="button" variant="danger" onClick={() => openDeletePosition(editingPosition)}><MaterialIcon name="delete" />{t('staff.owner.position.delete' as TranslationKey)}</Button>
            </div>
          </form>
        )}
      </BottomSheet>

      <BottomSheet open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title={t('staff.owner.position.deleteTitle' as TranslationKey)}>
        {deleteTarget && (
          <div className="flex flex-col gap-3">
            {staff.filter((staffMember) => staffMember.positionId === deleteTarget.id).length > 0 ? (
              <>
                <p className="font-body text-body-md text-on-surface-variant">
                  {t('staff.owner.position.moveStaff' as TranslationKey, { count: staff.filter((staffMember) => staffMember.positionId === deleteTarget.id).length, name: deleteTarget.name })}
                </p>
                <label className="font-body text-label-md">{t('staff.owner.position.moveLabel' as TranslationKey)}
                  <select required value={replacementPositionId} onChange={(event) => setReplacementPositionId(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary">
                    <option value="">{t('staff.owner.position.selectReplacement' as TranslationKey)}</option>
                    {positions.filter((position) => position.id !== deleteTarget.id).map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
                  </select>
                </label>
                {positions.filter((position) => position.id !== deleteTarget.id).length === 0 && <p className="font-body text-body-sm text-error-dark">{t('staff.owner.position.createReplacement' as TranslationKey)}</p>}
              </>
            ) : <p className="font-body text-body-md text-on-surface-variant">{t('staff.owner.position.deleteEmpty' as TranslationKey, { name: deleteTarget.name })}</p>}
            {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setDeleteTarget(null)}>{t('staff.owner.action.cancel' as TranslationKey)}</Button>
              <Button type="button" variant="danger" disabled={busy || (staff.some((staffMember) => staffMember.positionId === deleteTarget.id) && !replacementPositionId)} onClick={() => { void deletePosition(); }}>{t('staff.owner.position.delete' as TranslationKey)}</Button>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={Boolean(activeCredentials)} onClose={() => setActiveCredentials(null)} title={activeCredentials ? t(activeCredentials.title as TranslationKey) : undefined}>
        {activeCredentials && (
          <div className="flex flex-col gap-4">
            <p className="font-body text-body-md text-on-surface">{t('staff.owner.credentials.for' as TranslationKey, { name: activeCredentials.staffName })}</p>
            <label className="font-body text-label-md">{t('staff.owner.credentials.username' as TranslationKey)}
              <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input readOnly value={activeCredentials.username} className="h-12 min-w-0 rounded-lg bg-surface-container-low px-3 font-mono text-body-sm" />
                <Button type="button" variant="secondary" className="px-3" onClick={() => { void copyValue(t('staff.owner.credentials.username' as TranslationKey), activeCredentials.username); }}>{t('staff.owner.credentials.copy' as TranslationKey)}</Button>
              </div>
            </label>
            <label className="font-body text-label-md">{t('staff.owner.credentials.temporaryPassword' as TranslationKey)}
              <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input readOnly value={activeCredentials.password} className="h-12 min-w-0 rounded-lg bg-surface-container-low px-3 font-mono tracking-widest" />
                <Button type="button" variant="secondary" className="px-3" onClick={() => { void copyValue(t('staff.owner.credentials.temporaryPassword' as TranslationKey), activeCredentials.password); }}>{t('staff.owner.credentials.copy' as TranslationKey)}</Button>
              </div>
            </label>
            <p className="rounded-lg bg-primary-fixed/40 p-3 font-body text-body-sm text-on-surface">{t('staff.owner.credentials.passwordHelp' as TranslationKey)}</p>
            {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={() => { void copyAllCredentials(); }}>{t('staff.owner.credentials.copyAll' as TranslationKey)}</Button>
              <Button type="button" onClick={() => { void shareCredentials(); }}><MaterialIcon name="share" />{t('staff.owner.credentials.share' as TranslationKey)}</Button>
            </div>
            {notice && <p role="status" className="font-body text-body-sm text-success-dark">{notice}</p>}
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={Boolean(resetTarget)} onClose={() => setResetTarget(null)} title={t('staff.owner.password.resetTitle' as TranslationKey)}>
        <div className="flex flex-col gap-3">
          <p className="font-body text-body-md text-on-surface-variant">{t('staff.owner.password.resetDescription' as TranslationKey, { name: resetTarget?.name ?? '' })}</p>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setResetTarget(null)}>{t('staff.owner.action.cancel' as TranslationKey)}</Button>
            <Button type="button" disabled={busy} onClick={() => { void resetPassword(); }}>{t('staff.owner.password.reset' as TranslationKey)}</Button>
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
  const permissionLabel = t(enabled.length === 1 ? 'staff.owner.position.permission' as TranslationKey : 'staff.owner.position.permissions' as TranslationKey);
  const staffLabel = t(staffCount === 1 ? 'staff.owner.position.staffCount.one' as TranslationKey : 'staff.owner.position.staffCount.many' as TranslationKey, { count: staffCount });
  return (
    <button type="button" onClick={onClick} className="rounded-xl bg-surface-container-lowest p-4 text-left shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      <span className="flex items-center justify-between gap-2">
        <span className="font-body text-label-lg text-on-surface">{position.name}</span>
        <MaterialIcon name="edit" className="text-lg text-outline" />
      </span>
      <span className="mt-1 block font-body text-body-sm text-outline">
        {t('staff.owner.position.permissionCount' as TranslationKey, { staffLabel, count: enabled.length, permissionLabel })}
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
              <button type="button" onClick={() => onSelectAll(group)} className="min-h-12 rounded-lg px-3 font-body text-label-sm text-primary hover:bg-surface-container-low">{t('staff.owner.action.selectAll' as TranslationKey)}</button>
              <button type="button" onClick={() => onClearAll(group)} className="min-h-12 rounded-lg px-3 font-body text-label-sm text-primary hover:bg-surface-container-low">{t('staff.owner.action.clearAll' as TranslationKey)}</button>
            </div>
          </div>
          {permissions.filter((permission) => permission.group === group).map((permission) => {
            const enabled = selectedPermissions.includes(permission.id);
            const switchState = t(enabled ? 'staff.owner.permissions.on' as TranslationKey : 'staff.owner.permissions.off' as TranslationKey);
            return (
              <div key={permission.id} className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-surface-container-low px-3">
                <span className="font-body text-body-sm text-on-surface">{permission.label}</span>
                <ToggleSwitch
                  checked={enabled}
                  label={`${permission.label}: ${switchState}`}
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
  const visibleCategories = categoryQuery
    ? categories.filter((category) => category.name.toLocaleLowerCase().includes(categoryQuery))
    : [];
  const visibleItems = itemQuery
    ? items.filter((item) => item.name.toLocaleLowerCase().includes(itemQuery))
    : [];

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-3">
      <div>
        <h3 className="font-body text-label-lg text-on-surface">{t('staff.owner.drinks.title' as TranslationKey)}</h3>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">{t('staff.owner.drinks.description' as TranslationKey)}</p>
      </div>
      <label className="font-body text-label-md">{t('staff.owner.drinks.maxPerShift' as TranslationKey)}
        <input type="number" min="0" step="1" required value={maxQuantity} onChange={(event) => onMaxQuantityChange(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-lowest px-3 outline-none focus:ring-2 focus:ring-primary" />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 flex w-full items-center justify-between gap-2 font-body text-label-md">
          <span>{t('staff.owner.drinks.categories' as TranslationKey)}</span>
          <span className="text-label-sm text-outline">{t('staff.owner.drinks.selected' as TranslationKey, { count: selectedCategoryIds.length })}</span>
        </legend>
        <label className="relative block">
          <span className="sr-only">{t('staff.owner.drinks.searchCategories' as TranslationKey)}</span>
          <MaterialIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-outline" />
          <input
            type="search"
            value={categorySearch}
            onChange={(event) => setCategorySearch(event.target.value)}
            placeholder={t('staff.owner.drinks.searchCategories' as TranslationKey)}
            aria-label={t('staff.owner.drinks.searchAllowedCategories' as TranslationKey)}
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
          {visibleCategories.length === 0 && <p className="px-1 py-2 font-body text-body-sm text-outline">{t(categories.length === 0 ? 'staff.owner.drinks.noCategories' as TranslationKey : categoryQuery ? 'staff.owner.drinks.noMatchingCategories' as TranslationKey : 'staff.owner.drinks.searchToFindCategories' as TranslationKey)}</p>}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 flex w-full items-center justify-between gap-2 font-body text-label-md">
          <span>{t('staff.owner.drinks.items' as TranslationKey)}</span>
          <span className="text-label-sm text-outline">{t('staff.owner.drinks.selected' as TranslationKey, { count: selectedItemIds.length })}</span>
        </legend>
        <label className="relative block">
          <span className="sr-only">{t('staff.owner.drinks.searchItems' as TranslationKey)}</span>
          <MaterialIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-outline" />
          <input
            type="search"
            value={itemSearch}
            onChange={(event) => setItemSearch(event.target.value)}
            placeholder={t('staff.owner.drinks.searchItems' as TranslationKey)}
            aria-label={t('staff.owner.drinks.searchAllowedItems' as TranslationKey)}
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
          {visibleItems.length === 0 && <p className="px-1 py-2 font-body text-body-sm text-outline">{t(items.length === 0 ? 'staff.owner.drinks.noItems' as TranslationKey : itemQuery ? 'staff.owner.drinks.noMatchingItems' as TranslationKey : 'staff.owner.drinks.searchToFindItems' as TranslationKey)}</p>}
        </div>
      </fieldset>
    </section>
  );
}

export function OwnerStaffScreen() {
  return <OwnerStaffContent />;
}
