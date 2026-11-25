import { ShiftActionDialogs } from './ShiftActionDialogs';
import { ShiftOpeningDialog } from './ShiftOpeningDialog';
import { ZReportDialog } from './ZReportDialog';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { CashMovementReason, CashMovementRecord, OrderRecord, ReportShiftLine, ShiftRecord, StoreRecord, UnresolvedTabReversalRecord } from '../../../types/domain';
import type { ShiftCloseBreakdown } from '../utils/shiftCalculations';

type Setter<T> = Dispatch<SetStateAction<T>>;

export interface ShiftDialogsProps {
  ownerMode: boolean;
  store: StoreRecord | undefined;
  openShiftSheetOpen: boolean;
  closeStartingCashSheet: () => void;
  startingCash: string;
  setStartingCash: Setter<string>;
  setStartingCashEdited: Setter<boolean>;
  openShift: (event: FormEvent<HTMLFormElement>) => void;
  zSheetOpen: boolean;
  setZSheetOpen: Setter<boolean>;
  ownerPin: string;
  setOwnerPin: Setter<string>;
  zCountedCash: string;
  setZCountedCash: Setter<string>;
  zCountedCard: string;
  setZCountedCard: Setter<string>;
  zCountedOther: string;
  setZCountedOther: Setter<string>;
  zNote: string;
  setZNote: Setter<string>;
  zStep: 0 | 1 | 2;
  setZStep: Setter<0 | 1 | 2>;
  forceEverythingConfirmed: boolean;
  setForceEverythingConfirmed: Setter<boolean>;
  forceCloseEverything: () => void;
  openShifts: ShiftRecord[];
  pendingVoidOrders: OrderRecord[];
  staffNames: Record<string, string>;
  zUnresolvedReversals: UnresolvedTabReversalRecord[];
  error: string;
  setError: Setter<string>;
  zBusy: boolean;
  verifyZOwnerPin: () => void;
  closeDayWithZ: () => void;
  zPaymentSplit: { cash: number; card: number; other: number; tab: number };
  zCardTabPayments: number;
  zOtherTabPayments: number;
  zVoids: { count: number; totalMillimes: number };
  zPendingVoids: { count: number; totalMillimes: number };
  zShiftLines: ReportShiftLine[];
  zExpectedCash: number;
  zExpectedCard: number;
  zExpectedOther: number;
  zReviewed: boolean;
  zDifference: number | undefined;
  zCardDifference: number | undefined;
  zOtherDifference: number | undefined;
  parsedZCountedCash: number | undefined;
  parsedZCardMillimes: number | undefined;
  parsedZOtherMillimes: number | undefined;
  hasZDifference: boolean;
  hasZCountInputs: boolean;
  closeShiftSheetOpen: boolean;
  ownOpenShift: ShiftRecord | undefined;
  closeCountedCashSheet: () => void;
  ownBreakdown: ShiftCloseBreakdown;
  cashMovements: CashMovementRecord[];
  countedCash: string;
  differenceNote: string;
  setCountedCash: Setter<string>;
  setDifferenceNote: Setter<string>;
  closeShift: (event: FormEvent<HTMLFormElement>) => void;
  forceCloseShiftTarget: ShiftRecord | null;
  setForceCloseShiftTarget: Setter<ShiftRecord | null>;
  forceShiftConfirmed: boolean;
  setForceShiftConfirmed: Setter<boolean>;
  forceShiftPin: string;
  setForceShiftPin: Setter<string>;
  forceCloseShift: (event: FormEvent<HTMLFormElement>, shift: ShiftRecord) => void;
  movementSheetOpen: boolean;
  setMovementSheetOpen: Setter<boolean>;
  movementKind: 'in' | 'out';
  movementAmount: string;
  setMovementAmount: Setter<string>;
  movementReason: CashMovementReason;
  setMovementReason: Setter<CashMovementReason>;
  movementNote: string;
  setMovementNote: Setter<string>;
  movementBusy: boolean;
  movementShiftId: string;
  enteredMovementMillimes: number | undefined;
  submitCashMovement: (event: FormEvent<HTMLFormElement>) => void;
  cashMovementHistoryShift: ShiftRecord | null;
  cashMovementHistoryClosing: boolean;
  closeCashMovementHistory: () => void;
  closeCashMovementHistoryAndViewAll: () => void;
}

export function ShiftDialogs(props: ShiftDialogsProps) {
  return (
    <>
      <ShiftOpeningDialog {...props} />
      <ZReportDialog {...props} />
      <ShiftActionDialogs {...props} />
    </>
  );
}
