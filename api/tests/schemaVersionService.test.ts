import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom, mockMaybeSingle } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockMaybeSingle: vi.fn(),
}));

vi.mock('../src/data/driver', () => ({ isSupabaseDriver: () => true }));
vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

import { EXPECTED_SCHEMA_VERSION } from '../src/config/appConfig';
import { classifyInitializationError } from '../src/services/serverErrorService';
import { assertExpectedSchemaVersion, SchemaVersionBehindError } from '../src/services/schemaVersionService';

function setSchemaResult(result: unknown) {
  const eq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  mockFrom.mockReturnValue({ select });
  mockMaybeSingle.mockResolvedValue(result);
}

describe('schema version check', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockMaybeSingle.mockReset();
  });

  it('accepts a database at the expected schema version', async () => {
    setSchemaResult({ data: { version: EXPECTED_SCHEMA_VERSION }, error: null });

    await expect(assertExpectedSchemaVersion()).resolves.toBeUndefined();
    expect(mockFrom).toHaveBeenCalledWith('app_schema_version');
  });

  it('blocks startup when the database schema is behind', async () => {
    setSchemaResult({ data: { version: EXPECTED_SCHEMA_VERSION - 1 }, error: null });

    await expect(assertExpectedSchemaVersion()).rejects.toMatchObject({
      expectedVersion: EXPECTED_SCHEMA_VERSION,
      currentVersion: EXPECTED_SCHEMA_VERSION - 1,
    });
  });

  it('treats a missing version table as a database still being updated', async () => {
    setSchemaResult({ data: null, error: { code: 'PGRST205', message: 'Table not found' } });

    await expect(assertExpectedSchemaVersion()).rejects.toBeInstanceOf(SchemaVersionBehindError);
  });

  it('classifies nested Supabase schema and network errors for the startup screen', () => {
    expect(classifyInitializationError(new Error('Profile request failed', { cause: { code: '42703' } })))
      .toBe('schema-out-of-date');
    expect(classifyInitializationError(new TypeError('Failed to fetch'))).toBe('network');
  });
});
