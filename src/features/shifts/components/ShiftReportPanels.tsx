import type { Dispatch, SetStateAction } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { ListSkeleton } from '../../../components/ListSkeleton';
import { MaterialIcon } from '../../../components/MaterialIcon';
import { StatusTag } from '../../../components/StatusTag';
import { ReportView } from '../../../components/ReportView';
import { formatTnd } from '../../../lib/format';
import { getReportCloseDate } from '../../../lib/reportArchive';
import type { OrderRecord, ReportRecord, ShiftRecord, StoreRecord } from '../../../types/domain';

interface ShiftReportsProps {
  ownerMode: boolean;
  activeTab: 'shifts' | 'reports' | 'archive';
  reportDisabledReason: string;
  zDisabledReason: string;
  openCount: number;
  pendingVoidOrders: OrderRecord[];
  openShifts: ShiftRecord[];
  staffNames: Record<string, string>;
  createXReport: () => void;
  openZCloseDialog: (forceEverything?: boolean) => void;
  reportPreview: ReportRecord | undefined;
  store: StoreRecord | undefined;
  setReportPreview: Dispatch<SetStateAction<ReportRecord | undefined>>;
}

export function ShiftReports({
  ownerMode, activeTab, reportDisabledReason, zDisabledReason, openCount,
  pendingVoidOrders, openShifts, staffNames, createXReport, openZCloseDialog,
  reportPreview, store, setReportPreview,
}: ShiftReportsProps) {
  return (
    <>
{ownerMode && activeTab === 'reports' && (
        <section className="shift-tab-panel shift-reports-grid grid gap-4 tablet:grid-cols-2">
          <article className="shift-report-card shift-x-card rounded-2xl p-4">
            <div className="shift-report-card__header flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="shift-report-icon grid size-12 shrink-0 place-items-center rounded-2xl">
                  <MaterialIcon name="summarize" className="text-2xl" />
                </span>
                <div className="min-w-0">
                  <p className="font-body text-label-sm text-primary">Live preview</p>
                  <h2 className="font-display text-headline-md text-on-surface">X report</h2>
                </div>
              </div>
              <StatusTag className="shift-report-status" status={reportDisabledReason ? 'closed' : 'started'}>{reportDisabledReason ? 'Unavailable' : 'Live'}</StatusTag>
            </div>
            <p className="mt-3 font-body text-body-sm text-on-surface-variant">A frozen cash snapshot for review. The business day remains open.</p>
            <div className="shift-report-meta mt-4 grid grid-cols-2 gap-2">
              <div><p>Open shifts</p><strong>{openCount}</strong></div>
              <div><p>Pending voids</p><strong>{pendingVoidOrders.length}</strong></div>
            </div>
            {reportDisabledReason && <p className="mt-2 font-body text-body-sm text-outline">{reportDisabledReason}</p>}
            <Button disabled={Boolean(reportDisabledReason)} className="shift-report-action mt-4 w-full" onClick={() => { void createXReport(); }}>
              <MaterialIcon name="summarize" />Print X report
            </Button>
          </article>
          <article className="shift-report-card shift-z-card rounded-2xl p-4">
            <div className="shift-report-card__header flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="shift-report-icon shift-report-icon--danger grid size-12 shrink-0 place-items-center rounded-2xl">
                  <MaterialIcon name="lock" className="text-2xl" />
                </span>
                <div className="min-w-0">
                  <p className="font-body text-label-sm text-warning-dark">Final close</p>
                  <h2 className="font-display text-headline-md text-on-surface">Z report</h2>
                </div>
              </div>
              <StatusTag className="shift-report-status" status={zDisabledReason ? 'closed' : 'started'}>{zDisabledReason ? 'Blocked' : 'Ready'}</StatusTag>
            </div>
            <p className="mt-3 font-body text-body-sm text-on-surface-variant">Requires your owner PIN. All shifts and voids must be resolved first.</p>
            {(openShifts.length > 0 || pendingVoidOrders.length > 0) && (
              <div className="shift-resolution-panel mt-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-label-lg text-on-surface">Before closing</h3>
                  <span className="shift-resolution-count">{openShifts.length + pendingVoidOrders.length}</span>
                </div>
                <div className="mt-2 flex max-h-24 flex-col gap-1.5 overflow-y-auto">
                  {openShifts.map((shift) => (
                    <p key={shift.id} className="shift-resolution-row font-body text-body-sm">
                      <MaterialIcon name="schedule" className="text-base" />
                      <span>Open shift · {staffNames[shift.staffId] ?? 'Staff'}</span>
                    </p>
                  ))}
                  {pendingVoidOrders.map((order) => (
                    <p key={order.id} className="shift-resolution-row font-body text-body-sm">
                      <MaterialIcon name="pending_actions" className="text-base" />
                      <span>Void #{order.number} · {formatTnd(order.totalMillimes / 1000)} DT</span>
                    </p>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Link to="/owner/voids" className="shift-resolution-link flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 font-body text-label-md">
                    <MaterialIcon name="rule" className="text-lg" />
                    Review voids
                  </Link>
                  <Button variant="danger" className="shift-force-button min-h-11" onClick={() => { void openZCloseDialog(true); }}>
                    Force close everything
                  </Button>
                </div>
              </div>
            )}
            <Button disabled={Boolean(zDisabledReason)} variant="danger" className="shift-report-action shift-z-action mt-4 w-full" onClick={() => { void openZCloseDialog(); }}>
              <MaterialIcon name="lock" />Close day: Z report
            </Button>
          </article>
          {reportPreview && <div className="tablet:col-span-2"><ReportView inline report={reportPreview} store={store ?? undefined} settings={store?.settings} storeName={store?.name ?? ''} onClose={() => setReportPreview(undefined)} /></div>}
        </section>
      )}
    </>
  );
}

interface ShiftArchiveProps {
  ownerMode: boolean;
  activeTab: 'shifts' | 'reports' | 'archive';
  archiveReports: ReportRecord[];
  archiveDate: string;
  reportTimeZone: string;
  archiveSort: 'newest' | 'oldest' | 'amount-desc' | 'amount-asc';
  setArchiveSort: Dispatch<SetStateAction<'newest' | 'oldest' | 'amount-desc' | 'amount-asc'>>;
  reportPreview: ReportRecord | undefined;
  archivePreviewDismissed: boolean;
  loading: boolean;
  todayOverviewDate: string;
  previewZoom: number;
  setPreviewZoom: Dispatch<SetStateAction<number>>;
  store: StoreRecord | undefined;
  setArchiveDateOverride: Dispatch<SetStateAction<string | undefined>>;
  setReportPreview: Dispatch<SetStateAction<ReportRecord | undefined>>;
  setArchivePreviewDismissed: Dispatch<SetStateAction<boolean>>;
}

export function ShiftArchive({
  ownerMode, activeTab, archiveReports, archiveDate, reportTimeZone, archiveSort,
  setArchiveSort, reportPreview, archivePreviewDismissed, loading, todayOverviewDate,
  previewZoom, setPreviewZoom, store, setArchiveDateOverride, setReportPreview,
  setArchivePreviewDismissed,
}: ShiftArchiveProps) {
  const zReports = archiveReports.filter((report) => report.type === 'Z');
  const filteredArchiveReports = zReports.filter((report) =>
    getReportCloseDate(report, reportTimeZone) === archiveDate).sort((left, right) => {
    if (archiveSort === 'oldest') return left.createdAt.localeCompare(right.createdAt);
    if (archiveSort === 'amount-desc' || archiveSort === 'amount-asc') {
      const leftAmount = left.salesCollectedMillimes ?? left.salesMillimes;
      const rightAmount = right.salesCollectedMillimes ?? right.salesMillimes;
      return archiveSort === 'amount-desc' ? rightAmount - leftAmount : leftAmount - rightAmount;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });

  const isArchivePreview = reportPreview?.type === 'Z' &&
    getReportCloseDate(reportPreview, reportTimeZone) === archiveDate
    ? reportPreview
    : archivePreviewDismissed
      ? undefined
      : filteredArchiveReports[0];
  return (
    <>
{ownerMode && activeTab === 'archive' && (
        <section className="shift-tab-panel shift-archive-page">
          <div className="shift-archive-toolbar-panel shift-archive-toolbar-panel--date-only">
            <div className="shift-archive-date-filter">
              <label htmlFor="shift-archive-date">
                <MaterialIcon name="calendar_month" />
                <span>Closed date</span>
              </label>
              <input
                id="shift-archive-date"
                type="date"
                value={archiveDate}
                aria-label="Filter Z reports by close date"
                onChange={(event) => {
                  const nextDate = event.currentTarget.value;
                  if (!nextDate) return;
                  setArchiveDateOverride(nextDate);
                  setReportPreview(undefined);
                  setArchivePreviewDismissed(false);
                }}
              />
              <span className="shift-archive-date-count">
                {filteredArchiveReports.length} Z {filteredArchiveReports.length === 1 ? 'report' : 'reports'}
              </span>
            </div>
          </div>
          <div className="shift-archive-layout">
            <div className="shift-archive-card rounded-2xl p-4">
              <div className="shift-archive-card-heading">
                <h2 className="font-display text-headline-md text-on-surface">
                  <MaterialIcon name="description" />
                  Reports History
                </h2>
                <label className="shift-sort-control">
                  <span>Sort by:</span>
                  <select
                    value={archiveSort}
                    onChange={(event) => setArchiveSort(event.target.value as typeof archiveSort)}
                    aria-label="Sort reports"
                  >
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="amount-desc">Amount: high to low</option>
                    <option value="amount-asc">Amount: low to high</option>
                  </select>
                </label>
              </div>
            {loading ? <ListSkeleton label="Loading daily reports" /> : (
              <div className="shift-archive-list flex flex-col gap-2">
                {filteredArchiveReports.map((report) => {
                  const selected = isArchivePreview?.id === report.id;
                  const closedDate = getReportCloseDate(report, reportTimeZone);
                  const reportDateLabel = closedDate === todayOverviewDate
                    ? 'Today'
                    : closedDate;
                  const reportTime = new Date(report.createdAt).toLocaleTimeString([], {
                    timeZone: reportTimeZone,
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  });
                  return (
                    <button
                      key={report.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => { setReportPreview(report); setArchivePreviewDismissed(false); }}
                      className={`shift-archive-row flex items-start justify-between gap-3 rounded-xl p-3 text-left ${selected ? 'shift-archive-row--selected' : ''}`}
                    >
                      <span className="shift-archive-row-icon">
                        <MaterialIcon name="description" />
                      </span>
                      <span className="shift-archive-row-copy">
                        <strong className="text-on-surface">{report.reportNumber ?? `Z-${String(report.zNumber ?? 0).padStart(6, '0')}`}</strong>
                        <span className="font-body text-body-sm text-on-surface-variant">
                          {reportDateLabel} · {reportTime} · Business date {report.businessDate}
                        </span>
                      </span>
                      <span className="shift-archive-row-summary">
                        <strong>{formatTnd((report.salesCollectedMillimes ?? report.salesMillimes) / 1000)} DT</strong>
                        <StatusTag className="shift-archive-status" status={report.pinVerified === false ? 'pending' : 'started'}>
                          {report.pinVerified === false ? 'PIN unavailable' : 'Verified'}
                        </StatusTag>
                      </span>
                      <MaterialIcon name="chevron_right" className="shift-archive-row-chevron" />
                    </button>
                  );
                })}
                {filteredArchiveReports.length === 0 && (
                  <div className="shift-archive-empty">
                    <MaterialIcon name="event_busy" className="text-2xl text-outline" />
                    <p className="font-body text-body-sm text-on-surface-variant">No Z reports found closed on this date.</p>
                  </div>
                )}
              </div>
            )}
          </div>
          {isArchivePreview ? (
            <div className="shift-archive-preview">
              <ReportView inline report={isArchivePreview} store={store ?? undefined} settings={store?.settings} storeName={store?.name ?? ''} previewZoom={previewZoom} onClose={() => { setReportPreview(undefined); setArchivePreviewDismissed(true); }} />
              <div className="shift-preview-zoom" role="group" aria-label="Report preview zoom">
                <button type="button" aria-label="Zoom out" disabled={previewZoom <= 70} onClick={() => setPreviewZoom((zoom) => Math.max(70, zoom - 10))}>−</button>
                <span>{previewZoom}%</span>
                <button type="button" aria-label="Zoom in" disabled={previewZoom >= 150} onClick={() => setPreviewZoom((zoom) => Math.min(150, zoom + 10))}>+</button>
              </div>
            </div>
          ) : (
            <div className="shift-archive-preview shift-archive-preview--empty">
              <MaterialIcon name="description" className="text-3xl text-outline" />
              <p className="font-body text-body-sm text-on-surface-variant">Select a Z report to preview it.</p>
            </div>
          )}
          </div>
        </section>
      )}
    </>
  );
}
