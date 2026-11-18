import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.CAP_SERVER_URL ?? process.env.VITE_CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.safran.anouti',
  appName: '7anouti-POS',
  webDir: 'dist',
  server: {
    ...(serverUrl ? { url: serverUrl, cleartext: false } : {}),
    androidScheme: 'https',
  },
  android: {
    path: 'android',
  },
};

export default config;
