import type { PermissionDefinition, PermissionOverrides, PositionRecord } from '../../types/domain';

export const PERMISSIONS: PermissionDefinition[] = [
  { id: 'take_orders', group: 'Orders', label: 'Take orders' },
  { id: 'view_order_history', group: 'Orders', label: 'View order history (own orders)' },
  { id: 'view_all_orders', group: 'Orders', label: 'View all orders' },
  { id: 'request_void', group: 'Orders', label: 'Request void' },
  { id: 'add_order_note', group: 'Orders', label: 'Add order note' },
  { id: 'comp_items', group: 'Orders', label: 'Comp items' },
  { id: '86_items', group: 'Catalog', label: '86 items' },
  { id: 'edit_stock_counts', group: 'Catalog', label: 'Edit stock counts' },
  { id: 'customers_view', group: 'Customers and tabs', label: 'View customers' },
  { id: 'customers_create', group: 'Customers and tabs', label: 'Create customers' },
  { id: 'customers_edit', group: 'Customers and tabs', label: 'Edit customers' },
  { id: 'use_tabs', group: 'Customers and tabs', label: 'Charge orders to a tab' },
  { id: 'settle_tabs', group: 'Customers and tabs', label: 'Take tab payments' },
  { id: 'tab_override_limit', group: 'Customers and tabs', label: 'Override tab credit limit' },
  { id: 'open_close_shift', group: 'Shift and cash', label: 'Open / close shift' },
  { id: 'cash_in_out', group: 'Shift and cash', label: 'Cash in/out' },
  { id: 'print_x_report', group: 'Shift and cash', label: 'Print an X report for own shift' },
  { id: 'view_schedule', group: 'Other', label: 'View schedule' },
  { id: 'view_own_hours', group: 'Other', label: 'View own hours' },
];

export function normalizePermissionOverrides(overrides: PermissionOverrides): PermissionOverrides {
  const knownPermissions = new Set(PERMISSIONS.map((permission) => permission.id));
  if ([...overrides.granted, ...overrides.revoked].some((permissionId) => !knownPermissions.has(permissionId))) {
    throw new Error('Permission overrides contain an unknown permission.');
  }
  return {
    granted: [...new Set(overrides.granted)],
    revoked: [...new Set(overrides.revoked)],
  };
}

export function validatePositionCompRules(rules: Pick<PositionRecord,
  'selfServiceItemIds' | 'selfServiceCategoryIds' | 'maxStaffDrinkQuantityPerShift'>): void {
  const maximum = rules.maxStaffDrinkQuantityPerShift;
  if (maximum !== undefined && (!Number.isInteger(maximum) || maximum < 0)) {
    throw new Error('Staff drink limit must be a non-negative whole number.');
  }
  for (const ids of [rules.selfServiceItemIds, rules.selfServiceCategoryIds]) {
    if (ids?.some((id) => !id.trim())) throw new Error('Staff drink item and category selections are invalid.');
  }
}
