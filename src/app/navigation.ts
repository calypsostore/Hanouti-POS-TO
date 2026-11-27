import type { WorkspaceLink } from '../components/WorkspaceLayout';

export const ownerPrimaryLinks: WorkspaceLink[] = [
  { to: '/owner/dashboard', label: 'nav.dashboard', icon: 'space_dashboard', permission: 'view_dashboard' },
  { to: '/pos', label: 'nav.pos', icon: 'point_of_sale', permission: 'take_orders' },
  { to: '/orders', label: 'nav.orders', icon: 'receipt_long', permission: ['view_order_history', 'view_all_orders'] },
  { to: '/customers', label: 'nav.customers', icon: 'group', permission: ['customers_view', 'customers_create', 'customers_edit', 'use_tabs', 'settle_tabs'] },
];

export const ownerMoreLinks: WorkspaceLink[] = [
  { to: '/owner/staff', label: 'nav.staff', icon: 'groups', ownerOnly: true },
  { to: '/owner/devices', label: 'nav.devices', icon: 'devices', ownerOnly: true },
  { to: '/owner/schedule', label: 'nav.schedule', icon: 'calendar_month', permission: 'manage_schedule' },
  { to: '/owner/catalog', label: 'nav.products', icon: 'inventory_2', permission: 'manage_catalog' },
  { to: '/owner/inventory', label: 'nav.inventory', icon: 'inventory', permission: 'manage_inventory' },
  { to: '/owner/shifts', label: 'nav.shift', icon: 'payments', permission: 'manage_shifts' },
  { to: '/owner/voids', label: 'nav.voidRequests', icon: 'pending_actions', permission: 'resolve_voids' },
  { to: '/owner/waste', label: 'nav.wasteLog', icon: 'delete_sweep', permission: 'manage_waste' },
  { to: '/owner/reports', label: 'nav.reports', icon: 'analytics', permission: 'view_reports' },
  { to: '/owner/fiscal-reports', label: 'nav.fiscalReports', icon: 'receipt_long', permission: 'view_fiscal_reports' },
  { to: '/owner/fiscal', label: 'nav.fiscal', icon: 'account_balance', permission: 'manage_fiscal' },
  { to: '/owner/expenses', label: 'nav.expenses', icon: 'request_quote', permission: 'manage_expenses' },
  { to: '/owner/suppliers', label: 'nav.suppliers', icon: 'local_shipping', permission: 'manage_suppliers' },
  { to: '/owner/activity', label: 'nav.activityLog', icon: 'history', permission: 'view_activity_log' },
  { to: '/notifications', label: 'nav.notifications', icon: 'notifications' },
  { to: '/owner/settings', label: 'nav.settings', icon: 'settings', ownerOnly: true },
];

export const ownerWorkspaceLinks: WorkspaceLink[] = [...ownerPrimaryLinks, ...ownerMoreLinks];

export const adminWorkspaceLinks: WorkspaceLink[] = [
  { to: '/admin/overview', label: 'nav.dashboard', icon: 'space_dashboard' },
  { to: '/admin/stores', label: 'nav.stores', icon: 'storefront' },
  { to: '/admin/settings', label: 'nav.settings', icon: 'settings' },
];
