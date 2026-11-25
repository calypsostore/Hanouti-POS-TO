import type {
  FiscalOrderSnapshot,
  FiscalReportSummary,
  FiscalTaxReportLine,
} from '../../types/fiscal';
import { isFiscalOrderSnapshot } from '../../types/fiscal';
import type { OrderStatus } from '../../types/domain';

export interface FiscalReportOrder {
  id: string;
  storeId: string;
  status: OrderStatus;
  totalMillimes: number;
  fiscalSnapshot?: FiscalOrderSnapshot;
}

function addSafe(total: number, amount: number, label: string): number {
  const sum = BigInt(total) + BigInt(amount);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER) || sum < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the supported money range.`);
  }
  return Number(sum);
}

export function aggregateFiscalOrders(orders: readonly FiscalReportOrder[]): FiscalReportSummary {
  const summary: FiscalReportSummary = {
    completedOrderCount: 0,
    ordersWithFiscalSnapshot: 0,
    ordersMissingFiscalSnapshot: 0,
    voidedOrderCount: 0,
    voidedOrdersWithFiscalSnapshot: 0,
    voidedOrdersMissingFiscalSnapshot: 0,
    netAmountMillimes: 0,
    taxAmountMillimes: 0,
    grossAmountMillimes: 0,
    taxes: [],
    reversedNetAmountMillimes: 0,
    reversedTaxAmountMillimes: 0,
    reversedGrossAmountMillimes: 0,
    reversedTaxes: [],
  };
  const taxesByKey = new Map<string, FiscalTaxReportLine>();
  const reversedTaxesByKey = new Map<string, FiscalTaxReportLine>();
  for (const order of orders) {
    if (order.status !== 'done' && order.status !== 'voided') continue;
    const isVoided = order.status === 'voided';
    if (isVoided) summary.voidedOrderCount += 1;
    else summary.completedOrderCount += 1;
    if (!order.fiscalSnapshot) {
      if (isVoided) summary.voidedOrdersMissingFiscalSnapshot += 1;
      else summary.ordersMissingFiscalSnapshot += 1;
      continue;
    }
    if (!isFiscalOrderSnapshot(order.fiscalSnapshot) ||
      order.fiscalSnapshot.storeId !== order.storeId ||
      order.fiscalSnapshot.totalAmountMillimes !== order.totalMillimes) {
      throw new Error(`Completed order ${order.id} has an invalid fiscal snapshot.`);
    }
    const sign = isVoided ? -1 : 1;
    if (isVoided) {
      summary.voidedOrdersWithFiscalSnapshot += 1;
      summary.reversedNetAmountMillimes = addSafe(summary.reversedNetAmountMillimes, sign * order.fiscalSnapshot.netAmountMillimes, 'Fiscal reversed net total');
      summary.reversedTaxAmountMillimes = addSafe(summary.reversedTaxAmountMillimes, sign * order.fiscalSnapshot.totalTaxMillimes, 'Fiscal reversed tax total');
      summary.reversedGrossAmountMillimes = addSafe(summary.reversedGrossAmountMillimes, sign * order.fiscalSnapshot.totalAmountMillimes, 'Fiscal reversed gross total');
    } else {
      summary.ordersWithFiscalSnapshot += 1;
      summary.netAmountMillimes = addSafe(summary.netAmountMillimes, order.fiscalSnapshot.netAmountMillimes, 'Fiscal net total');
      summary.taxAmountMillimes = addSafe(summary.taxAmountMillimes, order.fiscalSnapshot.totalTaxMillimes, 'Fiscal tax total');
      summary.grossAmountMillimes = addSafe(summary.grossAmountMillimes, order.fiscalSnapshot.totalAmountMillimes, 'Fiscal gross total');
    }
    for (const line of order.fiscalSnapshot.lines) {
      for (const tax of line.taxes) {
        const key = `${tax.taxType}:${tax.treatment}:${tax.ruleId ?? ''}:${tax.ruleVersion ?? ''}`;
        const target = isVoided ? reversedTaxesByKey : taxesByKey;
        const current = target.get(key) ?? {
          taxType: tax.taxType,
          treatment: tax.treatment,
          ruleId: tax.ruleId,
          ruleVersion: tax.ruleVersion,
          taxableBaseMillimes: 0,
          amountMillimes: 0,
        };
        current.taxableBaseMillimes = addSafe(current.taxableBaseMillimes, sign * tax.taxableBaseMillimes, 'Fiscal taxable base');
        current.amountMillimes = addSafe(current.amountMillimes, sign * tax.amountMillimes, 'Fiscal tax component');
        target.set(key, current);
      }
    }
  }
  if (summary.netAmountMillimes + summary.taxAmountMillimes !== summary.grossAmountMillimes) {
    throw new Error('Fiscal report totals do not reconcile.');
  }
  if (summary.reversedNetAmountMillimes + summary.reversedTaxAmountMillimes !== summary.reversedGrossAmountMillimes) {
    throw new Error('Fiscal void reversals do not reconcile to their original snapshots.');
  }
  summary.taxes = [...taxesByKey.values()].sort((left, right) =>
    left.taxType.localeCompare(right.taxType) ||
    left.treatment.localeCompare(right.treatment) ||
    (left.ruleId ?? '').localeCompare(right.ruleId ?? '') ||
    (left.ruleVersion ?? 0) - (right.ruleVersion ?? 0));
  summary.reversedTaxes = [...reversedTaxesByKey.values()].sort((left, right) =>
    left.taxType.localeCompare(right.taxType) ||
    left.treatment.localeCompare(right.treatment) ||
    (left.ruleId ?? '').localeCompare(right.ruleId ?? '') ||
    (left.ruleVersion ?? 0) - (right.ruleVersion ?? 0));
  return summary;
}
