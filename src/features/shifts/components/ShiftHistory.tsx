import type { CashMovementRecord, ShiftRecord } from '../../../types/domain';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '../../../components/Button';
import { ListSkeleton } from '../../../components/ListSkeleton';
import { MaterialIcon } from '../../../components/MaterialIcon';
import { StatusTag } from '../../../components/StatusTag';
import { DataTable, type DataTableColumn } from '../../../components/layout';
import { formatTnd } from '../../../lib/format';
import { t } from '../../../i18n/translations';
import { CashMovementList } from './CashMovementList';

type HistoryStatus = 'all' | 'open' | 'closed';

interface ShiftHistoryProps {
  ownerMode: boolean;
  isOwnerUser: boolean;
  loading: boolean;
  error: string;
  filteredHistory: ShiftRecord[];
  staffNames: Record<string, string>;
  cashMovements: CashMovementRecord[];
  historySearch: string;
  setHistorySearch: Dispatch<SetStateAction<string>>;
  historyStatus: HistoryStatus;
  setHistoryStatus: Dispatch<SetStateAction<HistoryStatus>>;
  historyStaff: string;
  setHistoryStaff: Dispatch<SetStateAction<string>>;
  historyDate: string;
  setHistoryDate: Dispatch<SetStateAction<string>>;
  canCashInOut: boolean;
  onOpenMovementHistory: (shift: ShiftRecord) => void;
  onOpenCashMovement: (kind: 'in' | 'out', shiftId: string) => void;
  onRequestForceClose: (shift: ShiftRecord) => void;
}

export function ShiftHistory({
  ownerMode, isOwnerUser, loading, error, filteredHistory, staffNames,
  cashMovements,
  historySearch, setHistorySearch, historyStatus, setHistoryStatus,
  historyStaff, setHistoryStaff, historyDate, setHistoryDate, canCashInOut,
  onOpenMovementHistory, onOpenCashMovement, onRequestForceClose,
}: ShiftHistoryProps) {
  const movementsForShift = (shiftId: string) => cashMovements.filter((movement) => movement.shiftId === shiftId);
  return (
<section id="shift-history" className="shift-history mt-6">
        <h2 className="mb-3 font-display text-headline-md text-on-surface">{ownerMode && <span className="shift-history-mark"><MaterialIcon name="history" /></span>}{t('shift.history')}</h2>
        <div className="shift-history-toolbar mb-3 grid gap-2">
          {!ownerMode && (
            <label className="relative">
              <MaterialIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-outline" />
              <input
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Search staff or date"
                aria-label="Search shift history"
                className="h-11 w-full rounded-lg bg-surface-container-lowest pl-10 pr-3 font-body text-body-md shadow-card outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
          )}
          <div className="shift-status-filters flex items-center gap-1 rounded-xl bg-surface-container-lowest p-1 shadow-card" role="group" aria-label="Filter shift status">
            {([
              ['all', 'All'],
              ['open', 'Open'],
              ['closed', 'Closed'],
            ] as const).map(([status, label]) => (
              <button
                key={status}
                type="button"
                aria-pressed={historyStatus === status}
                onClick={() => setHistoryStatus(status)}
                className={`min-h-9 shrink-0 rounded-lg px-3 font-body text-label-md transition ${
                  historyStatus === status
                    ? 'bg-primary text-on-primary shadow-card'
                    : 'text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="shift-staff-filter">
            <span className="sr-only">Filter by staff</span>
            <select
              value={historyStaff}
              onChange={(event) => setHistoryStaff(event.target.value)}
              aria-label="Filter by staff"
              className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="all">All staff</option>
              {Object.entries(staffNames).map(([staffId, staffName]) => (
                <option key={staffId} value={staffId}>{staffName}</option>
              ))}
            </select>
          </label>
          {ownerMode && (
            <label className="shift-date-filter">
              <span className="sr-only">Filter by date</span>
              <input
                type="date"
                value={historyDate}
                onChange={(event) => setHistoryDate(event.target.value)}
                aria-label="Filter by date"
                className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
          )}
        </div>
        {loading ? <ListSkeleton label="Loading shifts" /> : <DataTable<ShiftRecord>
          rows={filteredHistory}
          getRowKey={(shift) => shift.id}
          columns={[
            { key: 'staff', label: 'Staff', sortValue: (shift) => staffNames[shift.staffId] ?? 'Staff', render: (shift) => staffNames[shift.staffId] ?? 'Staff' },
            { key: 'opened', label: 'Opened', sortValue: (shift) => shift.openedAt, render: (shift) => new Date(shift.openedAt).toLocaleString() },
            { key: 'closed', label: 'Closed', sortValue: (shift) => shift.closedAt ?? '', render: (shift) => shift.closedAt ? new Date(shift.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—' },
            { key: 'duration', label: 'Duration', sortValue: (shift) => new Date(shift.closedAt ?? Date.now()).getTime() - new Date(shift.openedAt).getTime(), render: (shift) => {
              const durationMinutes = Math.max(0, Math.floor((new Date(shift.closedAt ?? Date.now()).getTime() - new Date(shift.openedAt).getTime()) / 60_000));
              return durationMinutes >= 60 ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m` : `${durationMinutes}m`;
            } },
            { key: 'starting', label: 'Starting', sortValue: (shift) => shift.startingCashMillimes, render: (shift) => `${formatTnd(shift.startingCashMillimes / 1000)} DT` },
            { key: 'counted', label: 'Counted', sortValue: (shift) => shift.countedCashMillimes ?? 0, render: (shift) => shift.countedCashMillimes === undefined ? '—' : `${formatTnd(shift.countedCashMillimes / 1000)} DT` },
            { key: 'status', label: 'Status', render: (shift) => (
              <div className="flex flex-col items-start gap-1">
                <StatusTag className="shift-history-status" status={shift.status === 'open' ? 'started' : 'closed'}>{shift.status === 'open' ? 'Open' : 'Closed'}</StatusTag>
                {shift.forceClosedByOwner && <span className="font-body text-label-sm text-warning">Closed by force</span>}
                {(shift.voidsAutoApprovedCount ?? 0) > 0 && <span className="font-body text-label-sm text-warning">Voids auto-approved: {shift.voidsAutoApprovedCount}</span>}
              </div>
            ) },
            { key: 'difference', label: 'Difference', sortValue: (shift) => shift.differenceMillimes ?? 0, render: (shift) => shift.differenceMillimes === undefined ? '—' : `${formatTnd(shift.differenceMillimes / 1000)} DT` },
            { key: 'actions', label: 'Actions', render: (shift) => (
              <button
                type="button"
                className="shift-movements-toggle"
                onClick={() => onOpenMovementHistory(shift)}
              >
                <MaterialIcon name="payments" />
                Cash movements
              </button>
            ) },
          ] satisfies DataTableColumn<ShiftRecord>[]}
          mobileCards={(shift) => (
            <article key={shift.id} className={`shift-history-card shift-history-card--${shift.status === 'open' ? 'open' : 'closed'} flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4`}>
              <div className="shift-history-card__identity">
                <span className="shift-history-card__staff-icon" aria-hidden="true">
                  <MaterialIcon name={shift.status === 'open' ? 'schedule' : 'person'} />
                </span>
                <div className="shift-history-card__identity-copy">
                  <p className="font-body text-label-lg text-on-surface">{staffNames[shift.staffId] ?? 'Staff'}</p>
                  <p className="mt-1 font-body text-body-sm text-outline">
                    {new Date(shift.openedAt).toLocaleString()} {shift.closedAt ? ` • Closed ${new Date(shift.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </p>
                  {shift.forceClosedByOwner && <p className="mt-1 font-body text-label-sm text-warning">Closed by force</p>}
                  {(shift.voidsAutoApprovedCount ?? 0) > 0 && <p className="mt-1 font-body text-label-sm text-warning">Voids auto-approved: {shift.voidsAutoApprovedCount}</p>}
                </div>
              </div>
              <div className="shift-history-card__cash-summary">
                <div>
                  <span>Starting cash</span>
                  <strong>{formatTnd(shift.startingCashMillimes / 1000)} DT</strong>
                </div>
                {shift.countedCashMillimes !== undefined && (
                  <div>
                    <span>Counted cash</span>
                    <strong>{formatTnd(shift.countedCashMillimes / 1000)} DT</strong>
                  </div>
                )}
              </div>
              <div className="shift-history-card__status">
                <StatusTag className="shift-history-status" status={shift.status === 'open' ? 'started' : 'closed'}>{shift.status === 'open' ? 'Started' : 'Closed'}</StatusTag>
                {shift.differenceMillimes !== undefined && <p className={`mt-1 font-body text-label-sm tabular-nums ${shift.differenceMillimes === 0 ? 'text-success-dark' : 'text-error-dark'}`}>{t('shift.difference')}: {formatTnd(shift.differenceMillimes / 1000)} DT</p>}
              </div>
              {ownerMode && canCashInOut && shift.status === 'open' && isOwnerUser && (
                <div className="shift-history-card__cash-actions flex w-full gap-2">
                  <Button type="button" variant="secondary" className="shift-cash-in flex-1" onClick={() => onOpenCashMovement('in', shift.id)}><MaterialIcon name="add" />Cash in</Button>
                  <Button type="button" variant="secondary" className="shift-cash-out flex-1" onClick={() => onOpenCashMovement('out', shift.id)}><MaterialIcon name="remove" />Cash out</Button>
                </div>
              )}
              <CashMovementList
                movements={movementsForShift(shift.id)}
                staffNames={staffNames}
                onShowMore={() => onOpenMovementHistory(shift)}
              />
              {ownerMode && shift.status === 'open' && isOwnerUser && (
                <Button variant="danger" className="shift-history-force-close-button w-full" onClick={() => onRequestForceClose(shift)}>
                  <MaterialIcon name="lock" />Force close shift
                </Button>
              )}
            </article>
          )}
          empty={!loading && !error ? <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{t('common.noData')}</p> : undefined}
        />}
      </section>
  );
}
