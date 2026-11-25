import { BottomSheet } from '../../../components/BottomSheet';
import { Button } from '../../../components/Button';
import { DinarInput } from '../../../components/DinarInput';
import { MaterialIcon } from '../../../components/MaterialIcon';
import { t } from '../../../i18n/translations';
import type { ShiftDialogsProps } from './ShiftDialogs';


export function ShiftOpeningDialog({
    openShiftSheetOpen,
    closeStartingCashSheet,
    startingCash,
    setStartingCash,
    setStartingCashEdited,
    openShift,
}: Pick<ShiftDialogsProps, 'openShiftSheetOpen' | 'closeStartingCashSheet' | 'startingCash' | 'setStartingCash' | 'setStartingCashEdited' | 'openShift'>) {
  return (
    <>
<BottomSheet open={openShiftSheetOpen} onClose={closeStartingCashSheet} title={t('shift.openShift')}>
        <form onSubmit={(event) => { void openShift(event); }} className="flex flex-col gap-3">
          <p className="font-body text-body-sm text-on-surface-variant">Count the cash drawer before taking orders.</p>
          <label htmlFor="starting-cash" className="block font-body text-label-md">{t('shift.startingCash')} (TND)</label>
          <DinarInput id="starting-cash" required value={startingCash} onChange={(event) => { setStartingCash(event.target.value); setStartingCashEdited(true); }} className="h-14 w-full rounded-xl bg-surface-container-low px-4 font-body text-title-md tabular-nums outline-none focus:ring-2 focus:ring-primary" />
          <div className="sheet-action-bar grid grid-cols-2 gap-2">
            <Button type="button" variant="ghost" onClick={closeStartingCashSheet}>{t('common.cancel')}</Button>
            <Button type="submit"><MaterialIcon name="lock_open" />{t('shift.openShift')}</Button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
