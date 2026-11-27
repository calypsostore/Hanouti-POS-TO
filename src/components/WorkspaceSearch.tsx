import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ownerWorkspaceLinks } from '../app/navigation';
import { t } from '../i18n/translations';
import { catalogService } from '../services/catalogService';
import { customerService } from '../services/customerService';
import { expenseService } from '../services/expenseService';
import { orderService } from '../services/orderService';
import { reportService } from '../services/reportService';
import { scheduleService } from '../services/scheduleService';
import { shiftService } from '../services/shiftService';
import { supplierService } from '../services/supplierService';
import { userService } from '../services/userService';
import { findMatches, normalizeSearchText } from '../lib/workspaceSearch';
import type { GlobalSearchResult } from '../types/workspaceSearch';
import { MaterialIcon } from './MaterialIcon';
import { localizeErrorMessage } from '../i18n';

function pageSearchResults(): GlobalSearchResult[] {
  return ownerWorkspaceLinks.map((link) => ({
    id: `page:${link.to}`,
    title: t(link.label),
    detail: t('search.openPage'),
    group: t('search.pages'),
    href: link.to === '/owner/shifts' ? '/owner/shifts?tab=shifts' : link.to,
    icon: link.icon,
    searchText: normalizeSearchText(`${t(link.label)} ${link.to}`),
  }));
}

async function loadStoreSearchResults(storeId: string): Promise<GlobalSearchResult[]> {
  const [
    categories,
    items,
    customers,
    orders,
    users,
    suppliers,
    expenses,
    shifts,
    reports,
    scheduledShifts,
  ] = await Promise.all([
    catalogService.listCategories(storeId, true),
    catalogService.listItems(storeId, undefined, '', true),
    customerService.listCustomers(storeId),
    orderService.listAll(storeId),
    userService.listUsers(storeId),
    supplierService.list(storeId),
    expenseService.list(storeId),
    shiftService.listShifts(storeId),
    reportService.listReports(storeId),
    scheduleService.listForStore(storeId),
  ]);
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const usersById = new Map(users.map((user) => [user.id, user]));
  const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

  return [
    ...items.map((item) => {
      const categoryName = categoryNames.get(item.categoryId) ?? '';
      const productQuery = new URLSearchParams({
        search: item.name,
        state: item.isActive ? 'active' : 'archived',
      });
      return {
        id: `product:${item.id}`,
        title: item.name,
        detail: [item.sku, categoryName].filter(Boolean).join(' · ') || t('search.product'),
        group: t('search.products'),
        href: `/owner/catalog?${productQuery.toString()}`,
        icon: 'inventory_2',
        searchText: normalizeSearchText(`${item.name} ${item.sku ?? ''} ${item.description ?? ''} ${categoryName}`),
      };
    }),
    ...customers.map((customer) => ({
      id: `customer:${customer.id}`,
      title: customer.name,
      detail: customer.phone ?? customer.email ?? t('search.customer'),
      group: t('search.customers'),
      href: `/customers/${customer.id}`,
      icon: 'person',
      searchText: normalizeSearchText(`${customer.name} ${customer.phone ?? ''} ${customer.email ?? ''} ${customer.notes ?? ''}`),
    })),
    ...orders.map((order) => {
      const businessDate = order.businessDate ?? order.createdAt.slice(0, 10);
      const orderQuery = new URLSearchParams({ businessDate, search: String(order.number) });
      const customer = order.customerId ? customers.find((entry) => entry.id === order.customerId) : undefined;
      const productNames = order.items.map((item) => item.name).join(' ');
      return {
        id: `order:${order.id}`,
        title: `#${order.number}`,
        detail: [order.staffName, customer?.name, businessDate].filter(Boolean).join(' · ') || t('search.order'),
        group: t('search.orders'),
        href: `/orders?${orderQuery.toString()}`,
        icon: 'receipt_long',
        searchText: normalizeSearchText(`${order.number} ${order.status} ${order.paymentMethod} ${order.staffName ?? ''} ${customer?.name ?? ''} ${order.note ?? ''} ${productNames}`),
      };
    }),
    ...users.filter((user) => user.role === 'staff').map((user) => ({
      id: `staff:${user.id}`,
      title: user.name,
      detail: user.username ?? user.email ?? t('search.staffMember'),
      group: t('search.staff'),
      href: `/owner/staff/${user.id}`,
      icon: 'groups',
      searchText: normalizeSearchText(`${user.name} ${user.username ?? ''} ${user.email ?? ''} ${user.phone ?? ''}`),
    })),
    ...suppliers.map((supplier) => ({
      id: `supplier:${supplier.id}`,
      title: supplier.name,
      detail: supplier.phone ?? t('search.supplier'),
      group: t('search.suppliers'),
      href: `/owner/suppliers?supplierId=${encodeURIComponent(supplier.id)}`,
      icon: 'local_shipping',
      searchText: normalizeSearchText(`${supplier.name} ${supplier.phone ?? ''} ${supplier.notes ?? ''}`),
    })),
    ...expenses.map((expense) => {
      const supplierName = expense.supplierId ? suppliersById.get(expense.supplierId)?.name : undefined;
      return {
        id: `expense:${expense.id}`,
        title: expense.note || t('search.expense'),
        detail: [expense.date, expense.category, supplierName].filter(Boolean).join(' · '),
        group: t('search.expenses'),
        href: `/owner/expenses?${new URLSearchParams({
          month: expense.date.slice(0, 7),
          expenseId: expense.id,
        }).toString()}`,
        icon: 'request_quote',
        searchText: normalizeSearchText(`${expense.note ?? ''} ${expense.category} ${expense.date} ${supplierName ?? ''} ${expense.amountMillimes}`),
      };
    }),
    ...shifts.map((shift) => {
      const staffName = usersById.get(shift.staffId)?.name ?? '';
      const date = shift.openedAt.slice(0, 10);
      const shiftQuery = new URLSearchParams({ tab: 'shifts', search: staffName || date, date });
      return {
        id: `shift:${shift.id}`,
        title: staffName || t('search.shift'),
        detail: `${date} · ${shift.status}`,
        group: t('search.shifts'),
        href: `/owner/shifts?${shiftQuery.toString()}`,
        icon: 'payments',
        searchText: normalizeSearchText(`${staffName} ${date} ${shift.status}`),
      };
    }),
    ...reports.map((report) => ({
      id: `report:${report.id}`,
      title: `${report.type} ${t('search.report')}`,
      detail: report.reportNumber ? `${report.reportNumber} · ${report.businessDate}` : report.businessDate,
      group: t('search.reports'),
      href: `/owner/reports?reportId=${encodeURIComponent(report.id)}`,
      icon: 'analytics',
      searchText: normalizeSearchText(`${report.type} ${report.reportNumber ?? ''} ${report.businessDate} ${report.generatedBy ?? ''}`),
    })),
    ...scheduledShifts.map((shift) => {
      const staffName = usersById.get(shift.staffId)?.name ?? '';
      return {
        id: `schedule:${shift.id}`,
        title: staffName || t('search.scheduledShift'),
        detail: `${shift.date} · ${shift.startTime}–${shift.endTime}`,
        group: t('search.schedule'),
        href: `/owner/schedule?date=${encodeURIComponent(shift.date)}`,
        icon: 'calendar_month',
        searchText: normalizeSearchText(`${staffName} ${shift.date} ${shift.startTime} ${shift.endTime} ${shift.note ?? ''}`),
      };
    }),
  ];
}

interface WorkspaceSearchProps {
  storeId: string;
}

export function WorkspaceSearch({ storeId }: WorkspaceSearchProps) {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const loadStartedRef = useRef(false);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [storeResults, setStoreResults] = useState<GlobalSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const pages = useMemo(() => pageSearchResults(), []);
  const results = useMemo(
    () => findMatches([...pages, ...storeResults], query),
    [pages, query, storeResults],
  );

  const loadStoreIndex = useCallback(() => {
    if (!storeId || loadStartedRef.current) return;
    loadStartedRef.current = true;
    setIsLoading(true);
    setLoadError('');
    void loadStoreSearchResults(storeId)
      .then(setStoreResults)
      .catch((error: unknown) => {
        console.error('Unable to search store records.', error);
        setLoadError(localizeErrorMessage(error, t('common.loadFailed')));
      })
      .finally(() => setIsLoading(false));
  }, [storeId]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setIsOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => setActiveIndex(0), [query]);

  const selectResult = useCallback((result: GlobalSearchResult) => {
    navigate(result.href);
    setIsOpen(false);
    setQuery('');
  }, [navigate]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter' && isOpen && results[activeIndex]) {
      event.preventDefault();
      selectResult(results[activeIndex]);
    }
  };

  const retrySearch = () => {
    loadStartedRef.current = false;
    loadStoreIndex();
  };

  return (
    <div className="shift-topbar-search workspace-search" ref={rootRef}>
      <MaterialIcon name="search" className="shift-topbar-search__icon" />
      <input
        className="shift-topbar-search__input"
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
          if (event.target.value.trim()) loadStoreIndex();
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={t('search.globalPlaceholder')}
        aria-label={t('search.globalLabel')}
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls="workspace-search-results"
        aria-activedescendant={results[activeIndex] ? `workspace-search-result-${activeIndex}` : undefined}
        autoComplete="off"
      />
      {isOpen && (
        <div className="workspace-search__results" id="workspace-search-results" role="listbox">
          {!query.trim() ? (
            <p className="workspace-search__message">{t('search.typeToSearch')}</p>
          ) : (
            <>
              {isLoading && <p className="workspace-search__message">{t('search.loading')}</p>}
              {loadError && (
                <div className="workspace-search__error" role="alert">
                  <span>{loadError}</span>
                  <button type="button" onClick={retrySearch}>{t('search.retry')}</button>
                </div>
              )}
              {results.map((result, index) => (
                <button
                  type="button"
                  className={`workspace-search__option${index === activeIndex ? ' is-active' : ''}`}
                  id={`workspace-search-result-${index}`}
                  key={result.id}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectResult(result)}
                >
                  <MaterialIcon name={result.icon} className="workspace-search__option-icon" />
                  <span className="workspace-search__option-copy">
                    <strong>{result.title}</strong>
                    <small>{result.group}{result.detail ? ` · ${result.detail}` : ''}</small>
                  </span>
                </button>
              ))}
              {!isLoading && !loadError && results.length === 0 && (
                <p className="workspace-search__message">{t('search.noResults')}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
