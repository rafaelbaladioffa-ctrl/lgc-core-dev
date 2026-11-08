import { useMemo, useRef, useState } from "react";
import { FilterTh, useColumnFilters } from "../../components/ui/ColumnFilter";
import Icon from "../../components/ui/Icon";
import { useI18n } from "../../i18n";
import type { EntityConfig } from "./registryConfig";
import { entityLabels } from "./registryConfig";

export interface RecentRecord {
  entityKey: string;
  entityLabel: string;
  icon: string;
  name: string;
  code: string;
  isActive: boolean;
  updatedAt: string | null;
}

const TONES = [
  { bg: "var(--blue-soft)", color: "var(--blue)" },
  { bg: "var(--orange-soft)", color: "var(--orange)" },
  { bg: "var(--green-soft)", color: "var(--green)" },
  { bg: "var(--amber-soft)", color: "var(--amber)" },
];

function toneFor(index: number) {
  return TONES[index % TONES.length];
}

function formatDate(value: string | null, locale: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function CatalogGrid({
  entities,
  counts,
  recentRecords,
  onSelect,
  onQuickCreate,
}: {
  entities: EntityConfig<any>[];
  counts: Record<string, number | null>;
  recentRecords: RecentRecord[];
  onSelect: (key: string) => void;
  onQuickCreate: (key: string) => void;
}) {
  const { locale, t } = useI18n();
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const { filtered: visibleRecords, filters: colFilters } = useColumnFilters<RecentRecord>(recentRecords, {
    entity: (r) => r.entityLabel,
    name: (r) => r.name,
    code: (r) => r.code || "—",
    status: (r) => (r.isActive ? t.common.ativo : t.common.inativo),
    updated: (r) => formatDate(r.updatedAt, locale),
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative" }} ref={newMenuRef}>
            <button className="btn btn-primary" onClick={() => setNewMenuOpen((v) => !v)}>
              <Icon name="add" style={{ fontSize: 18 }} />
              {t.crud.novoCadastro}
              <Icon name={newMenuOpen ? "expand_less" : "expand_more"} style={{ fontSize: 16 }} />
            </button>
            {newMenuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setNewMenuOpen(false)} />
                <div
                  className="card"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 6px)",
                    minWidth: 220,
                    padding: 6,
                    zIndex: 11,
                    maxHeight: 320,
                    overflowY: "auto",
                  }}
                >
                  {entities.map((e) => (
                    <button
                      key={e.key}
                      onClick={() => {
                        setNewMenuOpen(false);
                        onQuickCreate(e.key);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        padding: "8px 10px",
                        border: 0,
                        background: "transparent",
                        borderRadius: 8,
                        cursor: "pointer",
                        fontSize: 13.5,
                        color: "var(--text)",
                        textAlign: "left",
                      }}
                      onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--bg)")}
                      onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
                    >
                      <Icon name={e.icon} style={{ fontSize: 16, color: "var(--text-muted)" }} />
                      {entityLabels(e, locale).createLabel}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14, marginBottom: 32 }}>
        {entities.map((entity, index) => {
          const tone = toneFor(index);
          const count = counts[entity.key];
          const el = entityLabels(entity, locale);
          return (
            <button
              key={entity.key}
              onClick={() => onSelect(entity.key)}
              className="card"
              style={{
                textAlign: "left",
                padding: 18,
                cursor: "pointer",
                border: "1px solid var(--border)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: tone.bg,
                  color: tone.color,
                }}
              >
                <Icon name={entity.icon} style={{ fontSize: 20 }} />
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)" }}>{el.label}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", flex: 1 }}>{el.description}</div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", fontWeight: 600 }}>
                {count === null ? "—" : t.crud.contagem(count)}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t.crud.registrosRecentes}</div>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <FilterTh colKey="entity" label={t.crud.entidade} filters={colFilters} />
                <FilterTh colKey="name" label={t.crud.nomeDescricao} filters={colFilters} />
                <FilterTh colKey="code" label={t.crud.codigo} filters={colFilters} />
                <FilterTh colKey="status" label={t.crud.situacao} filters={colFilters} />
                <FilterTh colKey="updated" label={t.crud.atualizadoEm} filters={colFilters} />
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((row, i) => (
                <tr key={`${row.entityKey}-${i}`} onClick={() => onSelect(row.entityKey)} style={{ cursor: "pointer" }}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Icon name={row.icon} style={{ fontSize: 15, color: "var(--text-muted)" }} />
                      {row.entityLabel}
                    </div>
                  </td>
                  <td>{row.name}</td>
                  <td>{row.code || "—"}</td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        background: row.isActive ? "var(--green-soft)" : "#eef1f6",
                        color: row.isActive ? "var(--green)" : "var(--text-muted)",
                      }}
                    >
                      {row.isActive ? t.common.ativo : t.common.inativo}
                    </span>
                  </td>
                  <td>{formatDate(row.updatedAt, locale)}</td>
                </tr>
              ))}
              {visibleRecords.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="table-empty">{t.crud.nenhumRecente}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
