import { Fragment, useEffect, useMemo, useState } from "react";
import { auditLogApi } from "../api/resources";
import type { AuditLogEntry } from "../api/types";
import { useI18n, usePageText } from "../i18n";
import DateInput from "../components/ui/DateInput";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import Pagination from "../components/ui/Pagination";

const TEXT = {
  "pt-BR": {
    eyebrow: "Segurança", title: "Log de Auditoria",
    subtitle: "Histórico de alterações no sistema — visível apenas para superusuários.",
    search: "Buscar por registro ou usuário...",
    actionLabel: "Ação", appLabel: "Aplicação", modelLabel: "Cadastro",
    modelPlaceholder: "ex: project",
    dateFrom: "De", dateTo: "Até", all: "Todas",
    loading: "Carregando...", noRecords: "Nenhum registro encontrado.",
    colDate: "Data/Hora", colUser: "Usuário", colApp: "Aplicação",
    colModel: "Cadastro", colRecord: "Registro", colAction: "Ação", colField: "Campo",
    oldValue: "Valor anterior", newValue: "Novo valor",
    origin: "Origem", path: "Caminho", ip: "Endereço IP",
    actions: [
      { value: "", label: "Todas" },
      { value: "create", label: "Inclusão" },
      { value: "update", label: "Alteração" },
      { value: "delete", label: "Exclusão" },
      { value: "m2m_add", label: "Vínculo adicionado" },
      { value: "m2m_remove", label: "Vínculo removido" },
      { value: "m2m_clear", label: "Vínculos removidos" },
      { value: "export", label: "Exportação" },
    ],
  },
  "en-US": {
    eyebrow: "Security", title: "Audit Log",
    subtitle: "History of system changes — visible to superusers only.",
    search: "Search by record or user...",
    actionLabel: "Action", appLabel: "Application", modelLabel: "Model",
    modelPlaceholder: "e.g. project",
    dateFrom: "From", dateTo: "To", all: "All",
    loading: "Loading...", noRecords: "No records found.",
    colDate: "Date/Time", colUser: "User", colApp: "Application",
    colModel: "Model", colRecord: "Record", colAction: "Action", colField: "Field",
    oldValue: "Previous value", newValue: "New value",
    origin: "Origin", path: "Path", ip: "IP Address",
    actions: [
      { value: "", label: "All" },
      { value: "create", label: "Create" },
      { value: "update", label: "Update" },
      { value: "delete", label: "Delete" },
      { value: "m2m_add", label: "Link added" },
      { value: "m2m_remove", label: "Link removed" },
      { value: "m2m_clear", label: "Links cleared" },
      { value: "export", label: "Export" },
    ],
  },
  "es-ES": {
    eyebrow: "Seguridad", title: "Registro de Auditoría",
    subtitle: "Historial de cambios en el sistema — visible solo para superusuarios.",
    search: "Buscar por registro o usuario...",
    actionLabel: "Acción", appLabel: "Aplicación", modelLabel: "Modelo",
    modelPlaceholder: "ej: project",
    dateFrom: "Desde", dateTo: "Hasta", all: "Todas",
    loading: "Cargando...", noRecords: "Sin registros.",
    colDate: "Fecha/Hora", colUser: "Usuario", colApp: "Aplicación",
    colModel: "Modelo", colRecord: "Registro", colAction: "Acción", colField: "Campo",
    oldValue: "Valor anterior", newValue: "Valor nuevo",
    origin: "Origen", path: "Ruta", ip: "Dirección IP",
    actions: [
      { value: "", label: "Todas" },
      { value: "create", label: "Inclusión" },
      { value: "update", label: "Modificación" },
      { value: "delete", label: "Eliminación" },
      { value: "m2m_add", label: "Vínculo agregado" },
      { value: "m2m_remove", label: "Vínculo eliminado" },
      { value: "m2m_clear", label: "Vínculos eliminados" },
      { value: "export", label: "Exportación" },
    ],
  },
};

export default function AuditLog() {
  const p = usePageText(TEXT);
  const { locale } = useI18n();

  function formatDateTime(value: string) {
    return new Date(value).toLocaleString(locale);
  }
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string[]>([]);
  const [appLabel, setAppLabel] = useState<string[]>([]);
  const [modelName, setModelName] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  function reload() {
    setLoading(true);
    const params: Record<string, string> = { page_size: "1000" };
    if (action.length) params.action = action.join(",");
    if (appLabel.length) params.app_label = appLabel.join(",");
    if (modelName) params.model_name = modelName;
    if (search) params.search = search;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    auditLogApi
      .list(params)
      .then((data) => setRows(data.results))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, appLabel, modelName, search, dateFrom, dateTo]);

  const appOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.app_label))).sort(), [rows]);
  const paged = rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <PageHeader eyebrow={p.eyebrow} title={p.title} subtitle={p.subtitle} />

      <div className="card">
        <div className="filter-row">
          <div className="search-input-wrap" style={{ flex: 1, minWidth: 220 }}>
            <Icon name="search" />
            <input className="input" placeholder={p.search} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <MultiSelectFilter
            label={p.actionLabel}
            options={p.actions.filter((opt) => opt.value !== "").map((opt) => ({ value: opt.value, label: opt.label }))}
            selected={action}
            onChange={setAction}
            allLabel={p.actions[0]?.label ?? p.all}
          />
          <MultiSelectFilter
            label={p.appLabel}
            options={appOptions.map((app) => ({ value: app, label: app }))}
            selected={appLabel}
            onChange={setAppLabel}
            allLabel={p.all}
          />
          <div className="field-group">
            <span className="field-label">{p.modelLabel}</span>
            <input className="input" value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder={p.modelPlaceholder} />
          </div>
          <div className="field-group">
            <span className="field-label">{p.dateFrom}</span>
            <DateInput value={dateFrom} onChange={setDateFrom} />
          </div>
          <div className="field-group">
            <span className="field-label">{p.dateTo}</span>
            <DateInput value={dateTo} onChange={setDateTo} />
          </div>
        </div>

        {loading ? (
          <p style={{ padding: 20, color: "var(--text-muted)" }}>{p.loading}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{p.colDate}</th><th>{p.colUser}</th><th>{p.colApp}</th>
                  <th>{p.colModel}</th><th>{p.colRecord}</th><th>{p.colAction}</th>
                  <th>{p.colField}</th><th></th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => (
                  <Fragment key={row.id}>
                    <tr onClick={() => setExpandedId(expandedId === row.id ? null : row.id)} style={{ cursor: "pointer" }}>
                      <td>{formatDateTime(row.created_at)}</td>
                      <td>{row.actor_name || "—"}</td>
                      <td>{row.app_label}</td>
                      <td>{row.model_name}</td>
                      <td>{row.object_repr || row.object_pk || "—"}</td>
                      <td>{row.action_display}</td>
                      <td>{row.field_name || "—"}</td>
                      <td><Icon name={expandedId === row.id ? "expand_less" : "expand_more"} style={{ fontSize: 16 }} /></td>
                    </tr>
                    {expandedId === row.id && (
                      <tr>
                        <td colSpan={8} style={{ background: "var(--bg)" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, padding: "10px 4px", fontSize: 12.5 }}>
                            <div><strong>{p.oldValue}</strong><div style={{ color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>{row.old_value || "—"}</div></div>
                            <div><strong>{p.newValue}</strong><div style={{ color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>{row.new_value || "—"}</div></div>
                            <div><strong>{p.origin}</strong><div style={{ color: "var(--text-muted)" }}>{row.origin || "—"}</div></div>
                            <div><strong>{p.path}</strong><div style={{ color: "var(--text-muted)" }}>{row.path || "—"}</div></div>
                            <div><strong>{p.ip}</strong><div style={{ color: "var(--text-muted)" }}>{row.ip_address || "—"}</div></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {paged.length === 0 && (
                  <tr><td colSpan={8}><div className="table-empty">{p.noRecords}</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>
    </div>
  );
}
