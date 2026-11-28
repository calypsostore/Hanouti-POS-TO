import type { CapacitorConfig } from '@capacitor/cli';

const PRODUCTION_URL = 'https://hanouti-pos.tn';

const config: CapacitorConfig = {
  appId: 'com.hanouti.pos',
  appName: '7anouti-POS',
  webDir: 'dist',
  server: {
    ...(process.env.CAP_BUNDLED === '1' ? {} : { url: PRODUCTION_URL }),
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    path: 'android',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_notification',
      iconColor: '#238636',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'alert'],
    },
  },
};

export default config;
