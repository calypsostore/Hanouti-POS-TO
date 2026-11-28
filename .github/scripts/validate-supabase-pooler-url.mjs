import process from 'node:process';
import { resolve } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

const expected = {
  hostname: 'aws-1-eu-west-1.pooler.supabase.com',
  port: '5432',
  username: 'postgres.xokqhrmtvfcvvddvdete',
  pathname: '/postgres',
};

const validationMessage =
  'SUPABASE_DB_POOLER_URL must target the approved Supabase session pooler and postgres database.';

export function validateSupabasePoolerUrl(connectionString) {
  if (
    typeof connectionString !== 'string' ||
    connectionString.length === 0 ||
    connectionString !== connectionString.trim()
  ) {
    throw new Error(validationMessage);
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(validationMessage);
  }

  const query = [...url.searchParams.entries()];
  const validQuery =
    query.length === 0 ||
    (query.length === 1 && query[0][0] === 'sslmode' && query[0][1] === 'require');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== expected.hostname ||
    url.port !== expected.port ||
    url.username !== expected.username ||
    !url.password ||
    url.pathname !== expected.pathname ||
    url.hash ||
    !validQuery
  ) {
    throw new Error(validationMessage);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    validateSupabasePoolerUrl(process.env.SUPABASE_DB_POOLER_URL);
  } catch {
    process.stderr.write(`${validationMessage}\n`);
    process.exitCode = 1;
  }
}
