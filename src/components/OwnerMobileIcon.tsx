import {
  BarChart3,
  Bell,
  Boxes,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Ellipsis,
  History,
  LayoutDashboard,
  LayoutGrid,
  Package,
  Receipt,
  ReceiptText,
  Settings,
  ShoppingCart,
  Trash2,
  Truck,
  UsersRound,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react';

const icons: Record<string, LucideIcon | undefined> = {
  analytics: BarChart3,
  calendar_month: CalendarDays,
  chevron_right: ChevronRight,
  delete_sweep: Trash2,
  grid_view: LayoutGrid,
  group: UsersRound,
  groups: UsersRound,
  history: History,
  inventory: Boxes,
  inventory_2: Package,
  local_shipping: Truck,
  more_horiz: Ellipsis,
  notifications: Bell,
  payments: WalletCards,
  pending_actions: ClipboardList,
  point_of_sale: ShoppingCart,
  receipt_long: ReceiptText,
  request_quote: Receipt,
  settings: Settings,
  space_dashboard: LayoutDashboard,
  close: X,
};

interface OwnerMobileIconProps {
  name: string;
  className?: string;
  size?: number;
}

export function OwnerMobileIcon({ name, className, size = 22 }: OwnerMobileIconProps) {
  const Icon = icons[name];
  if (!Icon) throw new Error(`Unsupported owner mobile navigation icon: ${name}`);

  return <Icon aria-hidden="true" className={className} focusable="false" size={size} strokeWidth={2} />;
}
