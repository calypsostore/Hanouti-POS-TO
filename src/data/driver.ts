export type DataDriver = 'local' | 'supabase';

const configuredDriver = import.meta.env.VITE_DATA_DRIVER ?? (import.meta.env.DEV ? 'local' : '');

if (configuredDriver !== 'local' && configuredDriver !== 'supabase') {
  throw new Error('Set VITE_DATA_DRIVER to "local" for demos or "supabase" for production.');
}

export const dataDriver: DataDriver = configuredDriver;

export function isSupabaseDriver(): boolean {
  return dataDriver === 'supabase';
}
