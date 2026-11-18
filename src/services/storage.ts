const STORAGE_PREFIX = '7anouti-pos:';

export function readData<T>(key: string, initialValue: T): T {
  const storageKey = `${STORAGE_PREFIX}${key}`;
  const storedValue = localStorage.getItem(storageKey);
  if (storedValue === null) {
    writeData(key, initialValue);
    return initialValue;
  }

  try {
    return JSON.parse(storedValue) as T;
  } catch (error) {
    throw new Error(`Could not read local mock data "${key}".`, { cause: error });
  }
}

export function writeData<T>(key: string, value: T): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
  } catch (error) {
    throw new Error(`Could not save local mock data "${key}".`, { cause: error });
  }
}

export function removeData(key: string): void {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  } catch (error) {
    throw new Error(`Could not remove local mock data "${key}".`, { cause: error });
  }
}
