import { enCommon } from './en/common';
import { enAccess } from './en/access';
import { enPos } from './en/pos';
import { enOperations } from './en/operations';
import { enManagement } from './en/management';
import { enGuidance } from './en/guidance';
import { enCustomers } from './en/customers';
import { enSettings } from './en/settings';
import { enInventory } from './en/inventory';
import { enReports } from './en/reports';
import { enStaff } from './en/staff';
import { enNotifications } from './en/notifications';

export const en = {
  ...enCommon,
  ...enAccess,
  ...enPos,
  ...enOperations,
  ...enManagement,
  ...enGuidance,
  ...enCustomers,
  ...enSettings,
  ...enInventory,
  ...enReports,
  ...enStaff,
  ...enNotifications,
} as const;
