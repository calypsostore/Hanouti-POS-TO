import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Keypad } from '../components/Keypad';
import { ListSkeleton } from '../components/ListSkeleton';
import { MaterialIcon } from '../components/MaterialIcon';
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
import type { CompRecord, OrderRecord, PermissionDefinition, PermissionOverrides, PositionRecord, ScheduleShiftRecord, ShiftRecord, UserSummary } from '../types/domain';

type ProfileTab = 'overview' | 'schedule' | 'hours' | 'performance' | 'activity';

const PROFILE_TABS: { id: ProfileTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'hours', label: 'Hours' },
  { id: 'performance', label: 'Performance' },
  { id: 'activity', label: 'Activity' },
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
  return `${start.toLocaleDateString([], options)} – ${end.toLocaleDateString([], options)}`;
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
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

function formatShiftTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function initialsFor(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0] ?? '').join('').toLocaleUpperCase() || '?';
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
  const [staffPin, setStaffPin] = useState('');
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
      throw new Error('Staff account could not be found.');
    }
    setStaff(nextStaff);
  }, [id, storeId]);

  useEffect(() => {
    let active = true;
    const load = () => {
      void refresh().catch((loadError: unknown) => {
        console.error('Unable to load the staff profile.', loadError);
        if (active) setError('Unable to load this staff profile. Please try again.');
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

  const positionName = staff ? positions.find((position) => position.id === staff.positionId)?.name ?? 'Unassigned' : '';
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
      setNotice('Staff profile updated.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to update staff profile.');
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
      setNotice(staff.isActive ? 'Staff member suspended.' : 'Staff member enabled.');
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update staff status.');
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
      setError(resetError instanceof Error ? resetError.message : 'Unable to reset the staff password.');
    } finally {
      setBusy(false);
    }
  }

  async function resetStaffPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!staff || !owner || owner.role !== 'owner') return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await userService.resetStaffPin(owner.id, staff.id, staffPin);
      setStaffPin('');
      setPinResetOpen(false);
      setNotice(`${staff.name}'s PIN has been reset.`);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Unable to reset the staff PIN.');
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
      setNotice('The staff session has been revoked.');
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : 'Unable to revoke the staff session.');
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
      setError(permissionError instanceof Error ? permissionError.message : 'Unable to update permissions.');
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
      setNotice('Planned shift saved.');
    } catch (scheduleError) {
      setError(scheduleError instanceof Error ? scheduleError.message : 'Unable to save the planned shift.');
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
      setNotice('Planned shift deleted.');
    } catch (scheduleError) {
      setError(scheduleError instanceof Error ? scheduleError.message : 'Unable to delete the planned shift.');
    } finally {
      setBusy(false);
    }
  }

  async function copyPassword() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(temporaryPassword);
      setNotice('Temporary password copied.');
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Unable to copy the temporary password.');
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
    <WorkspaceLayout title="Staff profile" storeName={storeName} links={ownerWorkspaceLinks}>
      <Link to="/owner/staff" className="mb-4 inline-flex min-h-12 items-center gap-2 rounded-lg pr-3 font-body text-label-md text-primary hover:bg-surface-container-low">
        <MaterialIcon name="arrow_back" />
        Back to staff
      </Link>

      {loading ? (
        <ListSkeleton rows={3} label="Loading staff profile" />
      ) : staff ? (
        <>
          <section className="mb-5 rounded-2xl bg-surface-container-lowest p-4 shadow-card sm:p-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-fixed font-body text-title-lg text-primary">{initialsFor(staff.name)}</span>
                <div className="min-w-0 flex-1">
                  <h1 className="break-words font-display text-headline-lg text-on-surface">{staff.name}</h1>
                  <p className="mt-1 break-all font-body text-body-sm text-outline">{staff.username ?? 'No username'}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full bg-secondary-container px-3 py-1.5 font-body text-label-sm text-on-secondary-container">{positionName}</span>
                    <StatusTag status={staff.isActive ? 'open' : 'suspended'}>{staff.isActive ? 'Active' : 'Suspended'}</StatusTag>
                  </div>
                </div>
              </div>
              <dl className="grid gap-3 rounded-xl bg-surface-container-low p-3 sm:grid-cols-3 sm:p-4">
                <ProfileDetail label="Phone" value={staff.phone || 'Not provided'} />
                <ProfileDetail label="Hire date" value={new Date(staff.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} />
                <ProfileDetail label="Notes" value={staff.notes || 'No notes'} />
              </dl>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <Button variant="secondary" onClick={openEdit}><MaterialIcon name="edit" />Edit</Button>
                <Button variant="secondary" onClick={() => { setError(''); setConfirmation('reset'); }}><MaterialIcon name="lock_reset" />Reset password</Button>
                <Button variant="secondary" disabled={busy || staff.mustChangePassword || staff.mustSetPin} title={staff.mustChangePassword || staff.mustSetPin ? 'The staff member must complete first-login setup before their PIN can be reset.' : undefined} onClick={() => { setError(''); setStaffPin(''); setPinResetOpen(true); }}><MaterialIcon name="pin" />Reset PIN</Button>
                <Button variant={staff.isActive ? 'danger' : 'secondary'} disabled={busy} onClick={() => { void toggleActive(); }}>
                  <MaterialIcon name={staff.isActive ? 'person_off' : 'person'} />
                  {staff.isActive ? 'Suspend' : 'Enable'}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => { setError(''); setConfirmation('logout'); }}><MaterialIcon name="logout" />Force logout</Button>
              </div>
            </div>
          </section>

          <div role="tablist" aria-label="Staff profile sections" className="scrollbar-hidden mb-4 flex gap-2 overflow-x-auto rounded-xl bg-surface-container-low p-1">
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
                {tab.label}
              </button>
            ))}
          </div>

          <section id={`staff-panel-${activeTab}`} role="tabpanel" aria-labelledby={`staff-tab-${activeTab}`} className="min-w-0">
            {activeTab === 'overview' && (
              <div className="flex flex-col gap-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <ProfileDetailCard label="Phone" value={staff.phone || 'Not provided'} icon="call" />
                  <ProfileDetailCard label="Hire date" value={new Date(staff.createdAt).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })} icon="event" />
                  <ProfileDetailCard label="Position" value={positionName} icon="badge" />
                  <ProfileDetailCard label="Account status" value={staff.isActive ? 'Active' : 'Suspended'} icon={staff.isActive ? 'check_circle' : 'block'} />
                </div>
                <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
                  <div className="mb-4">
                    <h2 className="font-display text-headline-md text-on-surface">Effective permissions</h2>
                    <p className="mt-1 font-body text-body-sm text-outline">Switch permissions to override the selected position. Inherited permissions follow the position.</p>
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
                          const state = blocked ? 'Blocked' : granted ? 'Granted' : 'Inherited';
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
                  <h2 className="font-display text-headline-md text-on-surface">Planned shifts</h2>
                  <Button onClick={() => openScheduleEditor()}><MaterialIcon name="edit_calendar" />Edit</Button>
                </div>
                <PlannedShiftWeek title="This week" range={dateRangeLabel(weekStart, 7)} shifts={thisWeekShifts} onEdit={openScheduleEditor} />
                <PlannedShiftWeek title="Next week" range={dateRangeLabel(nextWeekStart, 7)} shifts={nextWeekShifts} onEdit={openScheduleEditor} />
              </div>
            )}

            {activeTab === 'hours' && (
              <div className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <HoursSummary title="This week" shifts={weekShifts} duration={durationFor(weekShifts)} difference={differenceFor(weekShifts)} />
                  <HoursSummary title="This month" shifts={monthShifts} duration={durationFor(monthShifts)} difference={differenceFor(monthShifts)} />
                </div>
                <section className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-card">
                  <h2 className="p-4 font-display text-headline-md text-on-surface">Shift history</h2>
                  {shifts.length === 0 ? (
                    <p className="px-4 pb-4 font-body text-body-sm text-outline">No shifts recorded yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="mobile-card-table w-full min-w-[640px] border-collapse text-left">
                        <thead className="bg-surface-container-low font-body text-label-sm text-outline">
                          <tr>
                            <th className="px-4 py-3">Date</th>
                            <th className="px-4 py-3">Opened</th>
                            <th className="px-4 py-3">Closed</th>
                            <th className="px-4 py-3">Total hours</th>
                            <th className="px-4 py-3">Punctuality</th>
                            <th className="px-4 py-3">Cash difference</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...shifts].sort((left, right) => right.openedAt.localeCompare(left.openedAt)).map((shift) => {
                            const openedAt = new Date(shift.openedAt);
                            const closedAt = shift.closedAt ? new Date(shift.closedAt) : new Date(now);
                            return (
                              <tr key={shift.id} className="border-t border-outline-variant font-body text-body-sm text-on-surface">
                                <td data-label="Date">{openedAt.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                                <td data-label="Opened">{formatShiftTime(shift.openedAt)}</td>
                                <td data-label="Closed">{shift.closedAt ? formatShiftTime(shift.closedAt) : 'Open'}</td>
                                <td data-label="Total hours">{formatHours(closedAt.getTime() - openedAt.getTime())}</td>
                                <td data-label="Punctuality">{lateMinutesFor(shift, plannedShifts) > 0 ? `Late ${lateMinutesFor(shift, plannedShifts)} min` : '—'}</td>
                                <td data-label="Cash difference">{shift.differenceMillimes === undefined ? '—' : `${formatTnd(shift.differenceMillimes / 1000)} DT`}</td>
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
                <PerformanceCard title="Last 7 days" stats={performance7} />
                <PerformanceCard title="Last 30 days" stats={performance30} />
              </div>
            )}

            {activeTab === 'activity' && (
              <div className="rounded-2xl bg-surface-container-lowest px-5 py-10 text-center shadow-card">
                <MaterialIcon name="history" className="text-4xl text-outline" />
                <h2 className="mt-3 font-display text-headline-md text-on-surface">No activity yet</h2>
                <p className="mt-1 font-body text-body-sm text-outline">Activity entries will appear here when activity tracking is available.</p>
              </div>
            )}
          </section>

          {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mt-4 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}
        </>
      ) : (
        <div className="rounded-2xl bg-surface-container-lowest p-6 text-center shadow-card">
          <MaterialIcon name="person_off" className="text-4xl text-outline" />
          <h1 className="mt-3 font-display text-headline-md text-on-surface">Staff member not found</h1>
          {error && <p role="alert" className="mt-2 font-body text-body-sm text-error-dark">{error}</p>}
        </div>
      )}

      <BottomSheet open={editOpen} onClose={() => setEditOpen(false)} title="Edit staff profile">
        <form onSubmit={(event) => { void saveProfile(event); }} className="flex flex-col gap-3">
          <label className="font-body text-label-md">Name
            <input required value={editName} onChange={(event) => setEditName(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
          </label>
          <label className="font-body text-label-md">Username
            <input readOnly value={staff?.username ?? ''} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 font-mono text-body-sm" />
          </label>
          <label className="font-body text-label-md">Phone
            <input type="tel" value={editPhone} onChange={(event) => setEditPhone(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
          </label>
          <label className="font-body text-label-md">Position
            <select required value={editPositionId} onChange={(event) => setEditPositionId(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3">
              <option value="">Select a position</option>
              {positions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
            </select>
          </label>
          <label className="font-body text-label-md">Notes
            <textarea rows={3} value={editNotes} onChange={(event) => setEditNotes(event.target.value)} className="mt-1 w-full rounded-lg bg-surface-container-low px-3 py-3" />
          </label>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit" disabled={busy}>Save changes</Button>
        </form>
      </BottomSheet>

      <BottomSheet open={confirmation !== null} onClose={() => setConfirmation(null)} title={confirmation === 'reset' ? 'Reset password?' : 'Force logout?'}>
        <div className="flex flex-col gap-4">
          <p className="font-body text-body-md text-on-surface-variant">
            {confirmation === 'reset'
              ? `Create a new temporary password for ${staff?.name}? This will clear their current PIN and require a new password and PIN at their next sign-in.`
              : `End ${staff?.name}'s current session? They will need to sign in again.`}
          </p>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={() => { void (confirmation === 'reset' ? resetPassword() : forceLogout()); }}>
              {confirmation === 'reset' ? 'Reset password' : 'Force logout'}
            </Button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={Boolean(temporaryPassword)} onClose={() => setTemporaryPassword('')} title="Temporary password">
        {staff && temporaryPassword && (
          <div className="flex flex-col gap-4">
            <p className="font-body text-body-md text-on-surface">New temporary password for {staff.name}</p>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <input readOnly value={temporaryPassword} className="h-12 min-w-0 rounded-lg bg-surface-container-low px-3 font-mono tracking-widest" />
              <Button type="button" variant="secondary" className="px-3" onClick={() => { void copyPassword(); }}>Copy</Button>
            </div>
            <p className="rounded-lg bg-primary-fixed/40 p-3 font-body text-body-sm text-on-surface">They must set a new password and personal PIN at their next login.</p>
            {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={pinResetOpen} onClose={() => setPinResetOpen(false)} title="Reset staff PIN">
        <form onSubmit={(event) => { void resetStaffPin(event); }} className="flex flex-col gap-4">
          <p className="font-body text-body-md text-on-surface-variant">Set a new 4-digit unlock PIN for {staff?.name}.</p>
          <label htmlFor="staff-pin-reset" className="font-body text-label-md text-on-surface">New PIN</label>
          <input
            id="staff-pin-reset"
            required
            pattern="[0-9]{4}"
            maxLength={4}
            inputMode="numeric"
            autoComplete="new-password"
            value={staffPin}
            onChange={(event) => setStaffPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="••••"
            className="h-12 rounded-lg bg-surface-container-low px-3 text-center tracking-[0.5em] outline-none focus:ring-2 focus:ring-primary"
          />
          <Keypad
            onPress={(digit) => setStaffPin((current) => current.length < 4 ? `${current}${digit}` : current)}
            onClear={() => setStaffPin('')}
            onBackspace={() => setStaffPin((current) => current.slice(0, -1))}
            disabled={busy}
          />
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setPinResetOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !/^\d{4}$/.test(staffPin)}>Save PIN</Button>
          </div>
        </form>
      </BottomSheet>

      <BottomSheet open={scheduleEditorOpen} onClose={() => setScheduleEditorOpen(false)} title={editingSchedule ? 'Edit planned shift' : 'Add planned shift'}>
        <form onSubmit={(event) => { void saveSchedule(event); }} className="flex flex-col gap-3">
          <label className="font-body text-label-md">Date
            <input required type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="font-body text-label-md">Start time
              <input required type="time" value={scheduleStartTime} onChange={(event) => setScheduleStartTime(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
            </label>
            <label className="font-body text-label-md">End time
              <input required type="time" value={scheduleEndTime} onChange={(event) => setScheduleEndTime(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
            </label>
          </div>
          <label className="font-body text-label-md">Note (optional)
            <textarea rows={2} value={scheduleNote} onChange={(event) => setScheduleNote(event.target.value)} className="mt-1 w-full rounded-lg bg-surface-container-low px-3 py-3" />
          </label>
          {editingSchedule && (
            <Button type="button" variant="danger" disabled={busy} onClick={() => { void deleteSchedule(editingSchedule); }}>Delete planned shift</Button>
          )}
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit" disabled={busy}>Save planned shift</Button>
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
        <p className="rounded-lg bg-surface-container-low p-3 font-body text-body-sm text-outline">No planned shifts.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {shifts.map((shift) => (
            <div key={shift.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-low p-3">
              <div className="min-w-0">
                <p className="font-body text-label-md text-on-surface">
                  {new Date(`${shift.date}T00:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
                  {' · '}
                  {shift.startTime}–{shift.endTime}
                </p>
                {shift.note && <p className="mt-0.5 truncate font-body text-body-sm text-outline">{shift.note}</p>}
              </div>
              <Button type="button" variant="secondary" className="shrink-0 px-3" onClick={() => onEdit(shift)}>Edit</Button>
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
      <p className="mt-2 font-body text-body-sm text-outline">{shifts.length} shifts · Cash difference {formatTnd(difference / 1000)} DT</p>
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
        <ProfileDetail label="Orders" value={String(stats.orderCount)} />
        <ProfileDetail label="Sales" value={`${formatTnd(stats.sales / 1000)} DT`} />
        <ProfileDetail label="Average order value" value={`${formatTnd(stats.average / 1000)} DT`} />
        <ProfileDetail label="Voids requested" value={String(stats.voidRequests)} />
        <ProfileDetail label="Comps" value={`${stats.compCount} · ${formatTnd(stats.compValue / 1000)} DT`} />
      </dl>
    </section>
  );
}

export function OwnerStaffProfileScreen() {
  return <ProfileContent />;
}
