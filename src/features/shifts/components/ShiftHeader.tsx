import { Link } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { FirstRunHint } from '../../../components/FirstRunHint';
import { MaterialIcon } from '../../../components/MaterialIcon';
import { StatusTag } from '../../../components/StatusTag';
import { PageHeader } from '../../../components/layout';
import { ShiftNotificationsButton } from '../../../components/ShiftNotificationsButton';
import { WorkspaceSearch } from '../../../components/WorkspaceSearch';
import type { ShiftRecord, StoreRecord } from '../../../types/domain';
import { t } from '../../../i18n/translations';

interface ShiftHeaderProps {
  ownerMode: boolean;
  storeId: string;
  store: StoreRecord | undefined;
  pageTitle: string;
  ownOpenShift: ShiftRecord | undefined;
  canOpenCloseShift: boolean;
  mayOpenShift: boolean;
  openCount: number;
  openStartingCashSheet: () => void;
  openCountedCashSheet: () => void;
  dayStatusMessage: string;
  dayIsClosed: boolean;
  error: string;
  notice: string;
  activeTab: 'shifts' | 'reports' | 'archive';
  changeActiveTab: (tab: 'shifts' | 'reports' | 'archive') => void;
  userId: string | undefined;
}

export function ShiftHeader({
  ownerMode, storeId, store, pageTitle, ownOpenShift, canOpenCloseShift, mayOpenShift,
  openCount, openStartingCashSheet, openCountedCashSheet, dayStatusMessage,
  dayIsClosed, error, notice, activeTab, changeActiveTab, userId,
}: ShiftHeaderProps) {
  return (
    <>
{ownerMode && (
        <div className="shift-topbar shift-topbar--search">
          <Link to="/owner/dashboard" className="shift-topbar-brand" aria-label="Go to 7anouti-POS dashboard">
            <span className="shift-topbar-logo" aria-hidden="true">
              <img src="/logo1.png" alt="" />
            </span>
            <span className="shift-topbar-brand-copy">
              <strong>7anouti-POS</strong>
              <span>Smart Business</span>
            </span>
          </Link>
          <WorkspaceSearch key={storeId} storeId={storeId} />
          <div className="shift-topbar-actions">
            <ShiftNotificationsButton />
          </div>
        </div>
      )}
      {!ownerMode && <div className="mb-4 flex items-center justify-between gap-3 lg:hidden">
        <div>
          <h1 className="font-display text-headline-lg text-on-surface">{pageTitle}</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">{store?.name}</p>
        </div>
        {ownerMode && !ownOpenShift
          ? <Button className="shift-open-button" onClick={openStartingCashSheet}><MaterialIcon name="lock_open" />Open my shift</Button>
          : ownerMode
            ? <StatusTag status="started">{`${openCount} open`}</StatusTag>
            : canOpenCloseShift && !ownOpenShift && mayOpenShift
              ? <Button className="shift-open-button" onClick={openStartingCashSheet}><MaterialIcon name="lock_open" />{t('shift.openShift')}</Button>
              : null}
      </div>}
      {ownerMode ? (
        <header className="shift-apple-header items-center justify-between gap-4">
          <div className="shift-owner-header-info">
            <span className="shift-header-mark grid size-12 shrink-0 place-items-center rounded-2xl">
              <MaterialIcon name="payments" className="text-2xl" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate font-display text-headline-md text-on-surface">Shift Management</h1>
              <p className="mt-0.5 truncate font-body text-body-sm text-on-surface-variant">Manage your shifts and view daily reports</p>
            </div>
            <span className="shift-location-chip">
              <MaterialIcon name="location_on" />
              <span>{store?.address || store?.name || 'Your store'}</span>
              <MaterialIcon name="expand_more" />
            </span>
          </div>
          <div className="shift-owner-header-actions">
            {ownOpenShift ? (
              <>
                <span className="shift-open-status" aria-label={`Shift open since ${new Date(ownOpenShift.openedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}>
                  <span className="shift-open-status__dot" aria-hidden="true" />
                  <span className="shift-open-status__copy">
                    <strong>Shift Open</strong>
                    <small>Since {new Date(ownOpenShift.openedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</small>
                  </span>
                </span>
                {canOpenCloseShift && (
                  <Button className="shift-open-button" onClick={openCountedCashSheet}>
                    <MaterialIcon name="crop_square" />Close Shift
                  </Button>
                )}
              </>
            ) : (
              <StatusTag status="closed">No shift open</StatusTag>
            )}
            {!ownOpenShift && (
              <Button className="shift-open-button" onClick={openStartingCashSheet}>
                <MaterialIcon name="lock_open" />Open Shift
              </Button>
            )}
          </div>
        </header>
      ) : (
        <PageHeader className="hidden lg:flex" title={pageTitle} subtitle={store?.name} actions={
          canOpenCloseShift && !ownOpenShift && mayOpenShift
            ? <Button className="shift-open-button w-full lg:w-auto lg:min-w-[160px]" onClick={openStartingCashSheet}><MaterialIcon name="lock_open" />{t('shift.openShift')}</Button>
            : undefined
        } />
      )}
      {(ownerMode || (dayIsClosed && !ownOpenShift)) && (
        <p role="status" className={`shift-day-status mb-4 rounded-xl p-3 font-body text-body-sm ${dayIsClosed ? 'shift-day-status--warning' : ''}`}>
          {dayStatusMessage}
        </p>
      )}
      {(error || notice) && (
        <p role={error ? 'alert' : 'status'} className={`mb-3 rounded-xl p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>
          {error || notice}
        </p>
      )}
      {ownerMode && (
        <nav className="shift-section-tabs mb-4 grid grid-cols-3 gap-1 p-1" aria-label="Shift and report sections">
          <span
            className={`shift-section-indicator shift-section-indicator--${activeTab}`}
            aria-hidden="true"
          />
          {([
            ['shifts', 'Shift', 'schedule'],
            ['reports', 'Z Reports', 'analytics'],
            ['archive', 'Daily Reports', 'description'],
          ] as const).map(([tab, label, icon]) => (
            <Button
              key={tab}
              variant="ghost"
              className={`shift-section-tab-button${activeTab === tab ? ' is-active' : ''}`}
              aria-pressed={activeTab === tab}
              onClick={() => changeActiveTab(tab)}
            >
              <MaterialIcon name={icon} className="text-lg" />
              {label}
            </Button>
          ))}
        </nav>
      )}
      {(!ownerMode || activeTab !== 'archive') && (
        <FirstRunHint id={`shift-${userId ?? 'guest'}`} title={t('hint.title')} message={t('hint.shift')} />
      )}
    </>
  );
}
