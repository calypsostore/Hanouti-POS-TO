import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { subscribeToStoreChanges } from '../../../data/repositories/realtimeRepository';
import { createLatestRequestGuard } from '../../../lib/requestGuard';
import { useFocusRefreshKey } from '../../../lib/useFocusRefreshKey';
import { compService } from '../../../services/compService';
import { orderService } from '../../../services/orderService';
import { reportService, type ReportDayStatus } from '../../../services/reportService';
import { shiftService } from '../../../services/shiftService';
import { userService } from '../../../services/userService';
import { t } from '../../../i18n/translations';
import type { OrderRecord, ShiftRecord, StoreRecord, UserSummary } from '../../../types/domain';
import type { ShiftCloseBreakdown } from '../utils/shiftCalculations';

interface UseShiftDataOptions {
  storeId: string;
  user: UserSummary | null;
  ownerMode: boolean;
  setError: Dispatch<SetStateAction<string>>;
}

export function useShiftData({ storeId, user, ownerMode, setError }: UseShiftDataOptions) {
  const refreshKey = useFocusRefreshKey();
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [ownOpenShift, setOwnOpenShift] = useState<ShiftRecord>();
  const [store, setStore] = useState<StoreRecord>();
  const [breakdownsByShift, setBreakdownsByShift] = useState<Record<string, ShiftCloseBreakdown>>({});
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [pendingVoidOrders, setPendingVoidOrders] = useState<OrderRecord[]>([]);
  const [cashMovements, setCashMovements] = useState<Awaited<ReturnType<typeof shiftService.listCashMovements>>>([]);
  const [canCashInOut, setCanCashInOut] = useState(false);
  const [canOpenCloseShift, setCanOpenCloseShift] = useState(false);
  const [canPrintOwnX, setCanPrintOwnX] = useState(false);
  const [archiveReports, setArchiveReports] = useState<Awaited<ReturnType<typeof reportService.listReports>>>([]);
  const [dayStatus, setDayStatus] = useState<ReportDayStatus>({
    dayIsClosed: false,
    hasActivity: false,
    openShiftCount: 0,
  });
  const refreshGuardRef = useRef(createLatestRequestGuard());

  const refresh = useCallback(async () => {
    const generation = refreshGuardRef.current.begin();
    const [nextShifts, nextOpenShift, nextStore, nextMovements, allOrders, users, cashPermission, shiftPermission, xPermission, comps, nextReports, nextDayStatus] = await Promise.all([
      shiftService.listShifts(storeId),
      user ? shiftService.getOpenShiftForUser(storeId, user.id) : Promise.resolve(undefined),
      userService.getStore(storeId),
      shiftService.listCashMovements(storeId),
      orderService.listAll(storeId),
      userService.listUsers(storeId),
      user?.role === 'owner' ? Promise.resolve(true) : user ? userService.hasPermission(user.id, 'cash_in_out') : Promise.resolve(false),
      user?.role === 'owner' ? Promise.resolve(true) : user ? userService.hasPermission(user.id, 'open_close_shift') : Promise.resolve(false),
      user?.role === 'owner' ? Promise.resolve(false) : user ? userService.hasPermission(user.id, 'print_x_report') : Promise.resolve(false),
      compService.listComps(storeId),
      ownerMode ? reportService.listReports(storeId) : Promise.resolve([]),
      reportService.getDayStatus(storeId),
    ]);
    if (!refreshGuardRef.current.isLatest(generation)) return;
    setShifts(nextShifts);
    setOwnOpenShift(nextOpenShift);
    setStore(nextStore);
    setCashMovements(nextMovements);
    setStaffNames(Object.fromEntries(users.map((member) => [member.id, member.name])));
    setPendingVoidOrders(allOrders.filter((order) => order.status === 'pending_void' &&
      (ownerMode || order.staffId === user?.id)));
    setCanCashInOut(cashPermission);
    setCanOpenCloseShift(shiftPermission);
    setCanPrintOwnX(xPermission);
    if (ownerMode) setArchiveReports(nextReports);
    setDayStatus(nextDayStatus);
    const breakdowns = await Promise.all(nextShifts.filter((shift) => shift.status === 'open')
      .map(async (shift) => {
        const [sales, pendingVoidCount] = await Promise.all([
          orderService.getShiftSalesBreakdown(shift.id),
          orderService.getPendingVoidCountForShift(shift.id),
        ]);
        const compsMillimes = comps
          .filter((comp) => comp.shiftId === shift.id)
          .reduce((sum, comp) => sum + comp.valueMillimes, 0);
        return [shift.id, { ...sales, pendingVoidCount, compsMillimes }] as const;
      }));
    if (!refreshGuardRef.current.isLatest(generation)) return;
    setBreakdownsByShift(Object.fromEntries(breakdowns));
  }, [storeId, user, ownerMode]);

  useEffect(() => {
    setLoading(true);
    void refresh().catch((loadError: unknown) => {
      console.error('Unable to load shifts.', loadError);
      setError(t('common.loadFailed'));
    }).finally(() => setLoading(false));
  }, [refresh, refreshKey, setError]);

  useEffect(() => subscribeToStoreChanges(storeId, ['orders', 'shifts', 'notifications', 'reports', 'stores'], () => {
    void refresh().catch((loadError: unknown) => {
      console.error('Unable to refresh shifts after a live update.', loadError);
      setError(t('common.refreshFailed'));
    });
  }), [refresh, setError, storeId]);

  return {
    shifts,
    setShifts,
    loading,
    ownOpenShift,
    store,
    breakdownsByShift,
    staffNames,
    setStaffNames,
    pendingVoidOrders,
    setPendingVoidOrders,
    cashMovements,
    canCashInOut,
    canOpenCloseShift,
    canPrintOwnX,
    archiveReports,
    dayStatus,
    setDayStatus,
    refresh,
    refreshKey,
  };
}
