import type { WorkspaceLink } from '../components/WorkspaceLayout';

export const ownerWorkspaceLinks: WorkspaceLink[] = [
  { to: '/owner/dashboard', label: 'nav.dashboard', icon: 'space_dashboard' },
  { to: '/owner/catalog', label: 'nav.catalog', icon: 'inventory_2' },
  { to: '/orders', label: 'nav.orders', icon: 'receipt_long' },
  { to: '/customers', label: 'nav.customers', icon: 'group' },
  { to: '/owner/staff', label: 'nav.staff', icon: 'groups' },
  { to: '/owner/schedule', label: 'nav.schedule', icon: 'calendar_month' },
  { to: '/owner/voids', label: 'nav.voidRequests', icon: 'pending_actions' },
  { to: '/owner/shifts', label: 'nav.shift', icon: 'payments' },
  { to: '/owner/reports', label: 'nav.reports', icon: 'analytics' },
  { to: '/owner/inventory', label: 'nav.inventory', icon: 'inventory' },
  { to: '/owner/waste', label: 'nav.wasteLog', icon: 'delete_sweep' },
  { to: '/owner/settings', label: 'nav.settings', icon: 'tune' },
];

export const adminWorkspaceLinks: WorkspaceLink[] = [
  { to: '/admin/stores', label: 'nav.stores', icon: 'storefront' },
  { to: '/admin/settings', label: 'nav.settings', icon: 'tune' },
];
