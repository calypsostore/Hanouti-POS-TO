import type { WorkspaceLink } from '../components/WorkspaceLayout';

export const ownerPrimaryLinks: WorkspaceLink[] = [
  { to: '/owner/dashboard', label: 'nav.dashboard', icon: 'space_dashboard' },
  { to: '/orders', label: 'nav.orders', icon: 'receipt_long' },
  { to: '/customers', label: 'nav.customers', icon: 'group' },
  { to: '/owner/reports', label: 'nav.reports', icon: 'analytics' },
];

export const ownerMoreLinks: WorkspaceLink[] = [
  { to: '/owner/staff', label: 'nav.staff', icon: 'groups' },
  { to: '/owner/schedule', label: 'nav.schedule', icon: 'calendar_month' },
  { to: '/owner/catalog', label: 'nav.products', icon: 'inventory_2' },
  { to: '/owner/inventory', label: 'nav.inventory', icon: 'inventory' },
  { to: '/owner/shifts', label: 'nav.shift', icon: 'payments' },
  { to: '/owner/voids', label: 'nav.voidRequests', icon: 'pending_actions' },
  { to: '/owner/waste', label: 'nav.wasteLog', icon: 'delete_sweep' },
  { to: '/owner/expenses', label: 'nav.expenses', icon: 'request_quote' },
  { to: '/owner/suppliers', label: 'nav.suppliers', icon: 'local_shipping' },
  { to: '/owner/activity', label: 'nav.activityLog', icon: 'history' },
  { to: '/owner/notifications', label: 'nav.notifications', icon: 'notifications' },
  { to: '/owner/settings', label: 'nav.settings', icon: 'tune' },
];

export const ownerWorkspaceLinks: WorkspaceLink[] = [...ownerPrimaryLinks, ...ownerMoreLinks];

export const adminWorkspaceLinks: WorkspaceLink[] = [
  { to: '/admin/overview', label: 'nav.dashboard', icon: 'space_dashboard' },
  { to: '/admin/stores', label: 'nav.stores', icon: 'storefront' },
  { to: '/admin/settings', label: 'nav.settings', icon: 'tune' },
];
