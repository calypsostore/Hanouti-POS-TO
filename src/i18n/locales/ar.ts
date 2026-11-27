import type { TranslationDictionary } from '../types';
import { arCommon } from './ar/common';
import { arAccess } from './ar/access';
import { arPos } from './ar/pos';
import { arOperations } from './ar/operations';
import { arManagement } from './ar/management';
import { arGuidance } from './ar/guidance';
import { arCustomers } from './ar/customers';
import { arSettings } from './ar/settings';
import { arInventory } from './ar/inventory';
import { arReports } from './ar/reports';
import { arStaff } from './ar/staff';
import { arNotifications } from './ar/notifications';

export const ar = {
  ...arCommon,
  ...arAccess,
  ...arPos,
  ...arOperations,
  ...arManagement,
  ...arGuidance,
  ...arCustomers,
  ...arSettings,
  ...arInventory,
  ...arReports,
  ...arStaff,
  ...arNotifications,
} satisfies TranslationDictionary;
