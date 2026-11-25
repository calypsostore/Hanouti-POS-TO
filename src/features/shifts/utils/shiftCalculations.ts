import type { ShiftSalesBreakdown } from '../../../services/orderService';
import { parseNonNegativeMillimes } from '../../../lib/millimes';
import type { CashMovementRecord, ShiftRecord } from '../../../types/domain';

export type ShiftCloseBreakdown = ShiftSalesBreakdown & {
  pendingVoidCount: number;
  compsMillimes: number;
};

export const emptyShiftBreakdown: ShiftCloseBreakdown = {
  orderCount: 0,
  cashSalesMillimes: 0,
  cardSalesMillimes: 0,
  otherSalesMillimes: 0,
  tabSalesMillimes: 0,
  tabPaymentsMillimes: 0,
  cardTabPaymentsMillimes: 0,
  otherTabPaymentsMillimes: 0,
  voidsMillimes: 0,
  pendingVoidCount: 0,
  compsMillimes: 0,
};

export function parseMillimes(value: string): number {
  const millimes = parseNonNegativeMillimes(value);
  if (millimes === undefined) throw new Error('Enter a valid non-negative TND amount with up to three decimal places.');
  return millimes;
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function validDateKey(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && localDateKey(date) === value;
}

export function getSparklinePath(values: number[]): string {
  if (values.length < 2) return '';
  const width = 64;
  const height = 20;
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 2 - ((value - min) / range) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M${points.join(' L')}`;
}

export function smoothSparklinePath(path: string): string {
  const points = Array.from(
    path.matchAll(/(?:M|L)([\d.]+),([\d.]+)/g),
    ([, x, y]) => ({ x: Number(x), y: Number(y) }),
  );
  if (points.length < 3) return path;

  let smoothPath = `M${points[0].x},${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const nextPoint = points[index + 1];
    smoothPath += ` Q${point.x},${point.y} ${(point.x + nextPoint.x) / 2},${(point.y + nextPoint.y) / 2}`;
  }
  const lastPoint = points[points.length - 1];
  const previousPoint = points[points.length - 2];
  return `${smoothPath} Q${previousPoint.x},${previousPoint.y} ${lastPoint.x},${lastPoint.y}`;
}

export function getSparklineAreaPath(values: number[]): string {
  const path = smoothSparklinePath(getSparklinePath(values));
  return path ? `${path} L64,20 L0,20 Z` : '';
}

export function getCashMovementTotals(movements: CashMovementRecord[], shiftId: string) {
  return movements
    .filter((movement) => movement.shiftId === shiftId)
    .reduce((totals, movement) => {
      totals[movement.kind === 'in' ? 'cashInMillimes' : 'cashOutMillimes'] += movement.amountMillimes;
      return totals;
    }, { cashInMillimes: 0, cashOutMillimes: 0 });
}

export function getExpectedCash(shift: ShiftRecord, breakdown: ShiftCloseBreakdown, movements: CashMovementRecord[]) {
  const movementTotals = getCashMovementTotals(movements, shift.id);
  return shift.startingCashMillimes + breakdown.cashSalesMillimes + breakdown.tabPaymentsMillimes +
    movementTotals.cashInMillimes - movementTotals.cashOutMillimes;
}
