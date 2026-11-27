import { afterEach, describe, expect, it, vi } from 'vitest';
import viteConfig from '../vite.config';

const buildConfig = () => viteConfig({
  command: 'build',
  mode: 'production',
  isSsrBuild: false,
  isPreview: false,
});

describe('Vite build data driver guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults Vercel Preview builds to local demo data without Supabase credentials', () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VITE_DATA_DRIVER', '');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');

    expect(buildConfig).not.toThrow();
  });

  it('continues to reject local data for production builds', () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VITE_DATA_DRIVER', 'local');

    expect(buildConfig).toThrow('Builds require VITE_DATA_DRIVER=supabase');
  });
});
