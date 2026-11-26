import type { CapacitorConfig } from '@capacitor/cli';

const PRODUCTION_URL = 'https://hanoutipos.vercel.app';

const config: CapacitorConfig = {
  appId: 'com.hanouti.pos',
  appName: '7anouti-POS',
  webDir: 'dist',
  server: {
    ...(process.env.CAP_BUNDLED === '1' ? {} : { url: process.env.CAP_SERVER_URL ?? PRODUCTION_URL }),
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    path: 'android',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_notification',
      iconColor: '#0F5E6E',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'alert'],
    },
  },
};

export default config;
