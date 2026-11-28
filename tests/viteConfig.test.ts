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

  it.each([
    ['https://hanoutipos.vercel.app', 'https://hanouti-pos.tn'],
    ['https://project-ref.supabase.co', 'https://hanouti-pos.tn'],
    ['https://hanouti-pos.tn', 'https://hanoutipos.vercel.app'],
  ])('rejects Android release endpoints that do not both target the VPS', (supabaseUrl, appUrl) => {
    vi.stubEnv('VITE_DATA_DRIVER', 'supabase');
    vi.stubEnv('VITE_ANDROID_RELEASE', 'true');
    vi.stubEnv('VITE_SUPABASE_URL', supabaseUrl);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
    vi.stubEnv('VITE_APP_URL', appUrl);

    expect(buildConfig).toThrow('Android release builds must use https://hanouti-pos.tn');
  });

  it('accepts Android release endpoints that both target the VPS over HTTPS', () => {
    vi.stubEnv('VITE_DATA_DRIVER', 'supabase');
    vi.stubEnv('VITE_ANDROID_RELEASE', 'true');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://hanouti-pos.tn');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
    vi.stubEnv('VITE_APP_URL', 'https://hanouti-pos.tn');

    expect(buildConfig).not.toThrow();
  });
});
