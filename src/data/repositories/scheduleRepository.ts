import type { ScheduleShiftRecord, ScheduleTemplateRecord } from '../../types/domain';
import { getSupabaseClient } from '../supabaseClient';

interface ScheduleRow {
  id: string;
  store_id: string;
  staff_id: string;
  date: string;
  start_time: string;
  end_time: string;
  note: string | null;
  published_at: string | null;
}

interface TemplateRow {
  id: string;
  store_id: string;
  name: string;
  start_time: string;
  end_time: string;
}

function mapSchedule(row: ScheduleRow): ScheduleShiftRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    staffId: row.staff_id,
    date: row.date,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    note: row.note ?? undefined,
    publishedAt: row.published_at ?? undefined,
  };
}

function mapTemplate(row: TemplateRow): ScheduleTemplateRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
  };
}

function fail(error: { message: string }, context: string): never {
  throw new Error(`${context}: ${error.message}`, { cause: error });
}

export async function listSchedule(storeId: string): Promise<ScheduleShiftRecord[]> {
  const { data, error } = await getSupabaseClient().from('schedule_shifts').select('*')
    .eq('store_id', storeId).order('date').order('start_time');
  if (error) fail(error, 'Could not load the schedule');
  return (data ?? []).map((row) => mapSchedule(row as ScheduleRow));
}

export async function saveSchedule(
  input: Omit<ScheduleShiftRecord, 'id' | 'publishedAt'>,
  id?: string,
): Promise<ScheduleShiftRecord> {
  const values = {
    store_id: input.storeId,
    staff_id: input.staffId,
    date: input.date,
    start_time: input.startTime,
    end_time: input.endTime,
    note: input.note ?? null,
    published_at: null,
  };
  const query = id
    ? getSupabaseClient().from('schedule_shifts').update(values).eq('id', id)
    : getSupabaseClient().from('schedule_shifts').insert(values);
  const { data, error } = await query.select('*').single();
  if (error) fail(error, 'Could not save planned shift');
  return mapSchedule(data as ScheduleRow);
}

export async function insertSchedule(rows: Omit<ScheduleShiftRecord, 'id' | 'publishedAt'>[]): Promise<ScheduleShiftRecord[]> {
  if (rows.length === 0) return [];
  const { data, error } = await getSupabaseClient().from('schedule_shifts').insert(rows.map((row) => ({
    store_id: row.storeId,
    staff_id: row.staffId,
    date: row.date,
    start_time: row.startTime,
    end_time: row.endTime,
    note: row.note ?? null,
  }))).select('*');
  if (error) fail(error, 'Could not copy planned shifts');
  return (data ?? []).map((row) => mapSchedule(row as ScheduleRow));
}

export async function deleteScheduleIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await getSupabaseClient().from('schedule_shifts').delete().in('id', ids);
  if (error) fail(error, 'Could not delete planned shifts');
}

export async function publishSchedule(storeId: string, from: string, to: string, publishedAt: string): Promise<ScheduleShiftRecord[]> {
  const { data, error } = await getSupabaseClient().from('schedule_shifts')
    .update({ published_at: publishedAt })
    .eq('store_id', storeId).gte('date', from).lte('date', to).is('published_at', null)
    .select('*');
  if (error) fail(error, 'Could not publish schedule');
  return (data ?? []).map((row) => mapSchedule(row as ScheduleRow));
}

export async function listTemplates(storeId: string): Promise<ScheduleTemplateRecord[]> {
  const { data, error } = await getSupabaseClient().from('schedule_templates').select('*')
    .eq('store_id', storeId).order('name');
  if (error) fail(error, 'Could not load schedule templates');
  return (data ?? []).map((row) => mapTemplate(row as TemplateRow));
}

export async function saveTemplate(
  input: Omit<ScheduleTemplateRecord, 'id'>,
  id?: string,
): Promise<ScheduleTemplateRecord> {
  const values = {
    store_id: input.storeId,
    name: input.name,
    start_time: input.startTime,
    end_time: input.endTime,
  };
  const query = id
    ? getSupabaseClient().from('schedule_templates').update(values).eq('id', id)
    : getSupabaseClient().from('schedule_templates').insert(values);
  const { data, error } = await query.select('*').single();
  if (error) fail(error, 'Could not save schedule template');
  return mapTemplate(data as TemplateRow);
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await getSupabaseClient().from('schedule_templates').delete().eq('id', id);
  if (error) fail(error, 'Could not delete schedule template');
}
