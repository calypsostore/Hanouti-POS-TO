import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { ListSkeleton } from '../components/ListSkeleton';
import { MaterialIcon } from '../components/MaterialIcon';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { StatusTag } from '../components/StatusTag';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { formatTnd } from '../lib/format';
import { compService } from '../services/compService';
import { orderService } from '../services/orderService';
import { scheduleService } from '../services/scheduleService';
import { shiftService } from '../services/shiftService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import { getLanguage, localizeErrorMessage } from '../i18n';
import { t, type TranslationKey } from '../i18n/translations';
import type { CompRecord, OrderRecord, PermissionDefinition, PermissionOverrides, PositionRecord, ScheduleShiftRecord, ShiftRecord, UserSummary } from '../types/domain';

type ProfileTab = 'overview' | 'schedule' | 'hours' | 'performance' | 'activity';

const PROFILE_TABS: { id: ProfileTab; key: string }[] = [
  { id: 'overview', key: 'staff.profile.tab.overview' },
  { id: 'schedule', key: 'staff.profile.tab.schedule' },
  { id: 'hours', key: 'staff.profile.tab.hours' },
  { id: 'performance', key: 'staff.profile.tab.performance' },
  { id: 'activity', key: 'staff.profile.tab.activity' },
];

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function dateRangeLabel(start: Date, days: number): string {
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return `${start.toLocaleDateString(getLanguage(), options)} – ${end.toLocaleDateString(getLanguage(), options)}`;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function lateMinutesFor(shift: ShiftRecord, schedule: ScheduleShiftRecord[]): number {
  const openedAt = new Date(shift.openedAt);
  const actualDate = localDateKey(openedAt);
  const previousDate = new Date(openedAt);
  previousDate.setDate(previousDate.getDate() - 1);
  const previousDateKey = localDateKey(previousDate);
  const candidates = schedule.filter((planned) => {
    if (planned.date === actualDate) return true;
    if (planned.date !== previousDateKey) return false;
    return planned.endTime <= planned.startTime;
  });
  if (candidates.length === 0) return 0;
  const plannedStart = candidates.reduce((best, planned) => {
    const candidate = new Date(`${planned.date}T${planned.startTime}:00`).getTime();
    return Math.abs(candidate - openedAt.getTime()) < Math.abs(best - openedAt.getTime()) ? candidate : best;
  }, new Date(`${candidates[0].date}T${candidates[0].startTime}:00`).getTime());
  return Math.max(0, Math.round((openedAt.getTime() - plannedStart) / 60_000));
}

function formatHours(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.round(milliseconds / 60_000));
  return t('staff.profile.hours.duration' as TranslationKey, { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 });
}

function formatShiftTime(value: string): string {
  return new Date(value).toLocaleTimeString(getLanguage(), { hour: '2-digit', minute: '2-digit', hour12: false });
}

function overridesFor(user: UserSummary): PermissionOverrides {
  return user.permissionOverrides ?? { granted: [], revoked: [] };
}

function ProfileContent() {
  const { id = '' } = useParams<{ id: string }>();
  const owner = useAuthStore((state) => state.user);
  const storeId = owner?.storeId ?? '';
  const [staff, setStaff] = useState<UserSummary | null>(null);
  const [storeName, setStoreName] = useState<string>();
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [permissions, setPermissions] = useState<PermissionDefinition[]>([]);
  const [effectivePermissions, setEffectivePermissions] = useState<string[]>([]);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [comps, setComps] = useState<CompRecord[]>([]);
  const [plannedShifts, setPlannedShifts] = useState<ScheduleShiftRecord[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editPositionId, setEditPositionId] = useState('');

  const [confirmation, setConfirmation] = useState<'reset' | 'logout' | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [pinResetOpen, setPinResetOpen] = useState(false);
  const [generatedStaffPin, setGeneratedStaffPin] = useState('');
  const [scheduleEditorOpen, setScheduleEditorOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleShiftRecord | null>(null);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleStartTime, setScheduleStartTime] = useState('');
  const [scheduleEndTime, setScheduleEndTime] = useState('');
  const [scheduleNote, setScheduleNote] = useState('');

  const refresh = useCallback(async () => {
    if (!storeId || !id) return;
    const [nextStaff, nextStore, nextPositions, nextPermissions, nextShifts, nextOrders, nextComps, nextPlannedShifts, nextEffectivePermissions] = await Promise.all([
      userService.getUser(id),
      userService.getStore(storeId),
      userService.listPositions(storeId),
      userService.listPermissionDefinitions(),
      shiftService.listShifts(storeId),
      orderService.listAll(storeId),
      compService.listComps(storeId),
      scheduleService.listForStaff(storeId, id),
      userService.getEffectivePermissions(id),
    ]);
    setCurrentTime(Date.now());
    setStoreName(nextStore?.name);
    setPositions(nextPositions);
    setPermissions(nextPermissions);
    setShifts(nextShifts.filter((shift) => shift.staffId === id));
    setOrders(nextOrders.filter((order) => order.staffId === id));
    setComps(nextComps.filter((comp) => comp.staffId === id));
    setPlannedShifts(nextPlannedShifts);
    setEffectivePermissions(nextEffectivePermissions);
    if (!nextStaff || nextStaff.role !== 'staff' || nextStaff.storeId !== storeId) {
      setStaff(null);
      throw new Error(t('staff.profile.error.notFound' as TranslationKey));
    }
    setStaff(nextStaff);
  }, [id, storeId]);

  useEffect(() => {
    let active = true;
    const load = () => {
      void refresh().catch((loadError: unknown) => {
        console.error('Unable to load the staff profile.', loadError);
        if (active) setError(t('staff.profile.error.load' as TranslationKey));
      }).finally(() => {
        if (active) setLoading(false);
      });
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const positionName = staff ? positions.find((position) => position.id === staff.positionId)?.name ?? t('staff.self.positionUnassigned' as TranslationKey) : '';
  const inheritedPermissions = staff
    ? positions.find((position) => position.id === staff.positionId)?.permissionIds ?? []
    : [];
  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, PermissionDefinition[]>();
    for (const permission of permissions) {
      const current = groups.get(permission.group) ?? [];
      current.push(permission);
      groups.set(permission.group, current);
    }
    return [...groups.entries()];
  }, [permissions]);

  const now = currentTime;
  const weekStart = startOfWeek(new Date(now));
  const nextWeekStart = new Date(weekStart);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const fortnightEnd = new Date(nextWeekStart);
  fortnightEnd.setDate(fortnightEnd.getDate() + 7);
  const thisWeekShifts = plannedShifts.filter((shift) => {
    return shift.date >= localDateKey(weekStart) && shift.date < localDateKey(nextWeekStart);
  });
  const nextWeekShifts = plannedShifts.filter((shift) => {
    return shift.date >= localDateKey(nextWeekStart) && shift.date < localDateKey(fortnightEnd);
  });

  function openEdit() {
    if (!staff) return;
    setEditName(staff.name);
    setEditPhone(staff.phone ?? '');
    setEditNotes(staff.notes ?? '');
    setEditPositionId(staff.positionId ?? '');
    setError('');
    setEditOpen(true);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!staff) return;
    setBusy(true);
    setError('');
    try {
      await userService.updateStaff(staff.id, {
        name: editName,
        phone: editPhone,
        notes: editNotes,
        positionId: editPositionId,
      });
      await refresh();
      setEditOpen(false);
      setNotice(t('staff.profile.notice.updated' as TranslationKey));
    } catch (saveError) {
      setError(localizeErrorMessage(saveError, t('staff.profile.error.update' as TranslationKey)));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!staff) return;
    setBusy(true);
    setError('');
    try {
      await userService.updateStaff(staff.id, { isActive: !staff.isActive });
      await refresh();
      setNotice(t(staff.isActive ? 'staff.profile.notice.suspended' as TranslationKey : 'staff.profile.notice.enabled' as TranslationKey));
    } catch (updateError) {
      setError(localizeErrorMessage(updateError, t('staff.profile.error.updateStatus' as TranslationKey)));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!staff) return;
    setBusy(true);
    setError('');
    try {
      const password = await userService.resetStaffPassword(staff.id);
      setTemporaryPassword(password);
      setConfirmation(null);
      setNotice('');
      await refresh();
    } catch (resetError) {
      setError(localizeErrorMessage(resetError, t('staff.profile.error.resetPassword' as TranslationKey)));
    } finally {
      setBusy(false);
    }
  }

  async function generateStaffPin() {
    if (!staff || !owner || owner.role !== 'owner') return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const pin = await userService.generateStaffPin(owner.id, staff.id);
      setGeneratedStaffPin(pin);
      await refresh();
    } catch (resetError) {
      setError(localizeErrorMessage(resetError, t('staff.profile.error.generatePin' as TranslationKey)));
    } finally {
      setBusy(false);
    }
  }

  async function forceLogout() {
    if (!staff) return;
    setBusy(true);
    setError('');
    try {
      await userService.forceLogoutStaff(staff.id);
      setConfirmation(null);
      setNotice(t('staff.profile.notice.sessionRevoked' as TranslationKey));
    } catch (logoutError) {
      setError(localizeErrorMessage(logoutError, t('staff.profile.error.forceLogout' as TranslationKey)));
    } finally {
      setBusy(false);
    }
  }

  async function togglePermission(permissionId: string) {
    if (!staff) return;
    setBusy(true);
    setError('');
    const currentOverrides = overridesFor(staff);
    const hasOverride = currentOverrides.granted.includes(permissionId) || currentOverrides.revoked.includes(permissionId);
    const nextOverrides: PermissionOverrides = hasOverride
      ? {
          granted: currentOverrides.granted.filter((value) => value !== permissionId),
          revoked: currentOverrides.revoked.filter((value) => value !== permissionId),
        }
      : inheritedPermissions.includes(permissionId)
        ? { granted: currentOverrides.granted, revoked: [...currentOverrides.revoked, permissionId] }
        : { granted: [...currentOverrides.granted, permissionId], revoked: currentOverrides.revoked };
    try {
      await userService.setPermissionOverrides(staff.id, nextOverrides);
      await refresh();
    } catch (permissionError) {
      setError(localizeErrorMessage(permissionError, t('staff.profile.error.updatePermissions' as TranslationKey)));
    } finally {
      setBusy(false);
    }
  }

  function openScheduleEditor(shift?: ScheduleShiftRecord) {
    setEditingSchedule(shift ?? null);
    setScheduleDate(shift?.date ?? '');
    setScheduleStartTime(shift?.startTime ?? '');
    setScheduleEndTime(shift?.endTime ?? '');
    setScheduleNote(shift?.note ?? '');
    setError('');
    setScheduleEditorOpen(true);
  }

  async function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!staff) return;
    setBusy(true);
    setError('');
    try {
      await scheduleService.save({
        storeId,
        staffId: staff.id,
        date: scheduleDate,
        startTime: scheduleStartTime,
        endTime: scheduleEndTime,
        note: scheduleNote,
      }, editingSchedule?.id);
      await refresh();
      setScheduleEditorOpen(false);
      setNotice(t('staff.profile.notice.shiftSaved' as TranslationKey));
    } catch (scheduleError) {
      setError(localizeErrorMessage(scheduleError, t('staff.profile.error.saveShift' as TranslationKey)));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSchedule(shift: ScheduleShiftRecord) {
    setBusy(true);
    setError('');
    try {
      await scheduleService.delete(shift.id, storeId);
      await refresh();
      setScheduleEditorOpen(false);
      setNotice(t('staff.profile.notice.shiftDeleted' as TranslationKey));
    } catch (scheduleError) {
      setError(localizeErrorMessage(scheduleError, t('staff.profile.error.deleteShift' as TranslationKey)));
    } finally {
      setBusy(false);
    }
  }

  async function copyPassword() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error(t('staff.profile.error.clipboardUnavailable' as TranslationKey));
      await navigator.clipboard.writeText(temporaryPassword);
      setNotice(t('staff.profile.notice.passwordCopied' as TranslationKey));
    } catch (copyError) {
      setError(localizeErrorMessage(copyError, t('staff.profile.error.copyPassword' as TranslationKey)));
    }
  }

  async function copyGeneratedStaffPin() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error(t('staff.profile.error.clipboardUnavailable' as TranslationKey));
      await navigator.clipboard.writeText(generatedStaffPin);
      setNotice(t('staff.profile.notice.pinCopied' as TranslationKey));
    } catch (copyError) {
      setError(localizeErrorMessage(copyError, t('staff.profile.error.copyPin' as TranslationKey)));
    }
  }

  const weekShifts = shifts.filter((shift) => {
    const openedAt = new Date(shift.openedAt);
    return openedAt >= weekStart && openedAt < nextWeekStart;
  });
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthShifts = shifts.filter((shift) => new Date(shift.openedAt) >= monthStart);
  const durationFor = (periodShifts: ShiftRecord[]) => periodShifts.reduce((sum, shift) => {
    const openedAt = new Date(shift.openedAt).getTime();
    const closedAt = shift.closedAt ? new Date(shift.closedAt).getTime() : now;
    return sum + Math.max(0, closedAt - openedAt);
  }, 0);
  const differenceFor = (periodShifts: ShiftRecord[]) => periodShifts.reduce((sum, shift) => sum + (shift.differenceMillimes ?? 0), 0);
  const statsForDays = (days: number) => {
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    const periodOrders = orders.filter((order) => new Date(order.createdAt).getTime() >= cutoff);
    const completed = periodOrders.filter((order) => order.status === 'done');
    const sales = completed.reduce((sum, order) => sum + order.totalMillimes, 0);
    const voidRequests = periodOrders.filter((order) =>
      order.voidRequestedAt && new Date(order.voidRequestedAt).getTime() >= cutoff).length;
    const periodComps = comps.filter((comp) => new Date(comp.createdAt).getTime() >= cutoff);
    return {
      orderCount: completed.length,
      sales,
      average: completed.length ? sales / completed.length : 0,
      voidRequests,
      compCount: periodComps.length,
      compValue: periodComps.reduce((sum, comp) => sum + comp.valueMillimes, 0),
    };
  };
  const performance7 = statsForDays(7);
  const performance30 = statsForDays(30);

  return (
    <WorkspaceLayout title={t('staff.profile.title' as TranslationKey)} storeName={storeName} links={ownerWorkspaceLinks}>
      <Link to="/owner/staff" className="mb-4 inline-flex min-h-12 items-center gap-2 rounded-lg pr-3 font-body text-label-md text-primary hover:bg-surface-container-low">
        <MaterialIcon name="arrow_back" />
        {t('staff.profile.back' as TranslationKey)}
      </Link>

      {loading ? (
        <ListSkeleton rows={3} label={t('staff.profile.loading' as TranslationKey)} />
      ) : staff ? (
        <>
          <section className="mb-5 rounded-2xl bg-surface-container-lowest p-4 shadow-card sm:p-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <span className="h-14 w-14 shrink-0 overflow-hidden rounded-full">
                  <ProfileAvatar avatarId={staff.avatarId} className="h-full w-full" />
                </span>
                <div className="min-w-0 flex-1">
                  <h1 className="break-words font-display text-headline-lg text-on-surface">{staff.name}</h1>
                  <p className="mt-1 break-all font-body text-body-sm text-outline">{staff.username ?? t('staff.profile.username.none' as TranslationKey)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full bg-secondary-container px-3 py-1.5 font-body text-label-sm text-on-secondary-container">{positionName}</span>
                    <StatusTag status={staff.isActive ? 'open' : 'suspended'}>{t(staff.isActive ? 'staff.profile.status.active' as TranslationKey : 'staff.profile.status.suspended' as TranslationKey)}</StatusTag>
                    <span className={`rounded-full px-3 py-1.5 font-body text-label-sm ${staff.mustSetPin ? 'bg-warning-container text-on-warning-container' : 'bg-success-container text-success-dark'}`}>
                      {t(staff.mustSetPin ? 'staff.profile.pin.unassigned' as TranslationKey : 'staff.profile.pin.assigned' as TranslationKey)}
                    </span>
                  </div>
                </div>
              </div>
              <dl className="grid gap-3 rounded-xl bg-surface-container-low p-3 sm:grid-cols-3 sm:p-4">
                <ProfileDetail label={t('staff.profile.detail.phone' as TranslationKey)} value={staff.phone || t('staff.profile.detail.phoneMissing' as TranslationKey)} />
                <ProfileDetail label={t('staff.profile.detail.hireDate' as TranslationKey)} value={new Date(staff.createdAt).toLocaleDateString(getLanguage(), { day: 'numeric', month: 'short', year: 'numeric' })} />
                <ProfileDetail label={t('staff.profile.detail.notes' as TranslationKey)} value={staff.notes || t('staff.profile.detail.notesMissing' as TranslationKey)} />
              </dl>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <Button variant="secondary" onClick={openEdit}><MaterialIcon name="edit" />{t('staff.profile.action.edit' as TranslationKey)}</Button>
                <Button variant="secondary" onClick={() => { setError(''); setConfirmation('reset'); }}><MaterialIcon name="lock_reset" />{t('staff.profile.action.resetPassword' as TranslationKey)}</Button>
                <Button variant="secondary" disabled={busy} onClick={() => { setError(''); setGeneratedStaffPin(''); setPinResetOpen(true); }}>
                  <MaterialIcon name="pin" />{t(staff.mustSetPin ? 'staff.profile.action.generatePin' as TranslationKey : 'staff.profile.action.replacePin' as TranslationKey)}
                </Button>
                <Button variant={staff.isActive ? 'danger' : 'secondary'} disabled={busy} onClick={() => { void toggleActive(); }}>
                  <MaterialIcon name={staff.isActive ? 'person_off' : 'person'} />
                  {t(staff.isActive ? 'staff.profile.action.suspend' as TranslationKey : 'staff.profile.action.enable' as TranslationKey)}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => { setError(''); setConfirmation('logout'); }}><MaterialIcon name="logout" />{t('staff.profile.action.forceLogout' as TranslationKey)}</Button>
              </div>
            </div>
          </section>

          <div role="tablist" aria-label={t('staff.profile.tabs.label' as TranslationKey)} className="scrollbar-hidden mb-4 flex gap-2 overflow-x-auto rounded-xl bg-surface-container-low p-1">
            {PROFILE_TABS.map((tab) => (
              <button
                key={tab.id}
                id={`staff-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`staff-panel-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-12 shrink-0 rounded-lg px-4 font-body text-label-md ${activeTab === tab.id ? 'bg-primary text-on-primary shadow-card' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
              >
                {t(tab.key as TranslationKey)}
              </button>
            ))}
          </div>

          <section id={`staff-panel-${activeTab}`} role="tabpanel" aria-labelledby={`staff-tab-${activeTab}`} className="min-w-0">
            {activeTab === 'overview' && (
              <div className="flex flex-col gap-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <ProfileDetailCard label={t('staff.profile.detail.phone' as TranslationKey)} value={staff.phone || t('staff.profile.detail.phoneMissing' as TranslationKey)} icon="call" />
                  <ProfileDetailCard label={t('staff.profile.detail.hireDate' as TranslationKey)} value={new Date(staff.createdAt).toLocaleDateString(getLanguage(), { day: 'numeric', month: 'long', year: 'numeric' })} icon="event" />
                  <ProfileDetailCard label={t('staff.profile.edit.position' as TranslationKey)} value={positionName} icon="badge" />
                  <ProfileDetailCard label={t('staff.profile.accountStatus' as TranslationKey)} value={t(staff.isActive ? 'staff.profile.status.active' as TranslationKey : 'staff.profile.status.suspended' as TranslationKey)} icon={staff.isActive ? 'check_circle' : 'block'} />
                </div>
                <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
                  <div className="mb-4">
                    <h2 className="font-display text-headline-md text-on-surface">{t('staff.profile.permissions.title' as TranslationKey)}</h2>
                    <p className="mt-1 font-body text-body-sm text-outline">{t('staff.profile.permissions.help' as TranslationKey)}</p>
                  </div>
                  <div className="flex flex-col gap-5">
                    {groupedPermissions.map(([group, groupPermissions]) => (
                      <section key={group} className="flex flex-col gap-2">
                        <h3 className="font-body text-label-lg text-on-surface">{group}</h3>
                        {groupPermissions.map((permission) => {
                          const currentOverrides = overridesFor(staff);
                          const blocked = currentOverrides.revoked.includes(permission.id);
                          const granted = currentOverrides.granted.includes(permission.id);
                          const enabled = effectivePermissions.includes(permission.id);
                          const state = t(blocked ? 'staff.owner.permissions.blocked' as TranslationKey : granted ? 'staff.owner.permissions.granted' as TranslationKey : 'staff.owner.permissions.inherited' as TranslationKey);
                          return (
                            <PermissionOverrideRow
                              key={permission.id}
                              permission={permission}
                              state={state}
                              enabled={enabled}
                              disabled={busy}
                              onToggle={() => { void togglePermission(permission.id); }}
                            />
                          );
                        })}
                      </section>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'schedule' && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-display text-headline-md text-on-surface">{t('staff.profile.shift.planned' as TranslationKey)}</h2>
                  <Button onClick={() => openScheduleEditor()}><MaterialIcon name="edit_calendar" />{t('staff.profile.action.edit' as TranslationKey)}</Button>
                </div>
                <PlannedShiftWeek title={t('staff.profile.shift.thisWeek' as TranslationKey)} range={dateRangeLabel(weekStart, 7)} shifts={thisWeekShifts} onEdit={openScheduleEditor} />
                <PlannedShiftWeek title={t('staff.profile.shift.nextWeek' as TranslationKey)} range={dateRangeLabel(nextWeekStart, 7)} shifts={nextWeekShifts} onEdit={openScheduleEditor} />
              </div>
            )}

            {activeTab === 'hours' && (
              <div className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <HoursSummary title={t('staff.profile.shift.thisWeek' as TranslationKey)} shifts={weekShifts} duration={durationFor(weekShifts)} difference={differenceFor(weekShifts)} />
                  <HoursSummary title={t('staff.profile.shift.thisMonth' as TranslationKey)} shifts={monthShifts} duration={durationFor(monthShifts)} difference={differenceFor(monthShifts)} />
                </div>
                <section className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-card">
                  <h2 className="p-4 font-display text-headline-md text-on-surface">{t('staff.profile.shift.history' as TranslationKey)}</h2>
                  {shifts.length === 0 ? (
                    <p className="px-4 pb-4 font-body text-body-sm text-outline">{t('staff.profile.shift.noneRecorded' as TranslationKey)}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="mobile-card-table w-full min-w-[640px] border-collapse text-left">
                        <thead className="bg-surface-container-low font-body text-label-sm text-outline">
                          <tr>
                            <th className="px-4 py-3">{t('staff.profile.table.date' as TranslationKey)}</th>
                            <th className="px-4 py-3">{t('staff.profile.table.opened' as TranslationKey)}</th>
                            <th className="px-4 py-3">{t('staff.profile.table.closed' as TranslationKey)}</th>
                            <th className="px-4 py-3">{t('staff.profile.table.totalHours' as TranslationKey)}</th>
                            <th className="px-4 py-3">{t('staff.profile.table.punctuality' as TranslationKey)}</th>
                            <th className="px-4 py-3">{t('staff.profile.table.cashDifference' as TranslationKey)}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...shifts].sort((left, right) => right.openedAt.localeCompare(left.openedAt)).map((shift) => {
                            const openedAt = new Date(shift.openedAt);
                            const closedAt = shift.closedAt ? new Date(shift.closedAt) : new Date(now);
                            return (
                              <tr key={shift.id} className="border-t border-outline-variant font-body text-body-sm text-on-surface">
                                <td data-label={t('staff.profile.table.date' as TranslationKey)}>{openedAt.toLocaleDateString(getLanguage(), { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                                <td data-label={t('staff.profile.table.opened' as TranslationKey)}>{formatShiftTime(shift.openedAt)}</td>
                                <td data-label={t('staff.profile.table.closed' as TranslationKey)}>{shift.closedAt ? formatShiftTime(shift.closedAt) : t('staff.profile.shift.open' as TranslationKey)}</td>
                                <td data-label={t('staff.profile.table.totalHours' as TranslationKey)}>{formatHours(closedAt.getTime() - openedAt.getTime())}</td>
                                <td data-label={t('staff.profile.table.punctuality' as TranslationKey)}>{lateMinutesFor(shift, plannedShifts) > 0 ? t('staff.profile.shift.late' as TranslationKey, { minutes: lateMinutesFor(shift, plannedShifts) }) : '—'}</td>
                                <td data-label={t('staff.profile.table.cashDifference' as TranslationKey)}>{shift.differenceMillimes === undefined ? '—' : `${formatTnd(shift.differenceMillimes / 1000)} DT`}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            )}

            {activeTab === 'performance' && (
              <div className="grid gap-4 lg:grid-cols-2">
                <PerformanceCard title={t('staff.profile.performance.last7Days' as TranslationKey)} stats={performance7} />
                <PerformanceCard title={t('staff.profile.performance.last30Days' as TranslationKey)} stats={performance30} />
              </div>
            )}

            {activeTab === 'activity' && (
              <div className="rounded-2xl bg-surface-container-lowest px-5 py-10 text-center shadow-card">
                <MaterialIcon name="history" className="text-4xl text-outline" />
                <h2 className="mt-3 font-display text-headline-md text-on-surface">{t('staff.profile.activity.none' as TranslationKey)}</h2>
                <p className="mt-1 font-body text-body-sm text-outline">{t('staff.profile.activity.help' as TranslationKey)}</p>
              </div>
            )}
          </section>

          {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mt-4 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}
        </>
      ) : (
        <div className="rounded-2xl bg-surface-container-lowest p-6 text-center shadow-card">
          <MaterialIcon name="person_off" className="text-4xl text-outline" />
          <h1 className="mt-3 font-display text-headline-md text-on-surface">{t('staff.profile.notFound' as TranslationKey)}</h1>
          {error && <p role="alert" className="mt-2 font-body text-body-sm text-error-dark">{error}</p>}
        </div>
      )}

      <BottomSheet open={editOpen} onClose={() => setEditOpen(false)} title={t('staff.profile.edit.title' as TranslationKey)}>
        <form onSubmit={(event) => { void saveProfile(event); }} className="flex flex-col gap-3">
          <label className="font-body text-label-md">{t('staff.profile.edit.name' as TranslationKey)}
            <input required value={editName} onChange={(event) => setEditName(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
          </label>
          <label className="font-body text-label-md">{t('staff.profile.edit.username' as TranslationKey)}
            <input readOnly value={staff?.username ?? ''} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 font-mono text-body-sm" />
          </label>
          <label className="font-body text-label-md">{t('staff.profile.detail.phone' as TranslationKey)}
            <input type="tel" value={editPhone} onChange={(event) => setEditPhone(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
          </label>
          <label className="font-body text-label-md">{t('staff.profile.edit.position' as TranslationKey)}
            <select required value={editPositionId} onChange={(event) => setEditPositionId(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3">
              <option value="">{t('staff.profile.edit.selectPosition' as TranslationKey)}</option>
              {positions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
            </select>
          </label>
          <label className="font-body text-label-md">{t('staff.profile.detail.notes' as TranslationKey)}
            <textarea rows={3} value={editNotes} onChange={(event) => setEditNotes(event.target.value)} className="mt-1 w-full rounded-lg bg-surface-container-low px-3 py-3" />
          </label>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit" disabled={busy}>{t('staff.profile.edit.save' as TranslationKey)}</Button>
        </form>
      </BottomSheet>

      <BottomSheet open={confirmation !== null} onClose={() => setConfirmation(null)} title={t(confirmation === 'reset' ? 'staff.profile.password.confirmTitle' as TranslationKey : 'staff.profile.logout.confirmTitle' as TranslationKey)}>
        <div className="flex flex-col gap-4">
          <p className="font-body text-body-md text-on-surface-variant">
            {confirmation === 'reset'
              ? t('staff.profile.password.confirmDescription' as TranslationKey, { name: staff?.name ?? '' })
              : t('staff.profile.logout.confirmDescription' as TranslationKey, { name: staff?.name ?? '' })}
          </p>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>{t('staff.profile.action.cancel' as TranslationKey)}</Button>
            <Button type="button" disabled={busy} onClick={() => { void (confirmation === 'reset' ? resetPassword() : forceLogout()); }}>
              {t(confirmation === 'reset' ? 'staff.profile.action.reset' as TranslationKey : 'staff.profile.action.forceLogout' as TranslationKey)}
            </Button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={Boolean(temporaryPassword)} onClose={() => setTemporaryPassword('')} title={t('staff.profile.password.title' as TranslationKey)}>
        {staff && temporaryPassword && (
          <div className="flex flex-col gap-4">
            <p className="font-body text-body-md text-on-surface">{t('staff.profile.password.new' as TranslationKey, { name: staff.name })}</p>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <input readOnly value={temporaryPassword} className="h-12 min-w-0 rounded-lg bg-surface-container-low px-3 font-mono tracking-widest" />
              <Button type="button" variant="secondary" className="px-3" onClick={() => { void copyPassword(); }}>{t('staff.profile.password.copy' as TranslationKey)}</Button>
            </div>
            <p className="rounded-lg bg-primary-fixed/40 p-3 font-body text-body-sm text-on-surface">{t('staff.profile.password.instructions' as TranslationKey)}</p>
            {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        open={pinResetOpen}
        onClose={() => { setPinResetOpen(false); setGeneratedStaffPin(''); }}
        title={t(generatedStaffPin ? 'staff.profile.pin.generatedTitle' as TranslationKey : staff?.mustSetPin ? 'staff.profile.pin.generateTitle' as TranslationKey : 'staff.profile.pin.replaceTitle' as TranslationKey)}
      >
        <div className="flex flex-col gap-4">
          {generatedStaffPin ? (
            <>
              <p className="font-body text-body-md text-on-surface">{t('staff.profile.pin.share' as TranslationKey, { name: staff?.name ?? '' })}</p>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input readOnly value={generatedStaffPin} aria-label={t('staff.profile.pin.inputLabel' as TranslationKey)} className="h-14 min-w-0 rounded-lg bg-surface-container-low px-3 text-center font-mono text-headline-md tracking-[0.5em]" />
                <Button type="button" variant="secondary" className="px-3" onClick={() => { void copyGeneratedStaffPin(); }}>{t('staff.profile.password.copy' as TranslationKey)}</Button>
              </div>
              {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
              <Button type="button" onClick={() => { setPinResetOpen(false); setGeneratedStaffPin(''); }}>{t('staff.profile.pin.done' as TranslationKey)}</Button>
            </>
          ) : (
            <>
              <p className="font-body text-body-md text-on-surface-variant">
                {staff?.mustSetPin
                  ? t('staff.profile.pin.generateDescription' as TranslationKey, { name: staff?.name ?? '' })
                  : t('staff.profile.pin.replaceDescription' as TranslationKey, { name: staff?.name ?? '' })}
                {' '}{t('staff.profile.pin.instructions' as TranslationKey)}
              </p>
              {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setPinResetOpen(false)}>{t('staff.profile.action.cancel' as TranslationKey)}</Button>
                <Button type="button" disabled={busy} onClick={() => { void generateStaffPin(); }}>
                  {busy ? t('staff.profile.pin.generating' as TranslationKey) : t(staff?.mustSetPin ? 'staff.profile.action.generatePin' as TranslationKey : 'staff.profile.action.replacePin' as TranslationKey)}
                </Button>
              </div>
            </>
          )}
        </div>
      </BottomSheet>

      <BottomSheet open={scheduleEditorOpen} onClose={() => setScheduleEditorOpen(false)} title={t(editingSchedule ? 'staff.profile.schedule.edit' as TranslationKey : 'staff.profile.schedule.add' as TranslationKey)}>
        <form onSubmit={(event) => { void saveSchedule(event); }} className="flex flex-col gap-3">
          <label className="font-body text-label-md">{t('staff.profile.schedule.date' as TranslationKey)}
            <input required type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="font-body text-label-md">{t('staff.profile.schedule.start' as TranslationKey)}
              <input required type="time" value={scheduleStartTime} onChange={(event) => setScheduleStartTime(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
            </label>
            <label className="font-body text-label-md">{t('staff.profile.schedule.end' as TranslationKey)}
              <input required type="time" value={scheduleEndTime} onChange={(event) => setScheduleEndTime(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
            </label>
          </div>
          <label className="font-body text-label-md">{t('staff.profile.schedule.noteOptional' as TranslationKey)}
            <textarea rows={2} value={scheduleNote} onChange={(event) => setScheduleNote(event.target.value)} className="mt-1 w-full rounded-lg bg-surface-container-low px-3 py-3" />
          </label>
          {editingSchedule && (
            <Button type="button" variant="danger" disabled={busy} onClick={() => { void deleteSchedule(editingSchedule); }}>{t('staff.profile.schedule.delete' as TranslationKey)}</Button>
          )}
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit" disabled={busy}>{t('staff.profile.schedule.save' as TranslationKey)}</Button>
        </form>
      </BottomSheet>
    </WorkspaceLayout>
  );
}

function ProfileDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-body text-label-sm text-outline">{label}</dt>
      <dd className="mt-0.5 break-words font-body text-body-sm text-on-surface">{value}</dd>
    </div>
  );
}

function ProfileDetailCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="flex min-h-20 items-start gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card">
      <MaterialIcon name={icon} className="text-xl text-primary" />
      <div className="min-w-0">
        <p className="font-body text-label-sm text-outline">{label}</p>
        <p className="mt-1 break-words font-body text-label-md text-on-surface">{value}</p>
      </div>
    </div>
  );
}

function PermissionOverrideRow({ permission, state, enabled, disabled, onToggle }: {
  permission: PermissionDefinition;
  state: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-lg bg-surface-container-low px-3">
      <div className="min-w-0">
        <p className="font-body text-body-sm text-on-surface">{permission.label}</p>
        <p className="font-body text-label-sm text-outline">{state}</p>
      </div>
      <ToggleSwitch checked={enabled} label={`${permission.label}: ${state}`} disabled={disabled} onChange={onToggle} />
    </div>
  );
}

function PlannedShiftWeek({ title, range, shifts, onEdit }: {
  title: string;
  range: string;
  shifts: ScheduleShiftRecord[];
  onEdit: (shift: ScheduleShiftRecord) => void;
}) {
  return (
    <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
      <div className="mb-3">
        <h3 className="font-display text-title-lg text-on-surface">{title}</h3>
        <p className="font-body text-body-sm text-outline">{range}</p>
      </div>
      {shifts.length === 0 ? (
        <p className="rounded-lg bg-surface-container-low p-3 font-body text-body-sm text-outline">{t('staff.profile.schedule.none' as TranslationKey)}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {shifts.map((shift) => (
            <div key={shift.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-low p-3">
              <div className="min-w-0">
                <p className="font-body text-label-md text-on-surface">
                  {new Date(`${shift.date}T00:00:00`).toLocaleDateString(getLanguage(), { weekday: 'short', day: 'numeric', month: 'short' })}
                  {' · '}
                  {shift.startTime}–{shift.endTime}
                </p>
                {shift.note && <p className="mt-0.5 truncate font-body text-body-sm text-outline">{shift.note}</p>}
              </div>
              <Button type="button" variant="secondary" className="shrink-0 px-3" onClick={() => onEdit(shift)}>{t('staff.profile.action.edit' as TranslationKey)}</Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function HoursSummary({ title, shifts, duration, difference }: { title: string; shifts: ShiftRecord[]; duration: number; difference: number }) {
  return (
    <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
      <h3 className="font-body text-label-md text-outline">{title}</h3>
      <p className="mt-1 font-display text-headline-md text-on-surface">{formatHours(duration)}</p>
      <p className="mt-2 font-body text-body-sm text-outline">{t('staff.profile.hours.summary' as TranslationKey, { count: shifts.length, amount: formatTnd(difference / 1000) })}</p>
    </section>
  );
}

function PerformanceCard({ title, stats }: {
  title: string;
  stats: { orderCount: number; sales: number; average: number; voidRequests: number; compCount: number; compValue: number };
}) {
  return (
    <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
      <h2 className="mb-3 font-display text-headline-md text-on-surface">{title}</h2>
      <dl className="flex flex-col gap-3">
        <ProfileDetail label={t('staff.profile.performance.orders' as TranslationKey)} value={String(stats.orderCount)} />
        <ProfileDetail label={t('staff.profile.performance.sales' as TranslationKey)} value={`${formatTnd(stats.sales / 1000)} DT`} />
        <ProfileDetail label={t('staff.profile.performance.averageOrder' as TranslationKey)} value={`${formatTnd(stats.average / 1000)} DT`} />
        <ProfileDetail label={t('staff.profile.performance.voids' as TranslationKey)} value={String(stats.voidRequests)} />
        <ProfileDetail label={t('staff.profile.performance.comps' as TranslationKey)} value={`${stats.compCount} · ${formatTnd(stats.compValue / 1000)} DT`} />
      </dl>
    </section>
  );
}

export function OwnerStaffProfileScreen() {
  return <ProfileContent />;
}
