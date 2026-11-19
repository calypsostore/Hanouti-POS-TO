import type { ReactNode } from 'react';
import { ResponsiveDialog } from './layout/ResponsiveDialog';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  return (
    <ResponsiveDialog open={open} onClose={onClose} title={title}>{children}</ResponsiveDialog>
  );
}
