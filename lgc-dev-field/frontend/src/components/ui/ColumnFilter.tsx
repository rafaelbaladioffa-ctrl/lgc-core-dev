import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Icon from "./Icon";

/** Filtro por coluna estilo planilha: clicar no título da coluna abre uma
 * lista de valores com caixas de seleção. Sem nada selecionado = sem filtro. */

export interface ColumnFilters {
  selected: Record<string, string[]>;
  sort: { key: string; dir: "asc" | "desc" } | null;
  /** Clique no título: crescente → decrescente → sem ordenação. */
  toggleSort: (key: string) => void;
  /** Valores distintos da coluna, considerando os filtros das OUTRAS colunas. */
  options: (key: string) => { value: string; count: number }[];
  setColumn: (key: string, values: string[]) => void;
  clearAll: () => void;
  activeCount: number;
}

const EMPTY = "—";

/** Chave de comparação: datas dd/mm/aaaa viram aaaa-mm-dd; "—" vai para o fim. */
function sortKey(value: string): string {
  const date = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(value);
  return date ? `${date[3]}-${date[2]}-${date[1]}` : value;
}

function compareValues(a: string, b: string): number {
  if (a === EMPTY || a === "") return b === EMPTY || b === "" ? 0 : 1;
  if (b === EMPTY || b === "") return -1;
  return sortKey(a).localeCompare(sortKey(b), "pt-BR", { numeric: true, sensitivity: "base" });
}

export function useColumnFilters<T>(rows: T[], accessors: Record<string, (row: T) => string>) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  const matches = (row: T, skipKey?: string) =>
    Object.entries(selected).every(([key, values]) => {
      if (key === skipKey || values.length === 0 || !accessors[key]) return true;
      return values.includes(accessors[key](row));
    });

  const filtered = useMemo(() => {
    const result = rows.filter((row) => matches(row));
    const accessor = sort ? accessors[sort.key] : null;
    if (sort && accessor) {
      const factor = sort.dir === "asc" ? 1 : -1;
      // vazios ficam sempre no fim, em qualquer direção
      result.sort((a, b) => {
        const va = accessor(a);
        const vb = accessor(b);
        const emptyA = va === EMPTY || va === "";
        const emptyB = vb === EMPTY || vb === "";
        if (emptyA || emptyB) return compareValues(va, vb);
        return factor * compareValues(va, vb);
      });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selected, sort]);

  const filters: ColumnFilters = {
    selected,
    sort,
    toggleSort: (key) =>
      setSort((prev) => {
        if (!prev || prev.key !== key) return { key, dir: "asc" };
        if (prev.dir === "asc") return { key, dir: "desc" };
        return null;
      }),
    options: (key) => {
      const accessor = accessors[key];
      if (!accessor) return [];
      const counts = new Map<string, number>();
      for (const row of rows) {
        if (!matches(row, key)) continue;
        const value = accessor(row);
        counts.set(value, (counts.get(value) || 0) + 1);
      }
      // mantém visíveis valores já selecionados, mesmo que outro filtro os esconda
      for (const value of selected[key] || []) if (!counts.has(value)) counts.set(value, 0);
      return Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value.localeCompare(b.value, "pt-BR", { numeric: true, sensitivity: "base" }));
    },
    setColumn: (key, values) =>
      setSelected((prev) => {
        const next = { ...prev };
        if (values.length === 0) delete next[key];
        else next[key] = values;
        return next;
      }),
    clearAll: () => setSelected({}),
    activeCount: Object.values(selected).filter((v) => v.length > 0).length,
  };
  return { filtered, filters };
}

export function FilterTh({
  label,
  colKey,
  filters,
  style,
  className,
  align,
}: {
  label: ReactNode;
  colKey: string;
  filters: ColumnFilters;
  style?: CSSProperties;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const selected = filters.selected[colKey] || [];
  const active = selected.length > 0;
  const options = open ? filters.options(colKey) : [];
  const visible = options.filter((o) => o.value.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggleOpen() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const width = 260;
      setPos({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) });
      setSearch("");
    }
    setOpen((v) => !v);
  }

  function toggleValue(value: string) {
    const all = options.map((o) => o.value);
    const current = selected.length === 0 ? all : selected;
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    // marcar tudo equivale a não filtrar
    filters.setColumn(colKey, next.length === all.length ? [] : next);
  }

  const sorted = filters.sort?.key === colKey ? filters.sort.dir : null;
  const justify = align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start";

  return (
    <th style={style} className={className}>
      <div className="col-head" style={{ justifyContent: justify }}>
        <button
          type="button"
          className={`col-sort-btn${sorted ? " active" : ""}`}
          onClick={() => filters.toggleSort(colKey)}
          title="Clique para ordenar por esta coluna"
        >
          <span>{label}</span>
          {sorted && <Icon name={sorted === "asc" ? "arrow_upward" : "arrow_downward"} style={{ fontSize: 14 }} />}
        </button>
        <button
          ref={btnRef}
          type="button"
          className={`col-filter-btn${active ? " active" : ""}`}
          onClick={toggleOpen}
          title="Filtrar valores desta coluna"
        >
          <Icon name={active ? "filter_alt" : "arrow_drop_down"} style={{ fontSize: active ? 15 : 18 }} />
          {active && <span className="col-filter-badge">{selected.length}</span>}
        </button>
      </div>

      {open && pos && (
        <div ref={popRef} className="col-filter-pop" style={{ top: pos.top, left: pos.left }}>
          {options.length > 8 && (
            <input className="input" autoFocus placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
          )}
          <div className="col-filter-actions">
            <button type="button" onClick={() => filters.setColumn(colKey, [])}>
              Selecionar tudo
            </button>
            <button type="button" onClick={() => filters.setColumn(colKey, visible.map((o) => o.value))} disabled={visible.length === 0}>
              Só os listados
            </button>
          </div>
          <div className="col-filter-list">
            {visible.map((o) => (
              <label key={o.value} className="col-filter-item">
                <input type="checkbox" checked={selected.length === 0 || selected.includes(o.value)} onChange={() => toggleValue(o.value)} />
                <span className="col-filter-value">{o.value || "(vazio)"}</span>
                <span className="col-filter-count">{o.count}</span>
              </label>
            ))}
            {visible.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: 6 }}>Nada encontrado.</div>}
          </div>
        </div>
      )}
    </th>
  );
}
