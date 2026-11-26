import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isVercel = process.env.VERCEL === '1';

if (isVercel) {
  if (!process.env.VERCEL_ENV || !process.env.VERCEL_GIT_COMMIT_REF) {
    throw new Error('Vercel system environment variables are required for deployment validation.');
  }
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_GIT_COMMIT_REF !== 'main') {
    throw new Error('Production deployments are allowed only from the main branch.');
  }
}

function run(command, env = process.env) {
  execSync(command, {
    cwd: repositoryRoot,
    env,
    stdio: 'inherit',
  });
}

run('npm run release:check -- --local');
run('npm run typecheck');
run('npm run lint');

const testEnvironment = {
  ...process.env,
  VITE_DATA_DRIVER: 'local',
  VITE_ANDROID_PUSH_ENABLED: 'false',
};
delete testEnvironment.VITE_SUPABASE_URL;
delete testEnvironment.VITE_SUPABASE_ANON_KEY;
run('npm test', testEnvironment);

run('npm run build');
