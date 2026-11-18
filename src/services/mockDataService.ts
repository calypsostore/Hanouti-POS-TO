import { seedCatalogItems, seedCategories, seedOrders, seedPositions, seedReports, seedShiftsForStore, seedStores, seedUsers } from './seedData';
import { readData } from './storage';

export function initializeMockData(): void {
  readData('users', seedUsers);
  readData('stores', seedStores);
  readData('positions', seedPositions);
  readData('categories', seedCategories);
  readData('catalog-items', seedCatalogItems);
  readData('orders', seedOrders);
  readData('shifts', seedShiftsForStore);
  readData('reports', seedReports);
  readData('order-counter', 1043);
}
