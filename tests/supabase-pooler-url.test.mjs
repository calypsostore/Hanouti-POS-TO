import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSupabasePoolerUrl } from '../.github/scripts/validate-supabase-pooler-url.mjs';

const validUrl =
  'postgresql://postgres.xokqhrmtvfcvvddvdete:example-password@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';

test('accepts the exact project session pooler target', () => {
  assert.doesNotThrow(() => validateSupabasePoolerUrl(validUrl));
  assert.doesNotThrow(() => validateSupabasePoolerUrl(`${validUrl}?sslmode=require`));
});

test('rejects a different project, database, or connection port', () => {
  for (const connectionString of [
    validUrl.replace('aws-1-eu-west-1', 'aws-2-eu-west-1'),
    validUrl.replace('postgres.xokqhrmtvfcvvddvdete', 'postgres.other-project'),
    validUrl.replace('/postgres', '/other_database'),
    validUrl.replace(':5432/', ':6543/'),
  ]) {
    assert.throws(() => validateSupabasePoolerUrl(connectionString));
  }
});

test('rejects libpq target overrides and unapproved query parameters', () => {
  for (const connectionString of [
    `${validUrl}?hostaddr=127.0.0.1`,
    `${validUrl}?service=other-database`,
    `${validUrl}?sslmode=verify-full`,
    `${validUrl}?sslmode=require&hostaddr=127.0.0.1`,
    `${validUrl}#fragment`,
  ]) {
    assert.throws(() => validateSupabasePoolerUrl(connectionString));
  }
});
