import { SearchMultiSelect } from "../ui/SearchSelect";
import MultiSelectFilter from "../ui/MultiSelectFilter";
import { useEffect, useMemo, useRef, useState } from "react";
import { dashboardApi, projectUpdatesApi } from "../../api/resources";
import type { Project, SitesPanelData, SitesPanelGroupBy, SitesPanelHealth, SitesPanelProject, UserOption } from "../../api/types";
import DateRangeCalendar, { type DateRange } from "../ui/DateRangeCalendar";
import Icon from "../ui/Icon";
import EmailLanguageSelect, { defaultEmailLanguage, type EmailLanguage } from "../ui/EmailLanguageSelect";
import { useI18n, usePageText } from "../../i18n";
import { addDaysIso, brazilTodayIso } from "../../utils/date";

type StatusKey = "active" | "paused" | "planning" | "finished";
const STATUS_KEYS: StatusKey[] = ["active", "paused", "planning", "finished"];
const DEFAULT_STATUS: StatusKey[] = ["active", "paused", "planning"];
const GROUP_KEYS: SitesPanelGroupBy[] = ["site", "region", "client", "responsible"];

const TEXT = {
  "pt-BR": {
    title: "Update Semanal",
    info: "Envia um único e-mail com todos os projetos selecionados e o PDF do relatório anexo. Para cada projeto é usada a atualização mais recente do período (ou uma nova é gerada). Os responsáveis do cliente recebem apenas os projetos do próprio cliente.",
    period: "Semana",
    projects: "Projetos",
    groupBy: "Agrupar por",
    groupByOptions: { site: "Site", region: "Regional", client: "Cliente", responsible: "Responsável" } as Record<SitesPanelGroupBy, string>,
    country: "País",
    allCountries: "Todos os países",
    countries: { BR: "Brasil", US: "EUA", CL: "Chile", MX: "México" } as Record<string, string>,
    status: "Status",
    statusOptions: { active: "Ativos", paused: "Pausados", planning: "Planejamentos", finished: "Finalizados" } as Record<StatusKey, string>,
    onlyAlerts: "Somente com alerta",
    statusAll: "Todos",
    search: "Buscar projeto, código ou PO...",
    selectAll: "Marcar todos os filtrados",
    clear: "Limpar seleção",
    selected: "selecionado(s)",
    shown: "exibido(s)",
    loading: "Carregando projetos...",
    empty: "Nenhum projeto para os filtros selecionados.",
    health: { late: "Atrasado", risk: "Em risco", ok: "No prazo", no_data: "Sem dados" } as Record<SitesPanelHealth, string>,
    systemUsers: "Usuários do sistema (recebem todos os projetos)",
    extraEmails: "E-mails avulsos (recebem todos os projetos)",
    extraEmailsPlaceholder: "Separe por vírgula ou uma linha por e-mail",
    send: "Enviar Update Semanal",
    sending: "Enviando...",
    sentResult: "e-mail(s) enviado(s) com",
    projectsWord: "projeto(s).",
    noEmail: "Sem e-mail:",
    errorSend: "Não foi possível enviar o Update Semanal.",
  },
  "en-US": {
    title: "Weekly Update",
    info: "Sends a single e-mail with all selected projects and the report PDF attached. For each project the most recent update in the period is used (or a new one is generated). Client contacts only receive their own client's projects.",
    period: "Week",
    projects: "Projects",
    groupBy: "Group by",
    groupByOptions: { site: "Site", region: "Region", client: "Client", responsible: "Owner" } as Record<SitesPanelGroupBy, string>,
    country: "Country",
    allCountries: "All countries",
    countries: { BR: "Brazil", US: "USA", CL: "Chile", MX: "Mexico" } as Record<string, string>,
    status: "Status",
    statusOptions: { active: "Active", paused: "Paused", planning: "Planning", finished: "Finished" } as Record<StatusKey, string>,
    onlyAlerts: "Only with alerts",
    statusAll: "All",
    search: "Search project, code or PO...",
    selectAll: "Select all filtered",
    clear: "Clear selection",
    selected: "selected",
    shown: "shown",
    loading: "Loading projects...",
    empty: "No projects for the selected filters.",
    health: { late: "Late", risk: "At risk", ok: "On track", no_data: "No data" } as Record<SitesPanelHealth, string>,
    systemUsers: "System users (receive all projects)",
    extraEmails: "Individual e-mails (receive all projects)",
    extraEmailsPlaceholder: "Separate by comma or one e-mail per line",
    send: "Send Weekly Update",
    sending: "Sending...",
    sentResult: "e-mail(s) sent with",
    projectsWord: "project(s).",
    noEmail: "No e-mail:",
    errorSend: "Could not send the Weekly Update.",
  },
  "es-ES": {
    title: "Update Semanal",
    info: "Envía un único correo con todos los proyectos seleccionados y el PDF del informe adjunto. Para cada proyecto se usa la actualización más reciente del período (o se genera una nueva). Los responsables del cliente solo reciben los proyectos de su propio cliente.",
    period: "Semana",
    projects: "Proyectos",
    groupBy: "Agrupar por",
    groupByOptions: { site: "Sitio", region: "Regional", client: "Cliente", responsible: "Responsable" } as Record<SitesPanelGroupBy, string>,
    country: "País",
    allCountries: "Todos los países",
    countries: { BR: "Brasil", US: "EE. UU.", CL: "Chile", MX: "México" } as Record<string, string>,
    status: "Estado",
    statusOptions: { active: "Activos", paused: "Pausados", planning: "Planificación", finished: "Finalizados" } as Record<StatusKey, string>,
    onlyAlerts: "Solo con alerta",
    statusAll: "Todos",
    search: "Buscar proyecto, código o PO...",
    selectAll: "Marcar todos los filtrados",
    clear: "Limpiar selección",
    selected: "seleccionado(s)",
    shown: "mostrado(s)",
    loading: "Cargando proyectos...",
    empty: "Ningún proyecto para los filtros seleccionados.",
    health: { late: "Atrasado", risk: "En riesgo", ok: "En plazo", no_data: "Sin datos" } as Record<SitesPanelHealth, string>,
    systemUsers: "Usuarios del sistema (reciben todos los proyectos)",
    extraEmails: "Correos individuales (reciben todos los proyectos)",
    extraEmailsPlaceholder: "Separe por coma o un correo por línea",
    send: "Enviar Update Semanal",
    sending: "Enviando...",
    sentResult: "correo(s) enviado(s) con",
    projectsWord: "proyecto(s).",
    noEmail: "Sin correo:",
    errorSend: "No se pudo enviar el Update Semanal.",
  },
};

const HEALTH_COLOR: Record<SitesPanelHealth, string> = {
  late: "var(--red)",
  risk: "var(--amber)",
  ok: "var(--green)",
  no_data: "var(--text-muted)",
};

interface Row {
  id: number;
  name: string;
  code: string;
  po: string;
  statusDisplay: string;
  health: SitesPanelHealth | null;
}

interface RowGroup {
  key: string;
  label: string;
  sublabel: string;
  rows: Row[];
}

export default function WeeklyUpdatePanel({ projects, userOptions }: { projects: Project[]; userOptions: UserOption[] }) {
  const p = usePageText(TEXT);
  const { locale } = useI18n();
  const today = brazilTodayIso();
  const [range, setRange] = useState<DateRange | null>({ start: addDaysIso(today, -6), end: today });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<SitesPanelGroupBy[]>(["site"]);
  const [countries, setCountries] = useState<string[]>([]);
  const groupByParam = GROUP_KEYS.filter((k) => groupBy.includes(k)).join(",");
  const countryParam = countries.join(",");
  const [statusKeys, setStatusKeys] = useState<StatusKey[]>(DEFAULT_STATUS);
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const [panel, setPanel] = useState<SitesPanelData | null>(null);
  const [panelFailed, setPanelFailed] = useState(false);
  const [loadingPanel, setLoadingPanel] = useState(true);
  const [userIds, setUserIds] = useState<number[]>([]);
  const [emailsText, setEmailsText] = useState("");
  const [lang, setLang] = useState<EmailLanguage>(defaultEmailLanguage(locale));
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  // Mesmos filtros do módulo Gestão de Sites: a lista vem da própria API do painel.
  const statusParam = STATUS_KEYS.filter((k) => statusKeys.includes(k)).join(",");
  useEffect(() => {
    let cancelled = false;
    setLoadingPanel(true);
    const params: Record<string, string> = { group_by: groupByParam, status: statusParam };
    if (countryParam) params.country = countryParam;
    dashboardApi
      .sites(params)
      .then((data) => {
        if (cancelled) return;
        setPanel(data);
        setPanelFailed(false);
      })
      .catch(() => {
        if (!cancelled) setPanelFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingPanel(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupByParam, countryParam, statusParam]);

  const poById = useMemo(() => {
    const map: Record<number, string> = {};
    projects.forEach((proj) => {
      map[proj.id] = proj.po || "";
    });
    return map;
  }, [projects]);

  const groups: RowGroup[] = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matches = (row: Row) =>
      !term || row.name.toLowerCase().includes(term) || row.code.toLowerCase().includes(term) || row.po.toLowerCase().includes(term);

    // Sem acesso ao painel (permissão): lista simples dos projetos já carregados na tela.
    if (panelFailed || !panel) {
      const rows = projects
        .map((proj): Row => ({ id: proj.id, name: proj.name, code: proj.code || "", po: proj.po || "", statusDisplay: proj.status_display, health: null }))
        .filter(matches);
      return rows.length ? [{ key: "all", label: "", sublabel: "", rows }] : [];
    }

    const byGroup = new Map<string, Row[]>();
    panel.projects.forEach((proj: SitesPanelProject) => {
      if (onlyAlerts && proj.health !== "late" && proj.health !== "risk") return;
      const row: Row = {
        id: proj.id,
        name: proj.name,
        code: proj.code || "",
        po: poById[proj.id] || "",
        statusDisplay: proj.status_display,
        health: proj.health,
      };
      if (!matches(row)) return;
      byGroup.set(proj.group_key, [...(byGroup.get(proj.group_key) ?? []), row]);
    });
    return panel.groups
      .filter((g) => byGroup.has(g.key))
      .map((g) => ({ key: g.key, label: g.label, sublabel: g.sublabel, rows: byGroup.get(g.key) ?? [] }));
  }, [panel, panelFailed, projects, poById, search, onlyAlerts]);

  const shownIds = useMemo(() => groups.flatMap((g) => g.rows.map((r) => r.id)), [groups]);

  function toggle(id: number) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleGroup(ids: number[]) {
    setSelectedIds((prev) => (ids.every((id) => prev.includes(id)) ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids]))));
  }

  async function handleSend() {
    if (!range || selectedIds.length === 0) return;
    const emails = emailsText
      .split(/[,;\n]/)
      .map((e) => e.trim())
      .filter(Boolean);
    setSending(true);
    setFeedback("");
    setError("");
    try {
      const result = await projectUpdatesApi.sendWeekly({
        project_ids: selectedIds,
        start: range.start,
        end: range.end,
        user_ids: userIds,
        emails,
        language: lang,
      });
      const skipped = result.skipped.length ? ` ${p.noEmail} ${result.skipped.join(", ")}` : "";
      setFeedback(`${result.sent.length} ${p.sentResult} ${result.projects} ${p.projectsWord}${skipped}`);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || p.errorSend);
    } finally {
      setSending(false);
    }
  }

  const showFilters = !panelFailed;

  return (
    <div className="form-card">
      <h3 style={{ margin: "0 0 6px" }}>{p.title}</h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>{p.info}</p>

      <label className="form-label">{p.period}</label>
      <DateRangeCalendar value={range} onChange={setRange} maxDays={31} />

      <label className="form-label">
        {p.projects} ({selectedIds.length} {p.selected} · {shownIds.length} {p.shown})
      </label>

      {showFilters && (
        <div className="sp-filters" style={{ margin: "0 0 10px" }}>
          <MultiSelectFilter
            label={p.groupBy}
            options={GROUP_KEYS.map((k) => ({ value: k, label: p.groupByOptions[k] }))}
            selected={groupBy}
            onChange={(next) => setGroupBy(next as SitesPanelGroupBy[])}
            allLabel={p.groupByOptions.site}
            separator=" · "
            requireOne
          />
          <MultiSelectFilter
            label={p.country}
            options={Object.entries(p.countries).map(([code, label]) => ({ value: code, label }))}
            selected={countries}
            onChange={setCountries}
            allLabel={p.allCountries}
          />
          <MultiSelectFilter
            label={p.status}
            options={STATUS_KEYS.map((k) => ({ value: k, label: p.statusOptions[k] }))}
            selected={statusKeys}
            onChange={(next) => setStatusKeys(next as StatusKey[])}
            allLabel={p.statusAll}
            allWhenFull
            requireOne
          />
          <label className="sp-toggle">
            <input type="checkbox" checked={onlyAlerts} onChange={(e) => setOnlyAlerts(e.target.checked)} />
            {p.onlyAlerts}
          </label>
        </div>
      )}

      <input className="input" placeholder={p.search} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div style={{ display: "flex", gap: 12, margin: "6px 0", fontSize: 12 }}>
        <button type="button" className="btn btn-secondary" onClick={() => setSelectedIds((prev) => Array.from(new Set([...prev, ...shownIds])))}>
          {p.selectAll}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setSelectedIds([])}>
          {p.clear}
        </button>
      </div>

      <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
        {loadingPanel && !panel && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{p.loading}</p>}
        {!loadingPanel && groups.length === 0 && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{p.empty}</p>}
        {groups.map((group) => {
          const ids = group.rows.map((r) => r.id);
          const allSelected = ids.every((id) => selectedIds.includes(id));
          const someSelected = !allSelected && ids.some((id) => selectedIds.includes(id));
          return (
            <div key={group.key} style={{ marginBottom: 8 }}>
              {group.label && (
                <label
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, padding: "4px 0", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                >
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={() => toggleGroup(ids)}
                  />
                  <span>
                    {group.label}
                    {group.sublabel && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {group.sublabel}</span>}
                  </span>
                  <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontWeight: 400 }}>{group.rows.length}</span>
                </label>
              )}
              {group.rows.map((row) => (
                <label key={row.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0 3px 18px", cursor: "pointer" }}>
                  <input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => toggle(row.id)} />
                  <span style={{ minWidth: 0 }}>
                    {row.name}
                    <span style={{ color: "var(--text-muted)" }}>
                      {" "}
                      · {row.code || "—"}
                      {row.po ? ` · ${row.po}` : ""}
                    </span>
                  </span>
                  {row.health && (
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: HEALTH_COLOR[row.health], whiteSpace: "nowrap" }}>
                      {p.health[row.health]}
                    </span>
                  )}
                </label>
              ))}
            </div>
          );
        })}
      </div>

      <label className="form-label">{p.systemUsers}</label>
      <SearchMultiSelect
        options={userOptions.map((u) => ({ value: u.id, label: u.name, sublabel: u.email }))}
        value={userIds}
        onChange={(next) => setUserIds(next.map(Number))}
      />

      <label className="form-label">{p.extraEmails}</label>
      <textarea
        className="input"
        placeholder={p.extraEmailsPlaceholder}
        value={emailsText}
        onChange={(e) => setEmailsText(e.target.value)}
        style={{ height: 60 }}
      />

      {feedback && <p style={{ fontSize: 13, color: "var(--green)", marginTop: 10, fontWeight: 600 }}>{feedback}</p>}
      {error && <p style={{ fontSize: 13, color: "var(--red)", marginTop: 10, fontWeight: 600 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
        <EmailLanguageSelect value={lang} onChange={setLang} />
        <button className="btn btn-primary" onClick={handleSend} disabled={sending || !range || selectedIds.length === 0}>
          {sending ? p.sending : p.send}
        </button>
      </div>
    </div>
  );
}
