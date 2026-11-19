import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { loadEnv } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

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
  const dataDriver = env.VITE_DATA_DRIVER ?? (mode === 'development' ? 'local' : '');
  if (command === 'build' && dataDriver !== 'supabase') {
    throw new Error('Production builds require VITE_DATA_DRIVER=supabase; demo accounts cannot ship in production.');
  }
  if (command === 'build' && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) {
    throw new Error('Production builds require VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
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
          navigateFallbackDenylist: [/^\/version\.json/, /^\/sw\.js/, /^\/workbox-/],
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
