import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { loadEnv } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const ANDROID_PRODUCTION_URL = 'https://hanouti-pos.tn';

function versionManifestPlugin(buildId: string): Plugin {
  return {
    name: 'version-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version, buildId, builtAt: new Date().toISOString() }, null, 2),
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isVercelPreview = process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'preview';
  const isAndroidRelease = env.VITE_ANDROID_RELEASE === 'true';
  const dataDriver = env.VITE_DATA_DRIVER || (mode === 'development' || isVercelPreview ? 'local' : '');
  const isLocalPreviewBuild = isVercelPreview && dataDriver === 'local';
  if (command === 'build' && dataDriver !== 'supabase' && !isLocalPreviewBuild) {
    throw new Error('Builds require VITE_DATA_DRIVER=supabase; only Vercel Preview builds may use local demo data.');
  }
  if (command === 'build' && dataDriver === 'supabase' && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) {
    throw new Error('Supabase builds require VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  if (command === 'build' && isAndroidRelease) {
    if (env.VITE_SUPABASE_URL !== ANDROID_PRODUCTION_URL || env.VITE_APP_URL !== ANDROID_PRODUCTION_URL) {
      throw new Error(`Android release builds must use ${ANDROID_PRODUCTION_URL} for the website and Supabase API.`);
    }
  }
  const buildId = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? Date.now().toString(36);

  return {
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __BUILD_ID__: JSON.stringify(buildId),
    },
    resolve: {
      alias: dataDriver === 'supabase'
        ? [
            { find: /^\.\/seedData$/, replacement: resolve('src/services/emptySeedData.ts') },
            { find: /^\.\/secretService$/, replacement: resolve('src/services/emptySecretService.ts') },
          ]
        : [],
    },
    plugins: [
      react(),
      versionManifestPlugin(buildId),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icon-192.svg', 'icon-512.svg'],
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,txt,webmanifest,woff2}'],
          globIgnores: ['**/version.json'],
          navigateFallbackDenylist: [/^\/api\/update-manifest/, /^\/version\.json/, /^\/sw\.js/, /^\/workbox-/],
        },
        manifest: {
          name: '7anouti-POS',
          short_name: '7anouti-POS',
          theme_color: '#0F5E6E',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          icons: [
            { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
            { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
          ],
        },
      }),
    ],
  };
});
