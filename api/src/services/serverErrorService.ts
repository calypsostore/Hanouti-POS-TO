import { SchemaVersionBehindError } from './schemaVersionService';

export type InitializationErrorKind = 'schema-behind' | 'schema-out-of-date' | 'network' | 'other';

const SCHEMA_ERROR_CODES = new Set(['42703', '42883', '42P01', 'PGRST202', 'PGRST204', 'PGRST205']);
const NETWORK_ERROR_PATTERN = /failed to fetch|fetch failed|load failed|network|offline|timed? out|timeout|econn|enotfound|err_network|connection refused/i;

function inspectError(error: unknown, visit: (value: Record<string, unknown>) => boolean, seen = new Set<object>()): boolean {
  if (typeof error !== 'object' || error === null || seen.has(error)) return false;
  seen.add(error);
  const value = error as Record<string, unknown>;
  if (visit(value)) return true;
  return inspectError(value.cause, visit, seen);
}

export function classifyInitializationError(error: unknown): InitializationErrorKind {
  if (inspectError(error, (value) => value instanceof SchemaVersionBehindError)) return 'schema-behind';
  if (inspectError(error, (value) => typeof value.code === 'string' && SCHEMA_ERROR_CODES.has(value.code))) {
    return 'schema-out-of-date';
  }
  if (inspectError(error, (value) => {
    const message = typeof value.message === 'string' ? value.message : '';
    return NETWORK_ERROR_PATTERN.test(message);
  })) return 'network';
  return 'other';
}
