export type DataDriver = 'local' | 'supabase';

const configuredDriver = import.meta.env.VITE_DATA_DRIVER ?? 'local';

if (configuredDriver !== 'local' && configuredDriver !== 'supabase') {
  throw new Error('VITE_DATA_DRIVER must be either "local" or "supabase".');
}

export const dataDriver: DataDriver = configuredDriver;

export function isSupabaseDriver(): boolean {
  return dataDriver === 'supabase';
}
