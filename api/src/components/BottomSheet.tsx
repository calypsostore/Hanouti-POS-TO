import type { ReactNode } from 'react';
import { ResponsiveDialog } from './layout/ResponsiveDialog';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  panelClassName?: string;
}

export function BottomSheet({ open, onClose, title, children, panelClassName }: BottomSheetProps) {
  return (
    <ResponsiveDialog open={open} onClose={onClose} title={title} panelClassName={panelClassName}>{children}</ResponsiveDialog>
  );
}
