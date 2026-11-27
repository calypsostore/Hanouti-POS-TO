import type { TranslationDictionary } from '../types';
import { frCommon } from './fr/common';
import { frAccess } from './fr/access';
import { frPos } from './fr/pos';
import { frOperations } from './fr/operations';
import { frManagement } from './fr/management';
import { frGuidance } from './fr/guidance';
import { frCustomers } from './fr/customers';
import { frSettings } from './fr/settings';
import { frInventory } from './fr/inventory';
import { frReports } from './fr/reports';
import { frStaff } from './fr/staff';
import { frNotifications } from './fr/notifications';

export const fr = {
  ...frCommon,
  ...frAccess,
  ...frPos,
  ...frOperations,
  ...frManagement,
  ...frGuidance,
  ...frCustomers,
  ...frSettings,
  ...frInventory,
  ...frReports,
  ...frStaff,
  ...frNotifications,
} satisfies TranslationDictionary;
