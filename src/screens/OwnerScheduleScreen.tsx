import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { ListSkeleton } from '../components/ListSkeleton';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { PageHeader } from '../components/layout';
import { notificationService } from '../services/notificationService';
import { scheduleService } from '../services/scheduleService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import type { ScheduleShiftRecord, ScheduleTemplateRecord, UserSummary } from '../types/domain';
import { t } from '../i18n/translations';
import { getLanguage, localizeErrorMessage } from '../i18n';

type ScheduleAction = 'copy' | 'clear' | null;

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateFromKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function validDateKey(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return dateKey(dateFromKey(value)) === value;
}

function addDays(value: string, days: number): string {
  const date = dateFromKey(value);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function mondayOf(value: string): string {
  const date = dateFromKey(value);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dateKey(date);
}

function shiftLabel(shift: ScheduleShiftRecord): string {
  return `${shift.startTime}–${shift.endTime}`;
}

function displayDate(value: string, options: Intl.DateTimeFormatOptions): string {
  return dateFromKey(value).toLocaleDateString(getLanguage(), options);
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0] ?? '').join('').toLocaleUpperCase() || '?';
}

function OwnerScheduleContent() {
  const owner = useAuthStore((state) => state.user);
  const storeId = owner?.storeId ?? '';
  const [storeName, setStoreName] = useState<string>();
  const [staff, setStaff] = useState<UserSummary[]>([]);
  const [schedule, setSchedule] = useState<ScheduleShiftRecord[]>([]);
  const [templates, setTemplates] = useState<ScheduleTemplateRecord[]>([]);
  const [todayKey, setTodayKey] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDayOffset, setSelectedDayOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorStaff, setEditorStaff] = useState<UserSummary | null>(null);
  const [editingShift, setEditingShift] = useState<ScheduleShiftRecord | null>(null);
  const [startTime, setStartTime] = useState('07:00');
  const [endTime, setEndTime] = useState('15:00');
  const [note, setNote] = useState('');

  const [templateSheetOpen, setTemplateSheetOpen] = useState(false);
  const [templateFormOpen, setTemplateFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ScheduleTemplateRecord | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateStart, setTemplateStart] = useState('07:00');
  const [templateEnd, setTemplateEnd] = useState('15:00');
  const [pendingAction, setPendingAction] = useState<ScheduleAction>(null);

  const refresh = useCallback(async () => {
    if (!storeId) return;
    const [users, nextSchedule, nextTemplates, store] = await Promise.all([
      userService.listUsers(storeId),
      scheduleService.listForStore(storeId),
      scheduleService.listTemplates(storeId),
      userService.getStore(storeId),
    ]);
    setStaff(users.filter((candidate) => candidate.role === 'staff'));
    setSchedule(nextSchedule);
    setTemplates(nextTemplates);
    setStoreName(store?.name);
  }, [storeId]);

  useEffect(() => {
    const today = dateKey(new Date());
    const requestedDate = new URLSearchParams(window.location.search).get('date');
    setTodayKey(today);
    if (validDateKey(requestedDate)) {
      const currentWeek = dateFromKey(mondayOf(today));
      const requestedWeek = dateFromKey(mondayOf(requestedDate));
      setWeekOffset(Math.round((requestedWeek.getTime() - currentWeek.getTime()) / (7 * 24 * 60 * 60 * 1000)));
      setSelectedDayOffset((dateFromKey(requestedDate).getDay() + 6) % 7);
    } else {
      setSelectedDayOffset((new Date().getDay() + 6) % 7);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => {
      void refresh().catch((loadError: unknown) => {
        console.error('Unable to load the schedule.', loadError);
        if (active) setError(t('schedule.loadFailed'));
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

  const currentWeekStart = todayKey ? mondayOf(todayKey) : '1970-01-05';
  const weekStart = addDays(currentWeekStart, weekOffset * 7);
  const dayKey = addDays(weekStart, selectedDayOffset);
  const weekEnd = addDays(weekStart, 6);
  const selectedDayShifts = schedule.filter((shift) => shift.date === dayKey);
  const adjacentShifts = schedule.filter((shift) => shift.date >= addDays(dayKey, -1) && shift.date <= addDays(dayKey, 1));
  const conflicts = scheduleService.getConflicts(adjacentShifts).filter((conflict) =>
    conflict.first.date === dayKey || conflict.second.date === dayKey);
  const conflictingStaff = new Set(conflicts.map((conflict) => conflict.staffId));
  const editorConflict = editorStaff && startTime && endTime && scheduleService.getConflicts([
    ...schedule.filter((shift) =>
      shift.staffId === editorStaff.id &&
      shift.id !== editingShift?.id &&
      shift.date >= addDays(dayKey, -1) &&
      shift.date <= addDays(dayKey, 1)),
    {
      id: editingShift?.id ?? 'draft',
      storeId,
      staffId: editorStaff.id,
      date: dayKey,
      startTime,
      endTime,
    },
  ]).length > 0;
  const hasUnpublishedShifts = schedule.some((shift) =>
    shift.date >= weekStart && shift.date <= weekEnd && !shift.publishedAt);
  const weekTitle = `${displayDate(weekStart, { day: 'numeric', month: 'short' })} – ${displayDate(weekEnd, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const weekdays = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    return { date, label: displayDate(date, { weekday: 'short' }), day: displayDate(date, { day: 'numeric' }) };
  });

  function openShiftEditor(staffMember: UserSummary, shift?: ScheduleShiftRecord) {
    setEditorStaff(staffMember);
    setEditingShift(shift ?? null);
    setStartTime(shift?.startTime ?? '07:00');
    setEndTime(shift?.endTime ?? '15:00');
    setNote(shift?.note ?? '');
    setError('');
    setEditorOpen(true);
  }

  function openTemplateEditor(template?: ScheduleTemplateRecord) {
    setEditingTemplate(template ?? null);
    setTemplateFormOpen(true);
    setTemplateName(template?.name ?? '');
    setTemplateStart(template?.startTime ?? '07:00');
    setTemplateEnd(template?.endTime ?? '15:00');
    setError('');
    setTemplateSheetOpen(true);
  }

  async function saveShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editorStaff) return;
    setBusy(true);
    setError('');
    try {
      await scheduleService.save({
        storeId,
        staffId: editorStaff.id,
        date: dayKey,
        startTime,
        endTime,
        note,
      }, editingShift?.id);
      await refresh();
      setEditorOpen(false);
      setNotice(t('schedule.shiftSaved'));
    } catch (saveError) {
      setError(localizeErrorMessage(saveError, t('schedule.shiftSaveFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function deleteShift(shift: ScheduleShiftRecord) {
    setBusy(true);
    setError('');
    try {
      await scheduleService.delete(shift.id, storeId);
      await refresh();
      setEditorOpen(false);
      setNotice(t('schedule.shiftDeleted'));
    } catch (deleteError) {
      setError(localizeErrorMessage(deleteError, t('schedule.shiftDeleteFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await scheduleService.saveTemplate({
        storeId,
        name: templateName,
        startTime: templateStart,
        endTime: templateEnd,
      }, editingTemplate?.id);
      await refresh();
      setTemplateFormOpen(false);
      setTemplateSheetOpen(false);
      setNotice(t('schedule.templateSaved'));
    } catch (saveError) {
      setError(localizeErrorMessage(saveError, t('schedule.templateSaveFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(template: ScheduleTemplateRecord) {
    setBusy(true);
    setError('');
    try {
      await scheduleService.deleteTemplate(template.id, storeId);
      await refresh();
      setEditingTemplate(null);
      setTemplateFormOpen(false);
      setTemplateSheetOpen(false);
      setNotice(t('schedule.templateDeleted'));
    } catch (deleteError) {
      setError(localizeErrorMessage(deleteError, t('schedule.templateDeleteFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function runConfirmedAction() {
    setBusy(true);
    setError('');
    try {
      if (pendingAction === 'copy') {
        const copied = await scheduleService.copyLastWeek(storeId, weekStart);
        await refresh();
        setNotice(copied > 0 ? t('schedule.copiedShifts', { count: copied }) : t('schedule.noShiftsToCopy'));
      } else if (pendingAction === 'clear') {
        const removed = await scheduleService.clearDay(storeId, dayKey);
        await refresh();
        setNotice(removed > 0 ? t('schedule.clearedShifts', { count: removed }) : t('schedule.noShiftsToClear'));
      }
      setPendingAction(null);
    } catch (actionError) {
      setError(localizeErrorMessage(actionError, t('schedule.updateFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function publishWeek() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const affectedStaff = await scheduleService.publishWeek(storeId, weekStart);
      let failure = '';
      if (affectedStaff.length > 0) {
        try {
          await notificationService.publishSchedule(storeId, affectedStaff, weekStart, weekEnd);
        } catch (notificationError) {
          failure = t('schedule.publishNotificationFailed', { reason: localizeErrorMessage(notificationError, t('schedule.unknownNotificationError')) });
        }
      }
      try {
        await refresh();
      } catch (refreshError) {
        failure = t('schedule.publishRefreshFailed', { reason: localizeErrorMessage(refreshError, t('schedule.unknownRefreshError')) });
      }
      if (failure) {
        setError(failure);
        return;
      }
      setNotice(affectedStaff.length > 0
        ? t('schedule.published', { count: affectedStaff.length })
        : t('schedule.noUnpublished'));
    } catch (publishError) {
      setError(localizeErrorMessage(publishError, t('schedule.publishFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <WorkspaceLayout title={t('schedule.title')} storeName={storeName} links={ownerWorkspaceLinks}>
      <PageHeader title={t('schedule.weeklyTitle')} subtitle={t('schedule.subtitle')} />

      <section className="mb-4 rounded-2xl bg-surface-container-lowest p-3 shadow-card sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <button type="button" aria-label={t('schedule.previousWeek')} onClick={() => setWeekOffset((offset) => offset - 1)} className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-surface-container-low">
            <MaterialIcon name="chevron_left" />
          </button>
          <p className="text-center font-body text-label-lg text-on-surface">{weekTitle}</p>
          <button type="button" aria-label={t('schedule.nextWeek')} onClick={() => setWeekOffset((offset) => offset + 1)} className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-surface-container-low">
            <MaterialIcon name="chevron_right" />
          </button>
        </div>
        <div className="schedule-day-selector scrollbar-hidden flex gap-2 overflow-x-auto pb-1">
          {weekdays.map((day, index) => (
            <button
              key={day.date}
              type="button"
              aria-pressed={selectedDayOffset === index}
              onClick={() => setSelectedDayOffset(index)}
              className={`flex min-h-16 min-w-14 flex-1 flex-col items-center justify-center rounded-xl px-2 ${selectedDayOffset === index ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant'}`}
            >
              <span className="font-body text-label-sm">{day.label}</span>
              <span className="mt-0.5 font-display text-title-md">{day.day}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => setPendingAction('copy')}><MaterialIcon name="content_copy" />{t('schedule.copyLastWeek')}</Button>
        <Button type="button" variant="secondary" onClick={() => setPendingAction('clear')}><MaterialIcon name="delete_sweep" />{t('schedule.clearDay')}</Button>
        <Button type="button" variant="secondary" onClick={() => { setError(''); setEditingTemplate(null); setTemplateFormOpen(false); setTemplateSheetOpen(true); }}><MaterialIcon name="schedule" />{t('schedule.manageTemplates')}</Button>
        <Button type="button" disabled={busy || !hasUnpublishedShifts} onClick={() => { void publishWeek(); }}><MaterialIcon name="publish" />{t('schedule.publish')}</Button>
      </div>

      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mb-4 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}

      {conflicts.length > 0 && (
        <div role="alert" className="mb-4 rounded-xl border border-warning-container bg-warning-container p-3 font-body text-body-sm text-on-warning-container">
          <p className="font-body text-label-md">{t('schedule.overlapWarning')}</p>
          <p className="mt-1">{t('schedule.overlapDetails', { names: [...new Set(conflicts.map((conflict) => staff.find((member) => member.id === conflict.staffId)?.name ?? t('common.staff')))].join(', ') })}</p>
        </div>
      )}

      {loading ? (
        <ListSkeleton label={t('schedule.loading')} />
      ) : (
        <>
        <section aria-label={t('schedule.staffScheduleAria', { date: displayDate(dayKey, { weekday: 'long', day: 'numeric', month: 'long' }) })} className="schedule-day-view flex flex-col gap-2">
          {staff.map((staffMember) => {
            const staffShifts = selectedDayShifts.filter((shift) => shift.staffId === staffMember.id);
            return (
              <article key={staffMember.id} className={`rounded-xl bg-surface-container-lowest p-3 shadow-card ${conflictingStaff.has(staffMember.id) ? 'border-2 border-warning-container' : 'border-2 border-transparent'}`}>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => openShiftEditor(staffMember, staffShifts[0])} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                    <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-fixed font-body text-label-md text-primary">{initials(staffMember.name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-body text-label-lg text-on-surface">{staffMember.name}</span>
                      <span className="mt-0.5 block font-body text-body-sm text-outline">{staffShifts.length ? staffShifts.map(shiftLabel).join(' · ') : t('schedule.off')}</span>
                    </span>
                    {!staffMember.isActive && <StatusTag status="suspended">{t('schedule.suspended')}</StatusTag>}
                  </button>
                  {staffShifts.length > 0 && (
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {staffShifts.map((shift) => (
                        <button key={shift.id} type="button" onClick={() => openShiftEditor(staffMember, shift)} className="min-h-11 rounded-lg bg-primary-fixed/50 px-2 font-body text-label-sm text-primary">
                          {shiftLabel(shift)}
                        </button>
                      ))}
                    </div>
                  )}
                  <button type="button" aria-label={t('schedule.addShiftFor', { name: staffMember.name })} onClick={() => openShiftEditor(staffMember)} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-primary hover:bg-surface-container-low">
                    <MaterialIcon name="add" />
                  </button>
                </div>
              </article>
            );
          })}
          {staff.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{t('schedule.noStaff')}</p>}
        </section>
        <div className="schedule-week-view hidden overflow-auto rounded-xl border border-outline-variant bg-surface-container-lowest lg:block">
          <table className="w-full min-w-[980px] border-collapse text-left font-body text-body-sm">
            <thead className="sticky top-0 z-10 bg-surface-container-high">
              <tr>
                <th scope="col" className="sticky left-0 z-20 min-w-48 bg-surface-container-high px-3 py-3">{t('schedule.staff')}</th>
                {weekdays.map((day) => <th key={day.date} scope="col" className="min-w-32 px-3 py-3 text-center">{day.label} {day.day}</th>)}
              </tr>
            </thead>
            <tbody>
              {staff.map((staffMember) => (
                <tr key={staffMember.id} className="border-t border-outline-variant hover:bg-surface-container-low">
                  <th scope="row" className="sticky left-0 z-[1] bg-surface-container-lowest px-3 py-3 font-semibold">{staffMember.name}</th>
                  {weekdays.map((day) => {
                    const dayShifts = schedule.filter((shift) => shift.staffId === staffMember.id && shift.date === day.date);
                    return (
                      <td key={day.date} className="border-l border-outline-variant p-2 align-top">
                        <div className="flex min-h-12 flex-col gap-1">
                          {dayShifts.map((shift) => (
                            <button key={shift.id} type="button" onClick={() => openShiftEditor(staffMember, shift)} className="min-h-9 rounded-md bg-primary-fixed/60 px-2 text-left text-label-sm text-primary hover:bg-primary-fixed">
                              {shiftLabel(shift)}
                            </button>
                          ))}
                          <button type="button" aria-label={t('schedule.addShiftForDay', { name: staffMember.name, day: day.label })} onClick={() => { setSelectedDayOffset(weekdays.findIndex((entry) => entry.date === day.date)); openShiftEditor(staffMember); }} className="schedule-add-shift min-h-8 rounded-md text-primary hover:bg-surface-container-high">
                            <MaterialIcon name="add" className="text-base" />
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <BottomSheet open={editorOpen} onClose={() => setEditorOpen(false)} title={t(editingShift ? 'schedule.editShiftTitle' : 'schedule.setShiftTitle', { name: editorStaff?.name ?? '' })}>
        <form onSubmit={(event) => { void saveShift(event); }} className="flex flex-col gap-4">
          {editorConflict && <p role="alert" className="rounded-lg bg-warning-container p-3 font-body text-body-sm text-on-warning-container">{t('schedule.overlapEditor')}</p>}
          <div className="flex flex-wrap gap-2">
            {templates.map((template) => (
              <button key={template.id} type="button" onClick={() => { setStartTime(template.startTime); setEndTime(template.endTime); }} className="min-h-11 rounded-full bg-surface-container-low px-3 font-body text-label-sm text-on-surface">
                {template.name} {template.startTime}–{template.endTime}
              </button>
            ))}
          </div>
          <label className="font-body text-label-md">{t('schedule.startTime')}
            <input required type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
          </label>
          <label className="font-body text-label-md">{t('schedule.endTime')}
            <input required type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
          </label>
          <label className="font-body text-label-md">{t('schedule.noteOptional')}
            <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full rounded-lg bg-surface-container-low px-3 py-3" />
          </label>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          {editingShift && <Button type="button" variant="danger" disabled={busy} onClick={() => { void deleteShift(editingShift); }}>{t('schedule.deleteShift')}</Button>}
          <Button type="submit" disabled={busy}>{t('schedule.saveShift')}</Button>
        </form>
      </BottomSheet>

      <BottomSheet open={templateSheetOpen} onClose={() => { setTemplateSheetOpen(false); setTemplateFormOpen(false); setEditingTemplate(null); }} title={templateFormOpen ? t(editingTemplate ? 'schedule.editTemplate' : 'schedule.addTemplate') : t('schedule.templatesTitle')}>
        {templateFormOpen ? (
          <form onSubmit={(event) => { void saveTemplate(event); }} className="flex flex-col gap-3">
            <label className="font-body text-label-md">{t('schedule.templateName')}
              <input required value={templateName} onChange={(event) => setTemplateName(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
            </label>
            <label className="font-body text-label-md">{t('schedule.startTime')}
              <input required type="time" value={templateStart} onChange={(event) => setTemplateStart(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
            </label>
            <label className="font-body text-label-md">{t('schedule.endTime')}
              <input required type="time" value={templateEnd} onChange={(event) => setTemplateEnd(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
            </label>
            {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
            {editingTemplate && <Button type="button" variant="danger" disabled={busy} onClick={() => { void deleteTemplate(editingTemplate); }}>{t('schedule.deleteTemplate')}</Button>}
            <Button type="submit" disabled={busy}>{t('schedule.saveTemplate')}</Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              {templates.map((template) => (
                <button key={template.id} type="button" onClick={() => openTemplateEditor(template)} className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-surface-container-low px-3 text-left">
                  <span className="font-body text-label-md text-on-surface">{template.name}</span>
                  <span className="font-body text-body-sm text-outline">{template.startTime}–{template.endTime}</span>
                </button>
              ))}
            </div>
            <Button type="button" onClick={() => openTemplateEditor()}><MaterialIcon name="add" />{t('schedule.addTemplate')}</Button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={pendingAction !== null} onClose={() => setPendingAction(null)} title={pendingAction === 'copy' ? t('schedule.copyTitle') : t('schedule.clearTitle')}>
        <div className="flex flex-col gap-4">
          <p className="font-body text-body-md text-on-surface-variant">
            {pendingAction === 'copy'
              ? t('schedule.copyDescription', { week: weekTitle })
              : t('schedule.clearDescription', { date: displayDate(dayKey, { weekday: 'long', day: 'numeric', month: 'long' }) })}
          </p>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setPendingAction(null)}>{t('schedule.cancel')}</Button>
            <Button type="button" variant="danger" disabled={busy} onClick={() => { void runConfirmedAction(); }}>
              {pendingAction === 'copy' ? t('schedule.copyWeek') : t('schedule.clearDay')}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </WorkspaceLayout>
  );
}

export function OwnerScheduleScreen() {
  return <OwnerScheduleContent />;
}
