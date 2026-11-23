import type { ReactNode } from 'react';
import { ResponsiveDialog } from './layout/ResponsiveDialog';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  icon?: string;
  children: ReactNode;
  panelClassName?: string;
}

export function BottomSheet({ open, onClose, title, subtitle, icon, children, panelClassName }: BottomSheetProps) {
  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      icon={icon}
      panelClassName={`bottom-sheet-panel ${panelClassName ?? ''}`}
    >
      {children}
    </ResponsiveDialog>
  );
}
