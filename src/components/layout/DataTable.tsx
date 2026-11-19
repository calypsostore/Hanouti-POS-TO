import { useMemo, useState, type ReactNode } from 'react';

export interface DataTableColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  className?: string;
}

interface DataTableProps<T> {
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowKey: (row: T) => string;
  mobileCards: (row: T) => ReactNode;
  empty?: ReactNode;
  rowClassName?: (row: T) => string;
}

export function DataTable<T>({ rows, columns, getRowKey, mobileCards, empty, rowClassName }: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState('');
  const [descending, setDescending] = useState(false);
  const sortedRows = useMemo(() => {
    const column = columns.find((candidate) => candidate.key === sortKey && candidate.sortValue);
    if (!column?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      const result = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), undefined, { numeric: true });
      return descending ? -result : result;
    });
  }, [columns, descending, rows, sortKey]);

  if (!rows.length && empty) return <>{empty}</>;
  return (
    <>
      <div className="data-table-mobile flex flex-col gap-3 lg:hidden">
        {sortedRows.map((row) => <div key={getRowKey(row)}>{mobileCards(row)}</div>)}
      </div>
      <div className="data-table-desktop hidden overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest lg:block">
        <table className="w-full border-separate border-spacing-0 text-left font-body text-body-sm">
          <thead className="sticky top-0 z-10 bg-surface-container-high">
            <tr>{columns.map((column) => (
              <th key={column.key} scope="col" className={`h-11 whitespace-nowrap px-3 font-semibold text-on-surface-variant ${column.className ?? ''}`}>
                {column.sortValue ? (
                  <button
                    type="button"
                    className="inline-flex min-h-9 items-center gap-1 text-left hover:text-primary"
                    aria-label={`Sort by ${column.label}${sortKey === column.key ? (descending ? ', descending' : ', ascending') : ''}`}
                    onClick={() => {
                      if (sortKey === column.key) setDescending((value) => !value);
                      else { setSortKey(column.key); setDescending(false); }
                    }}
                  >
                    {column.label}<span aria-hidden="true">{sortKey === column.key ? (descending ? '↓' : '↑') : '↕'}</span>
                  </button>
                ) : column.label}
              </th>
            ))}</tr>
          </thead>
          <tbody>{sortedRows.map((row) => (
            <tr key={getRowKey(row)} className={`h-11 border-t border-outline-variant hover:bg-surface-container-low ${rowClassName?.(row) ?? ''}`}>
              {columns.map((column) => <td key={column.key} className={`border-t border-outline-variant px-3 py-2 align-middle ${column.className ?? ''}`}>{column.render(row)}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
