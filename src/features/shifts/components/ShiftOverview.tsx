import { useNavigate } from 'react-router-dom';
import type { Dispatch, SetStateAction } from 'react';
import { MaterialIcon } from '../../../components/MaterialIcon';
import { formatTnd } from '../../../lib/format';
import { t } from '../../../i18n/translations';
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
      label: t('shift.totalSales'),
      icon: 'shopping_cart',
      tone: 'cyan',
      explanation: t('shift.totalSalesExplanation'),
    },
    {
      key: 'transactions',
      label: t('shift.transactions'),
      icon: 'receipt_long',
      tone: 'blue',
      explanation: t('shift.transactionsExplanation'),
    },
    {
      key: 'cash',
      label: t('shift.cash'),
      icon: 'payments',
      tone: 'green',
      explanation: t('shift.cashExplanation'),
    },
    {
      key: 'cards',
      label: t('shift.cards'),
      icon: 'credit_card',
      tone: 'purple',
      explanation: t('shift.cardsExplanation'),
    },
    {
      key: 'expenses',
      label: t('shift.expenses'),
      icon: 'work',
      tone: 'orange',
      explanation: t('shift.expensesExplanation'),
    },
    {
      key: 'netSales',
      label: t('shift.netSales'),
      icon: 'trending_up',
      tone: 'cyan',
      explanation: t('shift.netSalesExplanation'),
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
      ? t('shift.insufficientHistory')
      : change.direction === 'new'
        ? t('shift.new')
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
        ? overviewLoading ? t('shift.loading') : '—'
        : metric.key === 'transactions' ? String(currentValue) : metricAmount(currentValue),
      change,
      changeLabel,
      series,
      to,
      tooltip: t('shift.comparedWithPeriod', {
        explanation: metric.explanation,
        from: overviewRange?.previousFrom ?? t('shift.previousPeriod'),
        to: overviewRange?.previousTo ?? t('shift.previousPeriod'),
      }),
    };
  });
  const shiftOverviewMetrics = ownerMode ? summaryMetrics : [
    { label: t('shift.openShifts'), value: String(openCount), icon: 'schedule', tone: 'primary' },
    { label: t('shift.transactions'), value: String(liveShiftTotals.transactions), icon: 'receipt_long', tone: 'cyan' },
    { label: t('shift.cashSales'), value: metricAmount(liveShiftTotals.cash), icon: 'payments', tone: 'green' },
    { label: t('shift.cardSales'), value: metricAmount(liveShiftTotals.cards), icon: 'credit_card', tone: 'blue' },
    { label: t('shift.pendingVoids'), value: String(pendingVoidOrders.length), icon: 'pending_actions', tone: 'orange' },
  ];

  return (
    <>
{ownerMode && (
        <div className="shift-overview-toolbar" aria-label={t('shift.overviewKpiAria')}>
          <div className="shift-overview-periods" role="group" aria-label={t('shift.overviewRangeAria')}>
            {([
              ['today', 'shift.today'],
              ['yesterday', 'shift.yesterday'],
              ['last7', 'shift.last7'],
              ['last30', 'shift.last30'],
              ['month', 'shift.thisMonth'],
              ['custom', 'shift.custom'],
            ] as const).map(([filter, labelKey]) => (
              <button
                key={filter}
                type="button"
                aria-pressed={overviewFilter === filter}
                onClick={() => setOverviewFilter(filter)}
                className={`shift-overview-period${overviewFilter === filter ? ' is-active' : ''}`}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
          {overviewFilter === 'custom' && (
            <div className="shift-overview-custom-range">
              <label>
                {t('shift.from')}
                <input
                  type="date"
                  value={customOverviewFrom}
                  max={customOverviewTo}
                  onChange={(event) => setCustomOverviewFrom(event.target.value)}
                />
              </label>
              <label>
                {t('shift.to')}
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
          <button type="button" onClick={() => setOverviewRetry((retry) => retry + 1)}>{t('shift.retry')}</button>
        </div>
      )}
<section className="shift-overview-grid mb-4" aria-label={t('shift.overviewAria')} aria-busy={ownerMode && overviewLoading}>
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
              aria-label={t('shift.metricDetailsAria', { label: card.label, value: card.value, change: card.changeLabel, explanation: card.explanation, action: t('shift.openDetails') })}
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
                    ? <span className="shift-overview-skeleton" aria-label={t('shift.loadingKpi')} />
                    : card.value}
                </strong>
                <div className="shift-overview-trend">
                  <span className={`shift-overview-trend-value ${changeTone}`}>
                    {overviewLoading && ownerMode ? (
                    <span className="shift-overview-skeleton" aria-label={t('shift.loadingComparison')} />
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
          {t('shift.collectedPayments', {
            cash: metricAmount(overviewAnalytics.current.cash),
            cards: metricAmount(overviewAnalytics.current.cards),
            other: metricAmount(overviewAnalytics.current.other),
            total: metricAmount(overviewAnalytics.current.cash + overviewAnalytics.current.cards + overviewAnalytics.current.other),
          })}
        </p>
      )}
    </>
  );
}
