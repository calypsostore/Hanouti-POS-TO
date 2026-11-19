import { isSupabaseDriver } from '../data/driver';

const STORAGE_PREFIX = '7anouti-pos:';

function assertLocalDataDriver(operation: string): void {
  if (isSupabaseDriver()) {
    throw new Error(`Browser data storage cannot ${operation} while the Supabase data driver is active.`);
  }
}

export function readData<T>(key: string, initialValue: T): T {
  assertLocalDataDriver('read');
  const storageKey = `${STORAGE_PREFIX}${key}`;
  const storedValue = localStorage.getItem(storageKey);
  if (storedValue === null) {
    writeData(key, initialValue);
    return initialValue;
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(storedValue) as unknown;
  } catch (error) {
    throw new Error(`Could not read local mock data "${key}".`, { cause: error });
  }

  if (key === 'catalog-items' && Array.isArray(parsedValue)) {
    let migrated = false;
    const items = parsedValue.map((item: unknown) => {
      if (typeof item !== 'object' || item === null || !('imageDataUrl' in item)) return item;
      migrated = true;
      return Object.fromEntries(Object.entries(item).filter(([property]) => property !== 'imageDataUrl'));
    });
    if (migrated) writeData(key, items);
    return items as T;
  }
  return parsedValue as T;
}

export function writeData<T>(key: string, value: T): void {
  assertLocalDataDriver('write');
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
  } catch (error) {
    throw new Error(`Could not save local mock data "${key}".`, { cause: error });
  }
}

export function removeData(key: string): void {
  assertLocalDataDriver('remove');
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  } catch (error) {
    throw new Error(`Could not remove local mock data "${key}".`, { cause: error });
  }
}
