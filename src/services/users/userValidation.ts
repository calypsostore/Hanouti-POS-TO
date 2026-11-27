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
  { id: 'manage_store_operations', group: 'Store operations', label: 'Manage all store operations' },
  { id: 'view_dashboard', group: 'Store operations', label: 'View business dashboard' },
  { id: 'manage_catalog', group: 'Store operations', label: 'Manage products and categories' },
  { id: 'manage_schedule', group: 'Store operations', label: 'Manage staff schedule' },
  { id: 'resolve_voids', group: 'Store operations', label: 'Approve or reject void requests' },
  { id: 'manage_shifts', group: 'Store operations', label: 'Manage all shifts and close reports' },
  { id: 'view_reports', group: 'Store operations', label: 'View business reports' },
  { id: 'manage_fiscal', group: 'Store operations', label: 'Manage fiscal configuration' },
  { id: 'view_fiscal_reports', group: 'Store operations', label: 'View fiscal reports' },
  { id: 'manage_inventory', group: 'Store operations', label: 'Manage inventory' },
  { id: 'manage_waste', group: 'Store operations', label: 'Manage waste records' },
  { id: 'manage_expenses', group: 'Store operations', label: 'Manage expenses' },
  { id: 'manage_suppliers', group: 'Store operations', label: 'Manage suppliers and payments' },
  { id: 'view_activity_log', group: 'Store operations', label: 'View activity history' },
];

export function expandPermissionIds(permissionIds: Iterable<string>): string[] {
  const permissions = new Set(permissionIds);
  if (permissions.has('manage_store_operations')) {
    for (const permission of PERMISSIONS) permissions.add(permission.id);
  }
  const implications: Record<string, string[]> = {
    manage_catalog: ['86_items'],
    manage_schedule: ['view_schedule'],
    resolve_voids: ['view_all_orders'],
    manage_shifts: ['open_close_shift', 'print_x_report', 'view_all_orders', 'view_dashboard', 'view_reports', 'resolve_voids'],
    view_reports: ['view_dashboard', 'view_all_orders'],
    view_dashboard: ['view_all_orders'],
    manage_inventory: ['edit_stock_counts'],
    manage_waste: ['edit_stock_counts'],
  };
  for (const [permissionId, impliedPermissions] of Object.entries(implications)) {
    if (permissions.has(permissionId)) {
      for (const impliedPermission of impliedPermissions) permissions.add(impliedPermission);
    }
  }
  return [...permissions];
}

export function resolveEffectivePermissionIds(
  basePermissionIds: Iterable<string>,
  grantedOverrides: string[] = [],
  revokedOverrides: string[] = [],
): string[] {
  const revoked = new Set(revokedOverrides);
  const effective = new Set(expandPermissionIds(
    [...basePermissionIds, ...grantedOverrides].filter((permissionId) => !revoked.has(permissionId)),
  ));
  for (const permissionId of revokedOverrides) effective.delete(permissionId);
  return [...effective];
}

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
