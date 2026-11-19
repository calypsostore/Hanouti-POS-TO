import { execSync } from 'node:child_process';
import { error as logError, log } from 'node:console';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = resolve(repositoryRoot, 'supabase', 'migrations');

function printReleaseReminder() {
  log('Before publishing a new app version:');
  log('  1. Run npx supabase db push and verify the remote migration list.');
  log('  2. Deploy every changed Edge Function with npx supabase functions deploy <function-name>.');
}

function parseMigrationList(output) {
  const jsonStart = output.indexOf('{');
  const jsonEnd = output.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    throw new Error('Supabase CLI did not return machine-readable migration data.');
  }

  const result = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
  if (!Array.isArray(result.migrations)) {
    throw new Error('Supabase CLI migration output did not include a migrations array.');
  }

  return {
    local: new Set(result.migrations.map((migration) => migration.local).filter((version) => typeof version === 'string')),
    remote: new Set(result.migrations.map((migration) => migration.remote).filter((version) => typeof version === 'string')),
  };
}

function localMigrationVersions() {
  return readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => {
      const match = /^(\d{14})_.+\.sql$/.exec(file);
      if (!match) throw new Error(`Migration filename does not start with a 14-digit version: ${file}`);
      return match[1];
    })
    .sort();
}

function runReleaseCheck() {
  printReleaseReminder();

  let output;
  try {
    output = execSync('npx supabase migration list --remote --output-format json', {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    logError('Could not compare local migrations with the linked Supabase database.');
    if (error.stdout) logError(error.stdout.toString());
    if (error.stderr) logError(error.stderr.toString());
    process.exitCode = 1;
    return;
  }

  try {
    const { local: cliLocalVersions, remote: remoteVersions } = parseMigrationList(output);
    const diskVersions = localMigrationVersions();
    const unreported = diskVersions.filter((version) => !cliLocalVersions.has(version));
    if (unreported.length) {
      throw new Error(`Supabase CLI did not report local migration files: ${unreported.join(', ')}`);
    }

    const pending = diskVersions.filter((version) => !remoteVersions.has(version));
    if (pending.length) {
      throw new Error(`Unapplied local migration(s): ${pending.join(', ')}. Run npx supabase db push before publishing.`);
    }

    log('All local migrations are applied to the linked Supabase database.');
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

runReleaseCheck();
