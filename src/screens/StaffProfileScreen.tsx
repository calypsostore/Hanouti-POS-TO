import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BottomNav } from '../components/BottomNav';
import { PageContainer } from '../components/layout';
import { Button } from '../components/Button';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { ListSkeleton } from '../components/ListSkeleton';
import { MaterialIcon } from '../components/MaterialIcon';
import { PERMISSIONS_CHANGED_EVENT, userService } from '../services/userService';
import { scheduleService } from '../services/scheduleService';
import { shiftService } from '../services/shiftService';
import { useAuthStore } from '../stores/authStore';
import type { PermissionDefinition, ScheduleShiftRecord, ShiftRecord, StoreRecord } from '../types/domain';

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function periodMinutes(shifts: ShiftRecord[], from: Date, until: Date, now: number): number {
  return shifts.reduce((total, shift) => {
    const openedAt = new Date(shift.openedAt).getTime();
    const closedAt = shift.closedAt ? new Date(shift.closedAt).getTime() : now;
    if (!Number.isFinite(openedAt) || !Number.isFinite(closedAt)) return total;
    const overlap = Math.max(0, Math.min(closedAt, until.getTime()) - Math.max(openedAt, from.getTime()));
    return total + overlap / 60_000;
  }, 0);
}

function formatHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)} h`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function scheduleStart(shift: ScheduleShiftRecord): number {
  return new Date(`${shift.date}T${shift.startTime}:00`).getTime();
}

export function StaffProfileScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const lock = useAuthStore((state) => state.lock);
  const logout = useAuthStore((state) => state.logout);
  const [store, setStore] = useState<StoreRecord>();
  const [positionName, setPositionName] = useState('Unassigned');
  const [permissionDefinitions, setPermissionDefinitions] = useState<PermissionDefinition[]>([]);
  const [effectivePermissions, setEffectivePermissions] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<ScheduleShiftRecord[]>([]);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    if (!user || user.role !== 'staff' || !user.storeId) return;
    setLoading(true);
    try {
      const [nextStore, positions, definitions, permissionIds] = await Promise.all([
        userService.getStore(user.storeId),
        userService.listPositions(user.storeId),
        userService.listPermissionDefinitions(),
        userService.getEffectivePermissions(user.id),
      ]);
      const hasSchedulePermission = permissionIds.includes('view_schedule');
      const hasHoursPermission = permissionIds.includes('view_own_hours');
      const [nextSchedule, allShifts] = await Promise.all([
        hasSchedulePermission ? scheduleService.listForStaff(user.storeId, user.id) : Promise.resolve([]),
        hasHoursPermission ? shiftService.listShifts(user.storeId) : Promise.resolve([]),
      ]);
      setStore(nextStore);
      setPositionName(positions.find((position) => position.id === user.positionId)?.name ?? 'Unassigned');
      setPermissionDefinitions(definitions);
      setEffectivePermissions(permissionIds);
      setSchedule(nextSchedule.filter((shift) => Boolean(shift.publishedAt)));
      setShifts(allShifts.filter((shift) => shift.staffId === user.id));
      setNow(Date.now());
      setError('');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    let active = true;
    let requestId = 0;
    const load = () => {
      const currentRequestId = ++requestId;
      void refresh().catch((loadError: unknown) => {
        if (active && currentRequestId === requestId) {
          console.error('Unable to load the staff profile.', loadError);
          setError('Unable to load your profile. Please try again.');
        }
      });
    };
    load();
    window.addEventListener('focus', load);
    window.addEventListener(PERMISSIONS_CHANGED_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
      window.removeEventListener(PERMISSIONS_CHANGED_EVENT, load);
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, PermissionDefinition[]>();
    for (const permission of permissionDefinitions) {
      const group = groups.get(permission.group) ?? [];
      group.push(permission);
      groups.set(permission.group, group);
    }
    return [...groups.entries()];
  }, [permissionDefinitions]);

  const weekStart = startOfWeek(new Date(now));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1);
  const monthEnd = new Date(new Date(now).getFullYear(), new Date(now).getMonth() + 1, 1);
  const weekSchedule = schedule.filter((shift) => shift.date >= dateKey(weekStart) && shift.date < dateKey(weekEnd));
  const nextShift = schedule.find((shift) => scheduleStart(shift) >= now);
  const personalShifts = [...shifts].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const recentShifts = personalShifts.slice(0, 5);
  const weekHours = periodMinutes(personalShifts, weekStart, weekEnd, now);
  const monthHours = periodMinutes(personalShifts, monthStart, monthEnd, now);
  const canViewSchedule = effectivePermissions.includes('view_schedule');
  const canViewHours = effectivePermissions.includes('view_own_hours');

  async function endSession() {
    setError('');
    try {
      await logout();
      navigate('/', { replace: true });
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : 'Unable to end your session.');
    }
  }

  async function lockNow() {
    setError('');
    try {
      await lock();
      navigate('/lock', { state: { from: location.pathname } });
    } catch (lockError) {
      setError(lockError instanceof Error ? lockError.message : 'Unable to lock the terminal.');
    }
  }

  const initials = user?.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase()).join('') || '?';

  return (
    <div className="store-themed-screen min-h-screen bg-surface px-4 pb-24 pt-5">
      <main className="mx-auto w-full p-0">
      <PageContainer className="mx-auto flex flex-col gap-4">
        <header className="rounded-2xl bg-surface-container-lowest p-5 shadow-card">
          <div className="flex items-center gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-fixed font-display text-headline-md text-primary">{initials}</span>
            <div className="min-w-0">
              <h1 className="truncate font-display text-headline-lg text-on-surface">{user?.name}</h1>
              <p className="truncate font-body text-body-md text-on-surface-variant">@{user?.username ?? 'No username'}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 border-t border-outline-variant pt-4 sm:grid-cols-2">
            <ProfileDetail label="Position" value={positionName} />
            <ProfileDetail label="Store" value={store?.name ?? 'Loading store…'} />
          </div>
        </header>

        {error && <p role="alert" className="rounded-xl bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}

        {canViewSchedule && (
          <>
            <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
              <h2 className="mb-3 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="event" className="text-primary" />Next shift</h2>
              {loading ? <ListSkeleton rows={1} label="Loading your next shift" /> : nextShift ? (
                <ScheduleCard shift={nextShift} />
              ) : (
                <p className="font-body text-body-sm text-outline">No upcoming published shifts.</p>
              )}
            </section>
            <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
              <h2 className="mb-3 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="calendar_month" className="text-primary" />This week’s schedule</h2>
              {loading ? <ListSkeleton rows={2} label="Loading this week’s schedule" /> : weekSchedule.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {weekSchedule.map((shift) => <ScheduleCard key={shift.id} shift={shift} />)}
                </div>
              ) : (
                <p className="font-body text-body-sm text-outline">No published shifts this week.</p>
              )}
            </section>
          </>
        )}

        {canViewHours && (
          <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
            <h2 className="mb-3 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="schedule" className="text-primary" />My hours</h2>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <HourMetric label="This week" value={formatHours(weekHours)} />
              <HourMetric label="This month" value={formatHours(monthHours)} />
            </div>
            <h3 className="mb-2 font-body text-label-md text-on-surface">Last 5 shifts</h3>
            {loading ? <ListSkeleton rows={2} label="Loading recent shifts" /> : recentShifts.length > 0 ? (
              <div className="flex flex-col gap-2">
                {recentShifts.map((shift) => (
                  <article key={shift.id} className="rounded-xl bg-surface-container-low p-3">
                    <p className="font-body text-label-md text-on-surface">{formatDateTime(shift.openedAt)}</p>
                    <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                      Opened {new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Closed {shift.closedAt ? new Date(shift.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'In progress'}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="font-body text-body-sm text-outline">No shifts recorded yet.</p>
            )}
          </section>
        )}

        <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
          <h2 className="mb-1 flex items-center gap-2 font-display text-headline-md text-on-surface"><MaterialIcon name="verified_user" className="text-primary" />My permissions</h2>
          <p className="mb-4 font-body text-body-sm text-on-surface-variant">These permissions determine which actions and buttons are available to you.</p>
          <div className="flex flex-col gap-4">
            {loading ? <ListSkeleton rows={2} label="Loading your permissions" /> : groupedPermissions.map(([group, permissions]) => (
              <div key={group}>
                <h3 className="mb-2 font-body text-label-md text-on-surface">{group}</h3>
                <ul className="flex flex-col gap-2">
                  {permissions.map((permission) => {
                    const allowed = effectivePermissions.includes(permission.id);
                    return (
                      <li key={permission.id} className="flex items-center gap-2 font-body text-body-sm text-on-surface-variant">
                        <MaterialIcon name={allowed ? 'check_circle' : 'block'} className={allowed ? 'text-success-dark' : 'text-outline'} />
                        <span className="flex-1">{permission.label}</span>
                        <span className={allowed ? 'text-success-dark' : 'text-outline'}>{allowed ? 'Allowed' : 'Not allowed'}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <ChangePasswordForm onError={setError} onNotice={setNotice} />
        {notice && <p role="status" className="rounded-lg bg-success-container p-3 font-body text-body-sm text-on-success-container">{notice}</p>}

        <div className="staff-profile-actions flex flex-col gap-4">
          <Button variant="secondary" onClick={() => navigate('/settings')} className="w-full"><MaterialIcon name="settings" />Settings</Button>
          <Button variant="danger" onClick={() => { void lockNow(); }} className="w-full"><MaterialIcon name="lock" />Lock now</Button>
          <Button variant="ghost" onClick={() => { void endSession(); }} className="w-full"><MaterialIcon name="logout" />Log out</Button>
        </div>
      </PageContainer>
      </main>
      <BottomNav />
    </div>
  );
}

function ProfileDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-body text-label-sm uppercase text-outline">{label}</p>
      <p className="mt-1 truncate font-body text-label-lg text-on-surface">{value}</p>
    </div>
  );
}

function ScheduleCard({ shift }: { shift: ScheduleShiftRecord }) {
  return (
    <article className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-low p-3">
      <p className="font-body text-label-md text-on-surface">{new Date(`${shift.date}T00:00:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}</p>
      <p className="shrink-0 font-body text-label-md tabular-nums text-primary">{shift.startTime}–{shift.endTime}</p>
    </article>
  );
}

function HourMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-container-low p-3">
      <p className="font-body text-body-sm text-on-surface-variant">{label}</p>
      <p className="mt-1 font-display text-headline-md tabular-nums text-primary">{value}</p>
    </div>
  );
}
