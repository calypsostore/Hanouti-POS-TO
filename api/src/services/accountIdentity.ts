import { isSupabaseDriver } from '../data/driver';
import { seedStores, seedUsers } from './seedData';
import { readData, writeData } from './storage';

function normalizedName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function identifierHash(value: string): string {
  let hash = 2166136261;
  for (const character of normalizedName(value)) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return (hash >>> 0).toString(36);
}

function storeCodeBase(storeName: string): string {
  const words = normalizedName(storeName).match(/[a-z0-9]+/g) ?? [];
  if (words.length === 0) return `st${identifierHash(storeName).slice(0, 2)}`;
  const compactWords = words.map((word) => word[0] + word.slice(1).replace(/[aeiou]/g, ''));
  const code = (words.length === 1
    ? compactWords[0].slice(0, 4)
    : compactWords.map((word) => word.slice(0, 2)).join('').slice(0, 4));
  return code || `st${identifierHash(storeName).slice(0, 2)}`;
}

export function generateStoreCode(storeName: string, existingCodes: string[] = []): string {
  const base = storeCodeBase(storeName);
  const used = new Set(existingCodes.map((code) => code.toLowerCase()));
  let candidate = base;
  for (let suffix = 1; used.has(candidate); suffix += 1) candidate = `${base}${suffix}`;
  return candidate;
}

function staffNameSlug(name: string): string {
  const firstName = name.trim().split(/\s+/)[0] ?? '';
  return normalizedName(firstName).replace(/[^a-z0-9]+/g, '') || `staff${identifierHash(firstName).slice(0, 6)}`;
}

export function formatStaffUsername(storeCode: string, name: string, existingUsernames: string[] = []): string {
  const base = `${storeCode.toUpperCase()}.${staffNameSlug(name)}`;
  const used = new Set(existingUsernames.map((username) => username.toLowerCase()));
  let candidate = base;
  for (let suffix = 1; used.has(candidate.toLowerCase()); suffix += 1) candidate = `${base}${suffix}`;
  return candidate;
}

export function migrateLegacyDemoStoreIdentity(): void {
  if (isSupabaseDriver()) return;
  const stores = readData('stores', seedStores);
  const demoStore = stores.find((store) => store.id === 'store-cafe12' && store.code.toLowerCase() === 'cafe12');
  if (!demoStore) return;

  const users = readData('users', seedUsers);
  const otherCodes = stores.filter((store) => store.id !== demoStore.id).map((store) => store.code);
  const nextCode = generateStoreCode(demoStore.name, otherCodes);
  const usedUsernames = users
    .filter((user) => user.storeId !== demoStore.id && user.username)
    .map((user) => user.username ?? '');
  const staff = users
    .filter((user) => user.storeId === demoStore.id && user.role === 'staff')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));

  for (const member of staff) {
    const username = formatStaffUsername(nextCode, member.name, usedUsernames);
    usedUsernames.push(username);
    member.username = username;
  }

  writeData('users', users);
  writeData('stores', stores.map((store) => store.id === demoStore.id ? { ...store, code: nextCode } : store));
}
