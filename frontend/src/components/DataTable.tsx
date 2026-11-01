import { useMemo, useState } from 'react';

export interface ColumnDef<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  filterable?: boolean;
  /** Text used for the built-in substring filter; defaults to render() if it returns a string. */
  filterValue?: (row: T) => string;
  width?: string;
}

export interface BulkAction<T> {
  label: string;
  onRun: (rows: T[]) => void;
  tone?: 'default' | 'danger';
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  pageSize?: number;
  bulkActions?: BulkAction<T>[];
  emptyMessage?: string;
  toolbar?: React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  pageSize = 20,
  bulkActions,
  emptyMessage = 'Nenhum registro encontrado.',
  toolbar,
}: DataTableProps<T>) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const activeFilters = Object.entries(filters).filter(([, v]) => v.trim() !== '');
    if (activeFilters.length === 0) return rows;
    return rows.filter((row) =>
      activeFilters.every(([key, value]) => {
        const col = columns.find((c) => c.key === key);
        if (!col) return true;
        const text = col.filterValue ? col.filterValue(row) : String(col.render(row) ?? '');
        return text.toLowerCase().includes(value.toLowerCase());
      }),
    );
  }, [rows, filters, columns]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const filterableColumns = columns.filter((c) => c.filterable);

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllOnPage = () => {
    const pageIds = pageRows.map(rowKey);
    const allSelected = pageIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const selectedRows = rows.filter((row) => selected.has(rowKey(row)));

  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
      {(filterableColumns.length > 0 || toolbar || bulkActions) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            padding: '8px 12px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {filterableColumns.map((col) => (
            <input
              key={col.key}
              placeholder={`Filtrar ${col.header.toLowerCase()}...`}
              value={filters[col.key] ?? ''}
              onChange={(e) => {
                setFilters((f) => ({ ...f, [col.key]: e.target.value }));
                setPage(1);
              }}
              style={{ fontSize: 11, width: 150 }}
            />
          ))}
          <div style={{ flex: 1 }} />
          {toolbar}
          {bulkActions && selectedRows.length > 0 && (
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                {selectedRows.length} selecionado(s)
              </span>
              {bulkActions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => action.onRun(selectedRows)}
                  style={{
                    fontSize: 11,
                    height: 24,
                    padding: '0 10px',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                    background: action.tone === 'danger' ? 'var(--danger-soft)' : 'var(--accent-soft)',
                    color: action.tone === 'danger' ? 'var(--danger)' : 'var(--accent)',
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--table-head)' }}>
              {bulkActions && (
                <th style={{ width: 28, padding: '6px 10px' }}>
                  <input
                    type="checkbox"
                    checked={pageRows.length > 0 && pageRows.every((r) => selected.has(rowKey(r)))}
                    onChange={toggleAllOnPage}
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    textAlign: 'left',
                    padding: '6px 12px',
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: 0.3,
                    color: 'var(--text-muted)',
                    width: col.width,
                  }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (bulkActions ? 1 : 0)}
                  style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
            {pageRows.map((row) => {
              const id = rowKey(row);
              return (
                <tr
                  key={id}
                  style={{ borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {bulkActions && (
                    <td style={{ padding: '5px 10px' }}>
                      <input type="checkbox" checked={selected.has(id)} onChange={() => toggleRow(id)} />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} style={{ padding: '5px 12px', fontSize: 12 }}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 12px',
          fontSize: 11,
          color: 'var(--text-muted)',
        }}
      >
        <span>
          {filtered.length} registro(s) · página {currentPage} de {totalPages}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => p - 1)}
            style={{ border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 'var(--radius)', height: 24, padding: '0 10px' }}
          >
            Anterior
          </button>
          <button
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            style={{ border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 'var(--radius)', height: 24, padding: '0 10px' }}
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}

export function StatusBadge({ label, tone }: { label: string; tone: 'default' | 'success' | 'warning' | 'danger' }) {
  const colors: Record<string, [string, string]> = {
    default: ['var(--accent)', 'var(--accent-soft)'],
    success: ['var(--success)', 'var(--success-soft)'],
    warning: ['var(--warning)', 'var(--warning-soft)'],
    danger: ['var(--danger)', 'var(--danger-soft)'],
  };
  const [color, bg] = colors[tone];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 9px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        color,
        background: bg,
      }}
    >
      {label}
    </span>
  );
}
