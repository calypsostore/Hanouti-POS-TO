import type { ScheduleShiftRecord, ScheduleTemplateRecord } from '../types/domain';
import { readData, writeData } from './storage';
import { userService } from './userService';
import { activityService } from './activityService';

const getTemplates = () => readData<ScheduleTemplateRecord[]>('schedule-templates', []);
const saveTemplates = (templates: ScheduleTemplateRecord[]) => writeData('schedule-templates', templates);

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateFromKey(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('Date must use YYYY-MM-DD format.');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (localDateKey(date) !== value) throw new Error('Enter a valid schedule date.');
  return date;
}

function shiftDate(value: string, days: number): string {
  const date = dateFromKey(value);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function getSchedule(): ScheduleShiftRecord[] {
  const stored = readData<ScheduleShiftRecord[] | null>('schedule', null);
  if (stored) return stored;

  const legacy = readData<{ id: string; storeId: string; staffId: string; startsAt: string; endsAt: string; notes?: string }[] | null>('planned-shifts', null);
  const migrated = (legacy ?? []).flatMap((shift) => {
    const startsAt = new Date(shift.startsAt);
    const endsAt = new Date(shift.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return [];
    return [{
      id: shift.id,
      storeId: shift.storeId,
      staffId: shift.staffId,
      date: localDateKey(startsAt),
      startTime: `${String(startsAt.getHours()).padStart(2, '0')}:${String(startsAt.getMinutes()).padStart(2, '0')}`,
      endTime: `${String(endsAt.getHours()).padStart(2, '0')}:${String(endsAt.getMinutes()).padStart(2, '0')}`,
      note: shift.notes,
    }];
  });
  writeData('schedule', migrated);
  return migrated;
}

const saveSchedule = (schedule: ScheduleShiftRecord[]) => writeData('schedule', schedule);

function timeMinutes(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error('Time must use HH:MM format.');
  return Number(match[1]) * 60 + Number(match[2]);
}

function shiftInterval(shift: ScheduleShiftRecord): { start: number; end: number } {
  const date = dateFromKey(shift.date);
  const start = new Date(date);
  const end = new Date(date);
  const startMinutes = timeMinutes(shift.startTime);
  const endMinutes = timeMinutes(shift.endTime);
  start.setMinutes(startMinutes);
  end.setMinutes(endMinutes);
  if (endMinutes <= startMinutes) end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

function validateShift(input: Pick<ScheduleShiftRecord, 'date' | 'startTime' | 'endTime'>): void {
  dateFromKey(input.date);
  const start = timeMinutes(input.startTime);
  const end = timeMinutes(input.endTime);
  if (start === end) throw new Error('A planned shift must have a non-zero duration.');
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export const scheduleService = {
  async listForStore(storeId: string): Promise<ScheduleShiftRecord[]> {
    return getSchedule().filter((shift) => shift.storeId === storeId).sort((a, b) =>
      a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  },

  async listForStaff(storeId: string, staffId: string): Promise<ScheduleShiftRecord[]> {
    return (await this.listForStore(storeId)).filter((shift) => shift.staffId === staffId);
  },

  async listForDay(storeId: string, date: string): Promise<ScheduleShiftRecord[]> {
    dateFromKey(date);
    return (await this.listForStore(storeId)).filter((shift) => shift.date === date);
  },

  getConflicts(shifts: ScheduleShiftRecord[]): { staffId: string; first: ScheduleShiftRecord; second: ScheduleShiftRecord }[] {
    const conflicts: { staffId: string; first: ScheduleShiftRecord; second: ScheduleShiftRecord }[] = [];
    const byStaff = new Map<string, ScheduleShiftRecord[]>();
    for (const shift of shifts) {
      const staffShifts = byStaff.get(shift.staffId) ?? [];
      staffShifts.push(shift);
      byStaff.set(shift.staffId, staffShifts);
    }
    for (const [staffId, staffShifts] of byStaff) {
      for (let index = 0; index < staffShifts.length; index += 1) {
        const first = staffShifts[index];
        const firstInterval = shiftInterval(first);
        for (let nextIndex = index + 1; nextIndex < staffShifts.length; nextIndex += 1) {
          const second = staffShifts[nextIndex];
          const secondInterval = shiftInterval(second);
          if (firstInterval.start < secondInterval.end && secondInterval.start < firstInterval.end) {
            conflicts.push({ staffId, first, second });
          }
        }
      }
    }
    return conflicts;
  },

  async save(input: Omit<ScheduleShiftRecord, 'id' | 'publishedAt'>, shiftId?: string): Promise<ScheduleShiftRecord> {
    validateShift(input);
    const store = await userService.getStore(input.storeId);
    const staff = await userService.getUser(input.staffId);
    if (!store || !staff || staff.role !== 'staff' || staff.storeId !== input.storeId) {
      throw new Error('Select a staff member from this store.');
    }
    const shifts = getSchedule();
    const existing = shiftId ? shifts.find((shift) => shift.id === shiftId) : undefined;
    if (shiftId && (!existing || existing.storeId !== input.storeId || existing.staffId !== input.staffId)) {
      throw new Error('The planned shift could not be found.');
    }
    const updated: ScheduleShiftRecord = {
      ...input,
      id: existing?.id ?? createId('schedule'),
      publishedAt: undefined,
    };
    saveSchedule(existing
      ? shifts.map((shift) => shift.id === existing.id ? updated : shift)
      : [...shifts, updated]);
    await activityService.log({
      storeId: updated.storeId,
      action: existing ? 'schedule.updated' : 'schedule.created',
      summary: `${existing ? 'Updated' : 'Scheduled'} ${staff.name}'s shift for ${updated.date}.`,
      entityType: 'schedule_shift',
      entityId: updated.id,
      meta: { before: existing, after: updated },
    });
    return updated;
  },

  async delete(shiftId: string, storeId: string): Promise<void> {
    const shifts = getSchedule();
    const existing = shifts.find((shift) => shift.id === shiftId && shift.storeId === storeId);
    if (!existing) throw new Error('The planned shift could not be found.');
    saveSchedule(shifts.filter((shift) => shift.id !== shiftId));
    await activityService.log({
      storeId,
      action: 'schedule.deleted',
      summary: `Deleted ${existing.staffId}'s planned shift for ${existing.date}.`,
      entityType: 'schedule_shift',
      entityId: existing.id,
      meta: { before: existing },
    });
  },

  async clearDay(storeId: string, date: string): Promise<number> {
    dateFromKey(date);
    const shifts = getSchedule();
    const remaining = shifts.filter((shift) => shift.storeId !== storeId || shift.date !== date);
    const removed = shifts.length - remaining.length;
    if (removed > 0) {
      saveSchedule(remaining);
      await activityService.log({
        storeId,
        action: 'schedule.day_cleared',
        summary: `Cleared ${removed} planned shift${removed === 1 ? '' : 's'} for ${date}.`,
        entityType: 'schedule_day',
        entityId: date,
        meta: { before: shifts.filter((shift) => shift.storeId === storeId && shift.date === date), after: [] },
      });
    }
    return removed;
  },

  async copyLastWeek(storeId: string, targetWeekStart: string): Promise<number> {
    dateFromKey(targetWeekStart);
    const sourceWeekStart = shiftDate(targetWeekStart, -7);
    const sourceWeekEnd = shiftDate(targetWeekStart, -1);
    const targetWeekEnd = shiftDate(targetWeekStart, 6);
    const shifts = getSchedule();
    const source = shifts.filter((shift) =>
      shift.storeId === storeId && shift.date >= sourceWeekStart && shift.date <= sourceWeekEnd);
    if (source.length === 0) return 0;
    const targetCleared = shifts.filter((shift) =>
      shift.storeId !== storeId || shift.date < targetWeekStart || shift.date > targetWeekEnd);
    const copies = source.map((shift) => ({
      ...shift,
      id: createId('schedule'),
      date: shiftDate(shift.date, 7),
      publishedAt: undefined,
    }));
    saveSchedule([...targetCleared, ...copies]);
    await activityService.log({
      storeId,
      action: 'schedule.copied',
      summary: `Copied ${copies.length} planned shift${copies.length === 1 ? '' : 's'} into the week of ${targetWeekStart}.`,
      entityType: 'schedule_week',
      entityId: targetWeekStart,
      meta: { before: shifts.filter((shift) => shift.storeId === storeId && shift.date >= targetWeekStart && shift.date <= targetWeekEnd), after: copies },
    });
    return copies.length;
  },

  async publishWeek(storeId: string, weekStart: string): Promise<string[]> {
    dateFromKey(weekStart);
    const weekEnd = shiftDate(weekStart, 6);
    const staffIds = new Set<string>();
    const publishedAt = new Date().toISOString();
    const shifts = getSchedule();
    const updated = shifts.map((shift) => {
      if (shift.storeId !== storeId || shift.date < weekStart || shift.date > weekEnd || shift.publishedAt) return shift;
      staffIds.add(shift.staffId);
      return { ...shift, publishedAt };
    });
    if (staffIds.size > 0) {
      saveSchedule(updated);
      await activityService.log({
        storeId,
        action: 'schedule.published',
        summary: `Published the schedule for ${weekStart} to ${staffIds.size} staff member${staffIds.size === 1 ? '' : 's'}.`,
        entityType: 'schedule_week',
        entityId: weekStart,
        meta: { after: { staffIds: [...staffIds], publishedAt } },
      });
    }
    return [...staffIds];
  },

  async listTemplates(storeId: string): Promise<ScheduleTemplateRecord[]> {
    let templates = getTemplates();
    const seededStores = readData<string[]>('schedule-template-seeded', []);
    if (!seededStores.includes(storeId)) {
      const defaults: ScheduleTemplateRecord[] = [
        { id: createId('template'), storeId, name: 'Morning', startTime: '07:00', endTime: '15:00' },
        { id: createId('template'), storeId, name: 'Evening', startTime: '15:00', endTime: '23:00' },
      ];
      templates = [...templates, ...defaults];
      saveTemplates(templates);
      writeData('schedule-template-seeded', [...seededStores, storeId]);
      await activityService.log({
        storeId,
        action: 'schedule.templates_initialized',
        summary: 'Initialized the default schedule templates.',
        entityType: 'schedule_template',
        entityId: storeId,
        meta: { after: defaults },
      });
    }
    return templates.filter((template) => template.storeId === storeId).sort((a, b) => a.name.localeCompare(b.name));
  },

  async saveTemplate(input: Omit<ScheduleTemplateRecord, 'id'>, templateId?: string): Promise<ScheduleTemplateRecord> {
    if (!input.name.trim()) throw new Error('Template name is required.');
    validateShift({ date: '2000-01-01', startTime: input.startTime, endTime: input.endTime });
    const templates = getTemplates();
    const existing = templateId ? templates.find((template) => template.id === templateId) : undefined;
    if (templateId && (!existing || existing.storeId !== input.storeId)) throw new Error('The schedule template could not be found.');
    const updated = { ...input, name: input.name.trim(), id: existing?.id ?? createId('template') };
    saveTemplates(existing
      ? templates.map((template) => template.id === existing.id ? updated : template)
      : [...templates, updated]);
    await activityService.log({
      storeId: updated.storeId,
      action: existing ? 'schedule.template_updated' : 'schedule.template_created',
      summary: `${existing ? 'Updated' : 'Created'} schedule template "${updated.name}".`,
      entityType: 'schedule_template',
      entityId: updated.id,
      meta: { before: existing, after: updated },
    });
    return updated;
  },

  async deleteTemplate(templateId: string, storeId: string): Promise<void> {
    const templates = getTemplates();
    const existing = templates.find((template) => template.id === templateId && template.storeId === storeId);
    if (!existing) throw new Error('The schedule template could not be found.');
    saveTemplates(templates.filter((template) => template.id !== templateId));
    await activityService.log({
      storeId,
      action: 'schedule.template_deleted',
      summary: `Deleted schedule template "${existing.name}".`,
      entityType: 'schedule_template',
      entityId: existing.id,
      meta: { before: existing },
    });
  },
};
