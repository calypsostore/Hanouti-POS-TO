import { seedCatalogItems, seedCategories, seedOrders, seedPositions, seedReports, seedShiftsForStore, seedStores, seedUsers } from './seedData';
import { readData } from './storage';
import { isSupabaseDriver } from '../data/driver';

export async function initializeMockData(): Promise<void> {
  if (isSupabaseDriver()) return;
  readData('users', seedUsers);
  readData('stores', seedStores);
  readData('positions', seedPositions);
  readData('categories', seedCategories);
  readData('catalog-items', seedCatalogItems);
  readData('orders', seedOrders);
  readData('shifts', seedShiftsForStore);
  readData('reports', seedReports);
}
