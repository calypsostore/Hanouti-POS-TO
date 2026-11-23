import { isSupabaseDriver } from '../data/driver';
import { getSupabaseClient } from '../data/supabaseClient';
import { EXPECTED_SCHEMA_VERSION } from '../config/appConfig';

const MISSING_SCHEMA_CODES = new Set(['42703', '42P01', 'PGRST204', 'PGRST205']);

export class SchemaVersionBehindError extends Error {
  readonly code = 'APP_SCHEMA_BEHIND';
  readonly expectedVersion: number;
  readonly currentVersion: number;

  constructor(
    expectedVersion: number,
    currentVersion: number,
    options?: ErrorOptions,
  ) {
    super(`Database schema is behind: expected ${expectedVersion}, received ${currentVersion}.`, options);
    this.name = 'SchemaVersionBehindError';
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
  }
}

function isMissingSchemaResource(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && typeof error.code === 'string' && MISSING_SCHEMA_CODES.has(error.code);
}

export async function assertExpectedSchemaVersion(): Promise<void> {
  if (!isSupabaseDriver()) return;

  const { data, error } = await getSupabaseClient()
    .from('app_schema_version')
    .select('version')
    .eq('singleton', true)
    .maybeSingle();

  if (error) {
    if (isMissingSchemaResource(error)) {
      const behindError = new SchemaVersionBehindError(EXPECTED_SCHEMA_VERSION, 0, { cause: error });
      console.error('[schema] Application schema version is missing from the server.', {
        expectedVersion: EXPECTED_SCHEMA_VERSION,
        currentVersion: 0,
        error,
      });
      throw behindError;
    }
    throw error;
  }

  const currentVersion = data?.version == null ? 0 : Number(data.version);
  if (!Number.isSafeInteger(currentVersion) || currentVersion < EXPECTED_SCHEMA_VERSION) {
    const behindError = new SchemaVersionBehindError(
      EXPECTED_SCHEMA_VERSION,
      Number.isSafeInteger(currentVersion) ? currentVersion : 0,
    );
    console.error('[schema] Application schema version is behind.', {
      expectedVersion: EXPECTED_SCHEMA_VERSION,
      currentVersion: behindError.currentVersion,
    });
    throw behindError;
  }

  if (currentVersion > EXPECTED_SCHEMA_VERSION) {
    console.warn('[schema] Server schema is newer than this app build.', {
      expectedVersion: EXPECTED_SCHEMA_VERSION,
      currentVersion,
    });
  }
}
