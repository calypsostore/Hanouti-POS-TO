import type { StoreRecord, UserSummary } from '../../types/domain';

export interface UserServiceContext {
  listStores(): Promise<StoreRecord[]>;
  getUser(userId: string): Promise<UserSummary | undefined>;
  getStore(storeId: string): Promise<StoreRecord | undefined>;
  getEffectivePermissions(userId: string): Promise<string[]>;
}
