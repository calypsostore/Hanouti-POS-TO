import type { ReactNode } from 'react';
import { ResponsiveDialog } from './layout/ResponsiveDialog';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  icon?: string;
  iconElement?: ReactNode;
  closeIcon?: ReactNode;
  children: ReactNode;
  panelClassName?: string;
}

export function BottomSheet({ open, onClose, title, subtitle, icon, iconElement, closeIcon, children, panelClassName }: BottomSheetProps) {
  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      icon={icon}
      iconElement={iconElement}
      closeIcon={closeIcon}
      overlayKind="sheet"
      panelClassName={`bottom-sheet-panel ${panelClassName ?? ''}`}
    >
      {children}
    </ResponsiveDialog>
  );
}
