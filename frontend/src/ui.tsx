import { useEffect, useState, type ReactNode } from 'react';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: T };

/** Carrega dados sempre que `deps` mudam; ignora respostas de consultas antigas. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): [Load<T>, () => void] {
  const [s, setS] = useState<Load<T>>({ state: 'loading' });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setS((p) => (p.state === 'ready' ? p : { state: 'loading' }));
    fn().then((data) => live && setS({ state: 'ready', data })).catch((e: Error) => live && setS({ state: 'error', message: e.message || 'Não foi possível carregar.' }));
    return () => { live = false; };
  }, [...deps, n]); // eslint-disable-line react-hooks/exhaustive-deps
  return [s, () => setN((x) => x + 1)];
}

export interface Column<R> { key: string; header: string; num?: boolean; render: (r: R) => ReactNode }

export function DataTable<R>({ cols, rows, state, error, onRetry, empty, onRow, rowKey }: { cols: Column<R>[]; rows: R[]; state: 'loading' | 'error' | 'ready'; error?: string; onRetry?: () => void; empty: string; onRow?: (r: R) => void; rowKey: (r: R) => string }) {
  if (state === 'error') return <div className="card" role="alert"><p className="err">{error}</p>{onRetry && <button className="btn" onClick={onRetry}>Tentar de novo</button>}</div>;
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead><tr>{cols.map((c) => <th key={c.key} className={c.num ? 'num' : undefined}>{c.header}</th>)}</tr></thead>
        <tbody>
          {state === 'loading' && rows.length === 0 && [0, 1, 2, 3].map((i) => <tr key={i}>{cols.map((c) => <td key={c.key}><div className="skeleton" /></td>)}</tr>)}
          {state === 'ready' && rows.length === 0 && <tr><td colSpan={cols.length}><span className="hint">{empty}</span></td></tr>}
          {rows.map((r) => (
            <tr key={rowKey(r)} className={onRow ? 'clickable' : undefined} onClick={onRow ? () => onRow(r) : undefined} tabIndex={onRow ? 0 : undefined} onKeyDown={onRow ? (e) => e.key === 'Enter' && onRow(r) : undefined}>
              {cols.map((c) => <td key={c.key} className={c.num ? 'num' : undefined}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  return (
    <div className="pager">
      <span>{from}–{Math.min(total, page * pageSize)} de {total}</span>
      <button className="btn ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
      <span>Página {page} de {pages}</span>
      <button className="btn ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Próxima</button>
    </div>
  );
}

export const yesNo = (v: boolean) => (v ? 'Sim' : 'Não');
