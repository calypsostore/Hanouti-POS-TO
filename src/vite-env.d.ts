/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_DATA_DRIVER?: 'local' | 'supabase';
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_ANDROID_RELEASE?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_ANDROID_PUSH_ENABLED?: 'true' | 'false';
}
