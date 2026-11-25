import { useNavigate } from 'react-router-dom';
import type { Dispatch, SetStateAction } from 'react';
import { MaterialIcon } from '../../../components/MaterialIcon';
import { formatTnd } from '../../../lib/format';
import {
  getShiftOverviewChange,
  getShiftOverviewSeries,
  type ShiftOverviewAnalytics,
  type ShiftOverviewDateRange,
  type ShiftOverviewFilter,
  type ShiftOverviewMetricKey,
} from '../../../lib/shiftOverview';
import type { OrderRecord, ShiftRecord } from '../../../types/domain';
import {
  emptyShiftBreakdown,
  getSparklineAreaPath,
  getSparklinePath,
  smoothSparklinePath,
  type ShiftCloseBreakdown,
} from '../utils/shiftCalculations';

interface ShiftOverviewProps {
  ownerMode: boolean;
  overviewFilter: ShiftOverviewFilter;
  setOverviewFilter: Dispatch<SetStateAction<ShiftOverviewFilter>>;
  customOverviewFrom: string;
  setCustomOverviewFrom: Dispatch<SetStateAction<string>>;
  customOverviewTo: string;
  setCustomOverviewTo: Dispatch<SetStateAction<string>>;
  overviewRange: ShiftOverviewDateRange | undefined;
  todayOverviewDate: string;
  overviewAnalytics: ShiftOverviewAnalytics | undefined;
  overviewLoading: boolean;
  overviewError: string;
  setOverviewRetry: Dispatch<SetStateAction<number>>;
  openCount: number;
  openShifts: ShiftRecord[];
  breakdownsByShift: Record<string, ShiftCloseBreakdown>;
  pendingVoidOrders: OrderRecord[];
}

export function ShiftOverview(props: ShiftOverviewProps) {
  const {
    ownerMode, overviewFilter, setOverviewFilter, customOverviewFrom, setCustomOverviewFrom,
    customOverviewTo, setCustomOverviewTo, overviewRange, todayOverviewDate, overviewAnalytics,
    overviewLoading, overviewError, setOverviewRetry, openCount, openShifts, breakdownsByShift,
    pendingVoidOrders,
  } = props;
  const navigate = useNavigate();

  const liveShiftTotals = openShifts.reduce((totals, shift) => {
    const breakdown = breakdownsByShift[shift.id] ?? emptyShiftBreakdown;
    return {
      transactions: totals.transactions + breakdown.orderCount,
      cash: totals.cash + breakdown.cashSalesMillimes,
      cards: totals.cards + breakdown.cardSalesMillimes,
      sales: totals.sales + breakdown.cashSalesMillimes + breakdown.cardSalesMillimes + breakdown.otherSalesMillimes + breakdown.tabSalesMillimes,
    };
  }, { transactions: 0, cash: 0, cards: 0, sales: 0 });
  const metricAmount = (millimes: number) => `${formatTnd(millimes / 1000)} DT`;
  const overviewMetrics: {
    key: ShiftOverviewMetricKey;
    label: string;
    icon: string;
    tone: string;
    explanation: string;
  }[] = [
    {
      key: 'sales',
      label: 'Total Sales',
      icon: 'shopping_cart',
      tone: 'cyan',
      explanation: 'Completed order totals in the selected period. Cancelled and pending-void orders are excluded.',
    },
    {
      key: 'transactions',
      label: 'Transactions',
      icon: 'receipt_long',
      tone: 'blue',
      explanation: 'Count of completed orders, not individual payment records.',
    },
    {
      key: 'cash',
      label: 'Cash',
      icon: 'payments',
      tone: 'green',
      explanation: 'Cash order payments plus net cash customer-tab settlements and reversals.',
    },
    {
      key: 'cards',
      label: 'Cards',
      icon: 'credit_card',
      tone: 'purple',
      explanation: 'Card order payments plus net card customer-tab settlements and reversals.',
    },
    {
      key: 'expenses',
      label: 'Expenses',
      icon: 'work',
      tone: 'orange',
      explanation: 'Recorded expenses dated within the selected period.',
    },
    {
      key: 'netSales',
      label: 'Net Sales',
      icon: 'trending_up',
      tone: 'cyan',
      explanation: 'Net collections: cash, card, and other payments after valid reversals, minus expenses. Unsettled tabs are excluded.',
    },
  ];
  const summaryMetrics = overviewMetrics.map((metric) => {
    const currentValue = overviewAnalytics?.current[metric.key];
    const previousValue = overviewAnalytics?.previous[metric.key];
    const change = currentValue === undefined || previousValue === undefined || !overviewAnalytics
      ? { direction: 'unavailable' as const }
      : getShiftOverviewChange(currentValue, previousValue, overviewAnalytics.comparisonAvailable);
    const series = overviewAnalytics ? getShiftOverviewSeries(overviewAnalytics, metric.key) : [];
    const changeLabel = change.direction === 'unavailable'
      ? 'Insufficient historical data'
      : change.direction === 'new'
        ? 'New'
        : `${change.percent && change.percent > 0 ? '+' : ''}${Math.round(change.percent ?? 0)}%`;
    const reportParams = new URLSearchParams({
      insightRange: 'custom',
      from: overviewRange?.from ?? todayOverviewDate,
      to: overviewRange?.to ?? todayOverviewDate,
    });
    const to = metric.key === 'transactions'
      ? overviewRange && overviewRange.from === overviewRange.to
        ? `/orders?businessDate=${overviewRange.from}`
        : `/owner/reports?${reportParams.toString()}`
      : metric.key === 'expenses'
        ? `/owner/expenses?month=${(overviewRange?.from ?? todayOverviewDate).slice(0, 7)}`
        : `/owner/reports?${reportParams.toString()}`;
    return {
      ...metric,
      value: currentValue === undefined
        ? overviewLoading ? 'Loading' : '—'
        : metric.key === 'transactions' ? String(currentValue) : metricAmount(currentValue),
      change,
      changeLabel,
      series,
      to,
      tooltip: `${metric.explanation} Compared with ${overviewRange?.previousFrom ?? 'previous period'} through ${overviewRange?.previousTo ?? 'previous period'}.`,
    };
  });
  const shiftOverviewMetrics = ownerMode ? summaryMetrics : [
    { label: 'Open shifts', value: String(openCount), icon: 'schedule', tone: 'primary' },
    { label: 'Transactions', value: String(liveShiftTotals.transactions), icon: 'receipt_long', tone: 'cyan' },
    { label: 'Cash sales', value: metricAmount(liveShiftTotals.cash), icon: 'payments', tone: 'green' },
    { label: 'Card sales', value: metricAmount(liveShiftTotals.cards), icon: 'credit_card', tone: 'blue' },
    { label: 'Pending voids', value: String(pendingVoidOrders.length), icon: 'pending_actions', tone: 'orange' },
  ];

  return (
    <>
{ownerMode && (
        <div className="shift-overview-toolbar" aria-label="KPI reporting filters">
          <div className="shift-overview-periods" role="group" aria-label="KPI date range">
            {([
              ['today', 'Today'],
              ['yesterday', 'Yesterday'],
              ['last7', 'Last 7 days'],
              ['last30', 'Last 30 days'],
              ['month', 'This month'],
              ['custom', 'Custom'],
            ] as [ShiftOverviewFilter, string][]).map(([filter, label]) => (
              <button
                key={filter}
                type="button"
                aria-pressed={overviewFilter === filter}
                onClick={() => setOverviewFilter(filter)}
                className={`shift-overview-period${overviewFilter === filter ? ' is-active' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
          {overviewFilter === 'custom' && (
            <div className="shift-overview-custom-range">
              <label>
                From
                <input
                  type="date"
                  value={customOverviewFrom}
                  max={customOverviewTo}
                  onChange={(event) => setCustomOverviewFrom(event.target.value)}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={customOverviewTo}
                  min={customOverviewFrom}
                  onChange={(event) => setCustomOverviewTo(event.target.value)}
                />
              </label>
            </div>
          )}
        </div>
      )}
{ownerMode && overviewError && (
        <div className="shift-overview-error" role="alert">
          <span>{overviewError}</span>
          <button type="button" onClick={() => setOverviewRetry((retry) => retry + 1)}>Retry</button>
        </div>
      )}
<section className="shift-overview-grid mb-4" aria-label="Shift overview" aria-busy={ownerMode && overviewLoading}>
        {shiftOverviewMetrics.map((card) => {
          if (!('key' in card)) {
            return (
              <article key={card.label} className={`shift-overview-card shift-overview-card--${card.tone}`}>
                <span className="shift-overview-icon grid size-11 shrink-0 place-items-center rounded-full">
                  <MaterialIcon name={card.icon} className="text-xl" />
                </span>
                <div className="shift-overview-copy min-w-0">
                  <p className="font-body text-label-sm text-on-surface-variant">{card.label}</p>
                  <strong className="mt-1 block truncate font-display text-title-md tabular-nums text-on-surface">{card.value}</strong>
                </div>
              </article>
            );
          }
          const changeArrow = card.change.direction === 'down'
            ? '↓'
            : card.change.direction === 'neutral'
              ? '→'
              : card.change.direction === 'unavailable'
                ? '–'
                : '↑';
          const changeTone = card.change.direction === 'up' || card.change.direction === 'new'
            ? 'is-positive'
            : card.change.direction === 'down'
              ? 'is-negative'
              : card.change.direction === 'neutral'
                ? 'is-neutral'
                : 'is-unavailable';
          return (
            <button
              key={card.key}
              type="button"
              title={card.tooltip}
              aria-label={`${card.label}: ${card.value}. ${card.changeLabel}. ${card.explanation} Open details.`}
              className={`shift-overview-card shift-overview-card--${card.tone} shift-overview-card--interactive`}
              onClick={() => navigate(card.to)}
            >
              <span className="shift-overview-icon grid size-11 shrink-0 place-items-center rounded-full" aria-hidden="true">
                <MaterialIcon name={card.icon} className="text-xl" />
              </span>
              <div className="shift-overview-copy min-w-0">
                <p className="font-body text-label-sm text-on-surface-variant">{card.label}</p>
                <strong className="mt-1 block truncate font-display text-title-md tabular-nums text-on-surface">
                  {overviewLoading && ownerMode
                    ? <span className="shift-overview-skeleton" aria-label="Loading KPI value" />
                    : card.value}
                </strong>
                <div className="shift-overview-trend">
                  <span className={`shift-overview-trend-value ${changeTone}`}>
                    {overviewLoading && ownerMode ? (
                    <span className="shift-overview-skeleton" aria-label="Loading KPI comparison" />
                    ) : card.change.direction === 'unavailable' ? (
                      '----'
                    ) : (
                      <>
                        <span className="shift-overview-trend-arrow" aria-hidden="true">{changeArrow}</span>
                        {card.changeLabel}
                      </>
                    )}
                  </span>
                  <svg
                    className={`shift-overview-sparkline ${card.series.length < 2 ? 'is-empty' : ''}`}
                    viewBox="0 0 64 20"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient id={`shift-overview-gradient-${card.key}`} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
                      </linearGradient>
                    </defs>
                    <path
                      className="shift-overview-sparkline-area"
                      style={{ fill: `url(#shift-overview-gradient-${card.key})` }}
                      d={getSparklineAreaPath(card.series)}
                    />
                    <path d={smoothSparklinePath(getSparklinePath(card.series)) || 'M0,10 L64,10'} />
                  </svg>
                </div>
              </div>
            </button>
          );
        })}
      </section>
{ownerMode && overviewAnalytics && !overviewLoading && !overviewError && (
        <p className="shift-overview-reconciliation">
          Collected payments: Cash {metricAmount(overviewAnalytics.current.cash)} + Cards {metricAmount(overviewAnalytics.current.cards)} + Other {metricAmount(overviewAnalytics.current.other)} = {metricAmount(
            overviewAnalytics.current.cash + overviewAnalytics.current.cards + overviewAnalytics.current.other,
          )}
        </p>
      )}
    </>
  );
}
