import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { dashboardApi } from "../api/resources";
import type {
  SitesPanelData,
  SitesPanelException,
  SitesPanelGroup,
  SitesPanelGroupBy,
  SitesPanelHealth,
  SitesPanelProject,
  SitesPanelTechCounts,
} from "../api/types";
import { FilterTh, useColumnFilters } from "../components/ui/ColumnFilter";
import Icon from "../components/ui/Icon";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import PageHeader from "../components/ui/PageHeader";
import { useAuth } from "../context/AuthContext";
import { usePageText } from "../i18n";
import { PERMS, hasPerm } from "../utils/permissions";

/* Painel de Gestão de Sites — visão de negócio em docs/painel-gestao-sites.md.
 * Parte fixa (filtros, indicadores, painel lateral) aparece uma vez só; cada
 * aba mostra apenas o que é dela:
 *   Visão geral          → cards por grupo (semáforo + contagens)
 *   Análise de projetos  → tabela por projeto + exportação
 *   Regionais e exceções → mapa dos sites + fila de exceções acionável */

type Tab = "overview" | "analysis" | "exceptions";
type ExceptionFilter = "all" | SitesPanelException["kind"];
// Mesmas abas da lista de projetos; combináveis.
type StatusKey = "active" | "paused" | "planning" | "finished";
const STATUS_KEYS: StatusKey[] = ["active", "paused", "planning", "finished"];
const DEFAULT_STATUS: StatusKey[] = ["active", "paused", "planning"];
const GROUP_COUNT_FIELD: Record<StatusKey, "in_progress" | "paused" | "planning" | "finished"> = {
  active: "in_progress",
  paused: "paused",
  planning: "planning",
  finished: "finished",
};

const TEXT = {
  "pt-BR": {
    eyebrow: "Central de Operações",
    title: "Gestão de Sites",
    subtitle: (date: string, time: string) => `Visão consolidada · ${date} · atualizado às ${time}`,
    refresh: "Atualizar",
    groupBy: "Agrupar por",
    groupByOptions: { site: "Site", region: "Regional", client: "Cliente", responsible: "Responsável" } as Record<SitesPanelGroupBy, string>,
    groupByHint: "Marque mais de uma opção para combinar os grupos (ex.: Regional · Cliente).",
    countryHint: "Marque um ou mais países.",
    country: "País", allCountries: "Todos os países",
    countries: { BR: "Brasil", US: "EUA", CL: "Chile", MX: "México" } as Record<string, string>,
    status: "Status",
    statusOptions: { active: "Ativos", paused: "Pausados", planning: "Planejamentos", finished: "Finalizados" } as Record<StatusKey, string>,
    statusHints: { active: "em andamento", paused: "aguardando retomada", planning: "em preparação", finished: "concluídos ou cancelados" } as Record<StatusKey, string>,
    onlyAlerts: "Somente com alerta",
    tabs: { overview: "Visão geral", analysis: "Análise de projetos", exceptions: "Regionais e exceções" } as Record<Tab, string>,
    kpiStartingSoon: (n: number) => `${n} iniciam em até 7 dias`,
    kpiLate: "Atrasados", kpiLateHint: (n: number) => `em ${n} grupo(s)`,
    kpiRisk: "Risco de atraso", kpiRiskHint: (n: number) => (n ? `${n} com início atrasado` : "real abaixo do planejado"),
    kpiPresent: "Técnicos presentes", kpiPresentHint: (n: number) => `${n} em execução agora`,
    kpiAbsent: "Ausentes", kpiAbsentHint: (leave: number, nocheck: number) => `${leave} ausência plan. · ${nocheck} sem check-in`,
    kpiUnproductive: "Improdutivos", kpiUnproductiveHint: "sem tarefa, sem acesso ou aguardando",
    loading: "Carregando painel...", error: "Não foi possível carregar o painel.", retry: "Tentar novamente",
    empty: "Nenhum projeto ativo ou em planejamento para os filtros escolhidos.",
    noTechPermission: "Indicadores de técnicos ocultos: requer acesso à Central de Operações.",
    health: { late: "Crítico", risk: "Atenção", ok: "No prazo", no_data: "Sem dados" } as Record<SitesPanelHealth, string>,
    healthProject: { late: "Atrasado", risk: "Risco", ok: "No prazo", no_data: "Sem dados" } as Record<SitesPanelHealth, string>,
    legend: "Legenda",
    sortedBy: (n: number) => `${n} grupo(s) · ordenados por criticidade`,
    cExecution: "Execução", cPlanning: "Planejamento",
    presentOf: (p: number, t: number) => `${p} presentes de ${t}`,
    noTechs: "Nenhum técnico no dia",
    techLegend: { executing: "em execução", unproductive: "improdutivo", break: "pausa", off_duty: "encerrou", on_leave: "ausente", no_checkin: "sem check-in" } as Record<string, string>,
    statusAll: "Todos",
    statusShort: { active: "Ativos", paused: "Pausados", planning: "Planej.", finished: "Finaliz." } as Record<StatusKey, string>,
    lateCount: (n: number) => (n === 1 ? "1 atrasado" : `${n} atrasados`),
    riskCount: (n: number) => `${n} em risco`,
    noAlerts: "Nenhum alerta",
    occurrences: "Ocorrências", updatesPending: "Update pendente",
    seeProjects: "Ver projetos",
    dataQuality: "Qualidade de cadastro",
    dq: {
      sites_without_region: "site(s) sem regional", projects_without_end: "projeto(s) sem término previsto",
      projects_without_site: "projeto(s) sem site", executing_without_tasks: "projeto(s) em execução sem tarefas",
      technicians_without_job_title: "técnico(s) sem cargo",
    } as Record<string, string>,
    filteredBy: "Filtrado por", clearFilter: "Limpar",
    exportCsv: "Exportar CSV",
    col: { project: "Projeto · Site", status: "Status", resp: "Resp. CSTR", progress: "Real x planejado", end: "Término prev.", deviation: "Desvio", techs: "Técn. hoje", occ: "Ocorr.", update: "Update", health: "Saúde" },
    real: "real", planned: "plan.", noBase: "sem base", notStarted: "não iniciado",
    update: { sent: "enviado", draft: "rascunho", missing: "pendente" } as Record<string, string>,
    mapTitle: "Distribuição dos sites", mapHint: "cor = pior situação do site · tamanho = técnicos",
    sitesWithoutCoords: (n: number) => `${n} site(s) com projeto sem coordenadas não aparecem no mapa`,
    noCoords: "Nenhum site com coordenadas nos filtros escolhidos.",
    exceptionsTitle: "Exceções que pedem ação", exceptionsOpen: (n: number) => `${n} abertas`,
    exceptionKinds: { all: "Todas", deadline: "Prazo", team: "Equipe", client: "Cliente", mobilization: "Mobilização" } as Record<ExceptionFilter, string>,
    noExceptions: "Nenhuma exceção nos filtros escolhidos.",
    actionProject: "Detalhes", actionOperations: "Central", actionUpdates: "Atualizações",
    drawerReal: "Real", drawerPlanned: "Planejado", drawerDeviation: "Desvio", drawerEnd: "Término prev.", drawerTasks: "Tarefas", drawerOverdue: "Vencidas",
    drawerWhy: "Por que está assim", drawerTrend: "Avanço últimos 7 dias", drawerTrendEmpty: "Sem retratos de avanço no período.",
    drawerTeam: (n: number) => `Equipe no projeto hoje · ${n}`, drawerTeamEmpty: "Nenhum técnico despachado hoje.",
    openProject: "Abrir projeto", openOperations: "Central de Operações", close: "Fechar",
    noCanceled: "Avanço sem tarefas canceladas",
    noResponsible: "sem responsável",
    pp: "pp",
  },
  "en-US": {
    eyebrow: "Operations Center",
    title: "Sites Management",
    subtitle: (date: string, time: string) => `Consolidated view · ${date} · updated at ${time}`,
    refresh: "Refresh",
    groupBy: "Group by",
    groupByOptions: { site: "Site", region: "Region", client: "Client", responsible: "Owner" } as Record<SitesPanelGroupBy, string>,
    groupByHint: "Check more than one option to combine the groups (e.g. Region · Client).",
    countryHint: "Check one or more countries.",
    country: "Country", allCountries: "All countries",
    countries: { BR: "Brazil", US: "USA", CL: "Chile", MX: "Mexico" } as Record<string, string>,
    status: "Status",
    statusOptions: { active: "Active", paused: "Paused", planning: "Planning", finished: "Finished" } as Record<StatusKey, string>,
    statusHints: { active: "in progress", paused: "awaiting resumption", planning: "in preparation", finished: "completed or canceled" } as Record<StatusKey, string>,
    onlyAlerts: "Only with alerts",
    tabs: { overview: "Overview", analysis: "Project analysis", exceptions: "Regions & exceptions" } as Record<Tab, string>,
    kpiStartingSoon: (n: number) => `${n} start within 7 days`,
    kpiLate: "Late", kpiLateHint: (n: number) => `in ${n} group(s)`,
    kpiRisk: "At risk", kpiRiskHint: (n: number) => (n ? `${n} with late start` : "actual below plan"),
    kpiPresent: "Technicians present", kpiPresentHint: (n: number) => `${n} executing now`,
    kpiAbsent: "Absent", kpiAbsentHint: (leave: number, nocheck: number) => `${leave} planned leave · ${nocheck} no check-in`,
    kpiUnproductive: "Unproductive", kpiUnproductiveHint: "no task, no access or waiting",
    loading: "Loading panel...", error: "Could not load the panel.", retry: "Try again",
    empty: "No active or planned projects for the selected filters.",
    noTechPermission: "Technician indicators hidden: requires Operations Center access.",
    health: { late: "Critical", risk: "Warning", ok: "On track", no_data: "No data" } as Record<SitesPanelHealth, string>,
    healthProject: { late: "Late", risk: "At risk", ok: "On track", no_data: "No data" } as Record<SitesPanelHealth, string>,
    legend: "Legend",
    sortedBy: (n: number) => `${n} group(s) · sorted by severity`,
    cExecution: "Execution", cPlanning: "Planning",
    presentOf: (p: number, t: number) => `${p} present of ${t}`,
    noTechs: "No technicians today",
    techLegend: { executing: "executing", unproductive: "unproductive", break: "break", off_duty: "finished", on_leave: "absent", no_checkin: "no check-in" } as Record<string, string>,
    statusAll: "All",
    statusShort: { active: "Active", paused: "Paused", planning: "Planning", finished: "Finished" } as Record<StatusKey, string>,
    lateCount: (n: number) => `${n} late`,
    riskCount: (n: number) => `${n} at risk`,
    noAlerts: "No alerts",
    occurrences: "Occurrences", updatesPending: "Update pending",
    seeProjects: "See projects",
    dataQuality: "Data quality",
    dq: {
      sites_without_region: "site(s) without region", projects_without_end: "project(s) without planned end",
      projects_without_site: "project(s) without site", executing_without_tasks: "executing project(s) without tasks",
      technicians_without_job_title: "technician(s) without job title",
    } as Record<string, string>,
    filteredBy: "Filtered by", clearFilter: "Clear",
    exportCsv: "Export CSV",
    col: { project: "Project · Site", status: "Status", resp: "Owner", progress: "Actual x plan", end: "Planned end", deviation: "Deviation", techs: "Techs today", occ: "Occ.", update: "Update", health: "Health" },
    real: "actual", planned: "plan", noBase: "no baseline", notStarted: "not started",
    update: { sent: "sent", draft: "draft", missing: "pending" } as Record<string, string>,
    mapTitle: "Sites distribution", mapHint: "color = worst status · size = technicians",
    sitesWithoutCoords: (n: number) => `${n} site(s) with projects have no coordinates and are not on the map`,
    noCoords: "No sites with coordinates for the selected filters.",
    exceptionsTitle: "Exceptions requiring action", exceptionsOpen: (n: number) => `${n} open`,
    exceptionKinds: { all: "All", deadline: "Deadline", team: "Team", client: "Client", mobilization: "Mobilization" } as Record<ExceptionFilter, string>,
    noExceptions: "No exceptions for the selected filters.",
    actionProject: "Details", actionOperations: "Operations", actionUpdates: "Updates",
    drawerReal: "Actual", drawerPlanned: "Planned", drawerDeviation: "Deviation", drawerEnd: "Planned end", drawerTasks: "Tasks", drawerOverdue: "Overdue",
    drawerWhy: "Why", drawerTrend: "Progress last 7 days", drawerTrendEmpty: "No progress snapshots in the period.",
    drawerTeam: (n: number) => `Team on the project today · ${n}`, drawerTeamEmpty: "No technician dispatched today.",
    openProject: "Open project", openOperations: "Operations Center", close: "Close",
    noCanceled: "Progress excludes canceled tasks",
    noResponsible: "no owner",
    pp: "pp",
  },
  "es-ES": {
    eyebrow: "Central de Operaciones",
    title: "Gestión de Sitios",
    subtitle: (date: string, time: string) => `Vista consolidada · ${date} · actualizado a las ${time}`,
    refresh: "Actualizar",
    groupBy: "Agrupar por",
    groupByOptions: { site: "Sitio", region: "Regional", client: "Cliente", responsible: "Responsable" } as Record<SitesPanelGroupBy, string>,
    groupByHint: "Marca más de una opción para combinar los grupos (ej.: Regional · Cliente).",
    countryHint: "Marca uno o más países.",
    country: "País", allCountries: "Todos los países",
    countries: { BR: "Brasil", US: "EE. UU.", CL: "Chile", MX: "México" } as Record<string, string>,
    status: "Estado",
    statusOptions: { active: "Activos", paused: "Pausados", planning: "Planificación", finished: "Finalizados" } as Record<StatusKey, string>,
    statusHints: { active: "en curso", paused: "en espera de reanudación", planning: "en preparación", finished: "concluidos o cancelados" } as Record<StatusKey, string>,
    onlyAlerts: "Solo con alerta",
    tabs: { overview: "Vista general", analysis: "Análisis de proyectos", exceptions: "Regionales y excepciones" } as Record<Tab, string>,
    kpiStartingSoon: (n: number) => `${n} inician en hasta 7 días`,
    kpiLate: "Atrasados", kpiLateHint: (n: number) => `en ${n} grupo(s)`,
    kpiRisk: "Riesgo de atraso", kpiRiskHint: (n: number) => (n ? `${n} con inicio atrasado` : "real por debajo de lo planificado"),
    kpiPresent: "Técnicos presentes", kpiPresentHint: (n: number) => `${n} en ejecución ahora`,
    kpiAbsent: "Ausentes", kpiAbsentHint: (leave: number, nocheck: number) => `${leave} ausencia plan. · ${nocheck} sin check-in`,
    kpiUnproductive: "Improductivos", kpiUnproductiveHint: "sin tarea, sin acceso o esperando",
    loading: "Cargando panel...", error: "No fue posible cargar el panel.", retry: "Reintentar",
    empty: "Ningún proyecto activo o en planificación para los filtros elegidos.",
    noTechPermission: "Indicadores de técnicos ocultos: requiere acceso a la Central de Operaciones.",
    health: { late: "Crítico", risk: "Atención", ok: "En plazo", no_data: "Sin datos" } as Record<SitesPanelHealth, string>,
    healthProject: { late: "Atrasado", risk: "Riesgo", ok: "En plazo", no_data: "Sin datos" } as Record<SitesPanelHealth, string>,
    legend: "Leyenda",
    sortedBy: (n: number) => `${n} grupo(s) · ordenados por criticidad`,
    cExecution: "Ejecución", cPlanning: "Planificación",
    presentOf: (p: number, t: number) => `${p} presentes de ${t}`,
    noTechs: "Ningún técnico hoy",
    techLegend: { executing: "en ejecución", unproductive: "improductivo", break: "pausa", off_duty: "terminó", on_leave: "ausente", no_checkin: "sin check-in" } as Record<string, string>,
    statusAll: "Todos",
    statusShort: { active: "Activos", paused: "Pausados", planning: "Planif.", finished: "Finaliz." } as Record<StatusKey, string>,
    lateCount: (n: number) => (n === 1 ? "1 atrasado" : `${n} atrasados`),
    riskCount: (n: number) => `${n} en riesgo`,
    noAlerts: "Ninguna alerta",
    occurrences: "Ocurrencias", updatesPending: "Update pendiente",
    seeProjects: "Ver proyectos",
    dataQuality: "Calidad de registro",
    dq: {
      sites_without_region: "sitio(s) sin regional", projects_without_end: "proyecto(s) sin término previsto",
      projects_without_site: "proyecto(s) sin sitio", executing_without_tasks: "proyecto(s) en ejecución sin tareas",
      technicians_without_job_title: "técnico(s) sin cargo",
    } as Record<string, string>,
    filteredBy: "Filtrado por", clearFilter: "Limpiar",
    exportCsv: "Exportar CSV",
    col: { project: "Proyecto · Sitio", status: "Estado", resp: "Resp. CSTR", progress: "Real x planificado", end: "Término prev.", deviation: "Desvío", techs: "Técn. hoy", occ: "Ocurr.", update: "Update", health: "Salud" },
    real: "real", planned: "plan.", noBase: "sin base", notStarted: "no iniciado",
    update: { sent: "enviado", draft: "borrador", missing: "pendiente" } as Record<string, string>,
    mapTitle: "Distribución de los sitios", mapHint: "color = peor situación · tamaño = técnicos",
    sitesWithoutCoords: (n: number) => `${n} sitio(s) con proyecto sin coordenadas no aparecen en el mapa`,
    noCoords: "Ningún sitio con coordenadas para los filtros elegidos.",
    exceptionsTitle: "Excepciones que requieren acción", exceptionsOpen: (n: number) => `${n} abiertas`,
    exceptionKinds: { all: "Todas", deadline: "Plazo", team: "Equipo", client: "Cliente", mobilization: "Movilización" } as Record<ExceptionFilter, string>,
    noExceptions: "Ninguna excepción para los filtros elegidos.",
    actionProject: "Detalles", actionOperations: "Central", actionUpdates: "Actualizaciones",
    drawerReal: "Real", drawerPlanned: "Planificado", drawerDeviation: "Desvío", drawerEnd: "Término prev.", drawerTasks: "Tareas", drawerOverdue: "Vencidas",
    drawerWhy: "Por qué está así", drawerTrend: "Avance últimos 7 días", drawerTrendEmpty: "Sin registros de avance en el período.",
    drawerTeam: (n: number) => `Equipo en el proyecto hoy · ${n}`, drawerTeamEmpty: "Ningún técnico despachado hoy.",
    openProject: "Abrir proyecto", openOperations: "Central de Operaciones", close: "Cerrar",
    noCanceled: "Avance sin tareas canceladas",
    noResponsible: "sin responsable",
    pp: "pp",
  },
};

type PanelText = (typeof TEXT)["pt-BR"];

const HEALTH_COLOR: Record<SitesPanelHealth, string> = {
  late: "var(--red)",
  risk: "var(--amber)",
  ok: "var(--green)",
  no_data: "var(--text-faint)",
};
const HEALTH_SOFT: Record<SitesPanelHealth, string> = {
  late: "var(--red-soft)",
  risk: "var(--amber-soft)",
  ok: "var(--green-soft)",
  no_data: "var(--bg)",
};
const TECH_SEGMENTS: { key: keyof SitesPanelTechCounts; color: string }[] = [
  { key: "executing", color: "var(--green)" },
  { key: "unproductive", color: "var(--amber)" },
  { key: "break", color: "var(--blue)" },
  { key: "off_duty", color: "var(--purple)" },
  { key: "on_leave", color: "var(--red)" },
  { key: "no_checkin", color: "var(--text-faint)" },
];
const EXCEPTION_COLOR: Record<SitesPanelException["level"], string> = {
  late: "var(--red)",
  risk: "var(--amber)",
  info: "var(--blue)",
  neutral: "var(--text-faint)",
};

const STORAGE_KEY = "sites-panel:prefs";

function loadPrefs(): { tab?: Tab; groupBy?: SitesPanelGroupBy | SitesPanelGroupBy[]; status?: StatusKey[] } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePrefs(prefs: { tab: Tab; groupBy: SitesPanelGroupBy[]; status: StatusKey[] }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* armazenamento indisponível: preferência só vale nesta visita */
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}` : "—";
}

function fmtFullDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function HealthBadge({ health, label }: { health: SitesPanelHealth; label: string }) {
  return (
    <span className="badge" style={{ background: HEALTH_SOFT[health], color: HEALTH_COLOR[health] }}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function SitesPanel() {
  const p = usePageText(TEXT);
  const { user } = useAuth();
  const navigate = useNavigate();
  const prefs = useMemo(loadPrefs, []);
  const [tab, setTab] = useState<Tab>(prefs.tab ?? "overview");
  const [groupBy, setGroupBy] = useState<SitesPanelGroupBy[]>(() => {
    const saved = ([] as string[]).concat(prefs.groupBy ?? []).filter((k): k is SitesPanelGroupBy => GROUP_BY_KEYS.includes(k as SitesPanelGroupBy));
    return GROUP_BY_KEYS.filter((k) => saved.includes(k)).length ? GROUP_BY_KEYS.filter((k) => saved.includes(k)) : ["site"];
  });
  const [countries, setCountries] = useState<string[]>([]);
  const groupByParam = GROUP_BY_KEYS.filter((k) => groupBy.includes(k)).join(",");
  const countryParam = countries.join(",");
  const [statusKeys, setStatusKeys] = useState<StatusKey[]>(() => {
    const saved = (prefs.status ?? []).filter((k) => STATUS_KEYS.includes(k));
    return saved.length ? saved : DEFAULT_STATUS;
  });
  const statusParam = STATUS_KEYS.filter((k) => statusKeys.includes(k)).join(",");
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const [focusGroup, setFocusGroup] = useState<SitesPanelGroup | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [data, setData] = useState<SitesPanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    const params: Record<string, string> = { group_by: groupByParam };
    if (countryParam) params.country = countryParam;
    params.status = statusParam;
    dashboardApi
      .sites(params)
      .then((result) => {
        setData(result);
        setLoadedAt(new Date());
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [groupByParam, countryParam, statusParam]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    savePrefs({ tab, groupBy, status: statusKeys });
  }, [tab, groupBy, statusKeys]);

  // Ao trocar agrupamento/filtros, o grupo em foco deixa de existir.
  useEffect(() => {
    setFocusGroup(null);
  }, [groupByParam, countryParam, statusParam]);

  const projectsById = useMemo(() => new Map((data?.projects ?? []).map((pr) => [pr.id, pr])), [data]);
  const selectedProject = selectedProjectId != null ? projectsById.get(selectedProjectId) ?? null : null;

  const visibleGroups = useMemo(
    () => (data?.groups ?? []).filter((g) => !onlyAlerts || g.alerts.late + g.alerts.risk > 0),
    [data, onlyAlerts],
  );
  const visibleProjects = useMemo(() => {
    let rows = data?.projects ?? [];
    if (focusGroup) rows = rows.filter((r) => r.group_key === focusGroup.key);
    if (onlyAlerts) rows = rows.filter((r) => r.health === "late" || r.health === "risk");
    return rows;
  }, [data, focusGroup, onlyAlerts]);


  function openGroup(group: SitesPanelGroup) {
    setFocusGroup(group);
    setTab("analysis");
  }

  const canSeeOperations = hasPerm(user, PERMS.viewOperationsBoard);
  const today = data ? fmtFullDate(data.date) : "";
  const time = loadedAt ? loadedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="sp-page">
      <PageHeader
        eyebrow={p.eyebrow}
        title={p.title}
        subtitle={data ? p.subtitle(today, time) : undefined}
        actions={
          <button className="btn btn-outline" onClick={load} disabled={loading}>
            <Icon name="refresh" style={{ fontSize: 16 }} />
            {p.refresh}
          </button>
        }
      />

      {/* ---- Parte fixa: filtros ---- */}
      <div className="sp-filters">
        <MultiSelectFilter
          label={p.groupBy}
          hint={p.groupByHint}
          options={GROUP_BY_KEYS.map((k) => ({ value: k, label: p.groupByOptions[k] }))}
          selected={groupBy}
          onChange={(next) => setGroupBy(next as SitesPanelGroupBy[])}
          allLabel={p.groupByOptions.site}
          separator=" · "
          requireOne
        />
        <MultiSelectFilter
          label={p.country}
          hint={p.countryHint}
          options={Object.entries(p.countries).map(([code, label]) => ({ value: code, label }))}
          selected={countries}
          onChange={setCountries}
          allLabel={p.allCountries}
          clearLabel={p.clearFilter}
        />
        <MultiSelectFilter
          label={p.status}
          options={STATUS_KEYS.map((k) => ({ value: k, label: p.statusOptions[k], hint: p.statusHints[k] }))}
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

      {error && (
        <div className="card sp-message">
          {p.error}{" "}
          <button className="btn btn-sm btn-outline" onClick={load}>
            {p.retry}
          </button>
        </div>
      )}
      {loading && !data && !error && <div className="card sp-message">{p.loading}</div>}

      {data && (
        <>
          {/* ---- Parte fixa: indicadores ---- */}
          <KpiStrip data={data} p={p} statusKeys={statusKeys} />
          {!data.include_technicians && <p className="sp-note">{p.noTechPermission}</p>}

          {/* ---- Abas ---- */}
          <div className="tabs sp-tabs">
            {(Object.keys(p.tabs) as Tab[]).map((key) => (
              <button key={key} className={`tab-btn${tab === key ? " active" : ""}`} onClick={() => setTab(key)}>
                {p.tabs[key]}
                {key === "exceptions" && data.exceptions.length > 0 && <span className="sp-tab-count">{data.exceptions.length}</span>}
              </button>
            ))}
          </div>

          <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity 0.15s" }}>
            {data.projects.length === 0 ? (
              <div className="card sp-message">{p.empty}</div>
            ) : tab === "overview" ? (
              <OverviewTab data={data} groups={visibleGroups} p={p} onOpenGroup={openGroup} statusKeys={statusKeys} />
            ) : tab === "analysis" ? (
              <AnalysisTab
                projects={visibleProjects}
                groups={data.groups}
                focusGroup={focusGroup}
                onClearFocus={() => setFocusGroup(null)}
                onSelect={setSelectedProjectId}
                selectedId={selectedProjectId}
                p={p}
              />
            ) : (
              <ExceptionsTab
                data={data}
                p={p}
                onOpenProject={setSelectedProjectId}
                onNavigate={(to) => navigate(to)}
                canSeeOperations={canSeeOperations}
                onOpenSite={(siteId) => {
                  const group = data.groups.find((g) => g.key === `site:${siteId}`);
                  if (group) openGroup(group);
                  else setGroupBy(["site"]);
                }}
              />
            )}
          </div>
        </>
      )}

      {/* ---- Parte fixa: painel lateral ---- */}
      {selectedProject && (
        <ProjectDrawer
          project={selectedProject}
          p={p}
          canSeeOperations={canSeeOperations}
          showTeam={!!data?.include_technicians}
          onClose={() => setSelectedProjectId(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filtro de status (dropdown com checkbox)
// ---------------------------------------------------------------------------

const GROUP_BY_KEYS: SitesPanelGroupBy[] = ["region", "client", "site", "responsible"];

// ---------------------------------------------------------------------------
// Indicadores (parte fixa)
// ---------------------------------------------------------------------------

function KpiStrip({ data, p, statusKeys }: { data: SitesPanelData; p: PanelText; statusKeys: StatusKey[] }) {
  const s = data.summary;
  const t = s.technicians;
  const statusTiles: Record<StatusKey, { value: number; hint: string; color: string }> = {
    active: { value: s.in_progress, hint: p.statusHints.active, color: "var(--blue)" },
    paused: { value: s.paused, hint: p.statusHints.paused, color: "var(--amber)" },
    planning: { value: s.planning, hint: p.kpiStartingSoon(s.starting_soon), color: "var(--purple)" },
    finished: { value: s.finished, hint: p.statusHints.finished, color: "var(--green)" },
  };
  const tiles: { label: string; value: string | number; total?: number; hint: string; color: string; neutral?: boolean }[] = [
    ...STATUS_KEYS.filter((k) => statusKeys.includes(k)).map((k) => ({ label: p.statusOptions[k], ...statusTiles[k], neutral: true })),
    { label: p.kpiLate, value: s.late, hint: p.kpiLateHint(s.groups_with_late), color: "var(--red)" },
    { label: p.kpiRisk, value: s.risk, hint: p.kpiRiskHint(s.start_late), color: "var(--amber)" },
  ];
  if (t) {
    tiles.push(
      { label: p.kpiPresent, value: t.present, total: t.total, hint: p.kpiPresentHint(t.executing), color: "var(--green)" },
      { label: p.kpiAbsent, value: t.on_leave + t.no_checkin, hint: p.kpiAbsentHint(t.on_leave, t.no_checkin), color: "var(--red)" },
      { label: p.kpiUnproductive, value: t.unproductive, hint: p.kpiUnproductiveHint, color: "var(--amber)" },
    );
  }
  return (
    <div className="sp-kpis">
      {tiles.map((tile) => (
        <div key={tile.label} className="sp-kpi" style={{ borderLeftColor: tile.color }}>
          <div className="stat-label">{tile.label}</div>
          <div className="sp-kpi-value">
            <span style={{ color: tile.neutral ? "var(--text)" : tile.color }}>
              {tile.value}
            </span>
            {tile.total != null && <small> / {tile.total}</small>}
          </div>
          <div className="stat-hint">{tile.hint}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba 1 — Visão geral (cards)
// ---------------------------------------------------------------------------

function TechBar({ counts }: { counts: SitesPanelTechCounts }) {
  if (!counts.total) return null;
  return (
    <div className="sp-techbar">
      {TECH_SEGMENTS.map((seg) =>
        counts[seg.key] ? (
          <span key={seg.key} style={{ width: `${(counts[seg.key] / counts.total) * 100}%`, background: seg.color }} />
        ) : null,
      )}
    </div>
  );
}

function OverviewTab({
  data,
  groups,
  p,
  onOpenGroup,
  statusKeys,
}: {
  data: SitesPanelData;
  groups: SitesPanelGroup[];
  p: PanelText;
  onOpenGroup: (g: SitesPanelGroup) => void;
  statusKeys: StatusKey[];
}) {
  const shownStatus = STATUS_KEYS.filter((k) => statusKeys.includes(k));
  const dq = data.summary.data_quality;
  const dqItems = Object.entries(dq).filter(([key, value]) => key !== "total" && value);
  return (
    <>
      <div className="sp-legend">
        <span>{p.sortedBy(groups.length)}</span>
        <span>
          {p.legend}:{" "}
          {(["late", "risk", "ok", "no_data"] as SitesPanelHealth[]).map((h) => (
            <span key={h} className="sp-legend-item">
              <i style={{ background: HEALTH_COLOR[h] }} />
              {p.health[h]}
            </span>
          ))}
        </span>
      </div>
      <div className="sp-cards">
        {groups.map((g) => {
          const alerts = g.alerts.late + g.alerts.risk;
          return (
            <button key={g.key} className="sp-card card" style={{ borderTopColor: HEALTH_COLOR[g.health] }} onClick={() => onOpenGroup(g)}>
              <div className="sp-card-head">
                <div>
                  <div className="sp-card-title">{g.label}</div>
                  {g.sublabel && <div className="sp-card-sub">{g.sublabel}</div>}
                </div>
                <HealthBadge health={g.health} label={p.health[g.health]} />
              </div>
              <div className="sp-counts" style={{ gridTemplateColumns: `repeat(${shownStatus.length}, 1fr)` }}>
                {shownStatus.map((k) => (
                  <div key={k}>
                    <b>{g.projects[GROUP_COUNT_FIELD[k]]}</b>
                    <span>{shownStatus.length >= 4 ? p.statusShort[k] : p.statusOptions[k]}</span>
                  </div>
                ))}
              </div>
              {g.technicians && (
                <div className="sp-card-techs">
                  <div className="sp-card-row">
                    <span>{g.technicians.total ? p.presentOf(g.technicians.present, g.technicians.total) : p.noTechs}</span>
                    <span className="sp-muted">{g.responsibles[0] ?? p.noResponsible}{g.responsibles.length > 1 ? ` +${g.responsibles.length - 1}` : ""}</span>
                  </div>
                  <TechBar counts={g.technicians} />
                  <div className="sp-tech-legend">
                    {TECH_SEGMENTS.filter((seg) => g.technicians![seg.key]).map((seg) => (
                      <span key={seg.key}>
                        <i style={{ background: seg.color }} />
                        {g.technicians![seg.key]} {p.techLegend[seg.key]}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="sp-card-foot">
                <span style={{ fontWeight: 600 }}>
                  {alerts ? (
                    <>
                      <span style={{ color: g.alerts.late ? HEALTH_COLOR.late : "var(--text-faint)" }}>{p.lateCount(g.alerts.late)}</span>
                      {" · "}
                      <span style={{ color: g.alerts.risk ? HEALTH_COLOR.risk : "var(--text-faint)" }}>{p.riskCount(g.alerts.risk)}</span>
                    </>
                  ) : (
                    <span style={{ color: "var(--green)" }}>{p.noAlerts}</span>
                  )}
                </span>
                <span>
                  {p.occurrences} <b>{g.occurrences_open}</b> · {p.updatesPending} <b>{g.updates_pending}</b>
                </span>
              </div>
            </button>
          );
        })}
        {dqItems.length > 0 && (
          <div className="sp-card card sp-card-dq">
            <div className="sp-card-title">
              <Icon name="fact_check" style={{ fontSize: 16, verticalAlign: "-3px", marginRight: 6 }} />
              {p.dataQuality}
            </div>
            <ul>
              {dqItems.map(([key, value]) => (
                <li key={key}>
                  <b>{value}</b> {p.dq[key]}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Aba 2 — Análise de projetos (tabela)
// ---------------------------------------------------------------------------

function ProgressCell({ project, p }: { project: SitesPanelProject; p: PanelText }) {
  if (project.real_pct == null || (project.tasks_completed === 0 && project.status !== "in_progress" && project.status !== "paused")) {
    return <span className="sp-muted">{p.notStarted}</span>;
  }
  const color = HEALTH_COLOR[project.health === "no_data" ? "ok" : project.health];
  return (
    <div className="sp-progress" title={p.noCanceled}>
      <div className="sp-progress-track">
        <div className="sp-progress-fill" style={{ width: `${project.real_pct}%`, background: color }} />
        {project.planned_pct != null && <div className="sp-progress-mark" style={{ left: `${project.planned_pct}%` }} />}
      </div>
      <div className="sp-progress-label">
        {project.real_pct}% {p.real} · {project.planned_pct != null ? `${project.planned_pct}% ${p.planned}` : p.noBase}
      </div>
    </div>
  );
}

function exportCsv(projects: SitesPanelProject[], p: PanelText) {
  const header = [p.col.project, "Site", p.col.status, p.col.resp, `${p.drawerReal} %`, `${p.drawerPlanned} %`, p.col.deviation, p.col.end, p.col.techs, p.col.occ, p.col.update, p.col.health, p.drawerWhy];
  const lines = projects.map((r) => [
    `${r.code} ${r.name}`,
    r.site ? `${r.site.code} ${r.site.name}`.trim() : "",
    r.status_display,
    r.responsible_cstr?.name ?? "",
    r.real_pct ?? "",
    r.planned_pct ?? "",
    r.deviation_pp ?? "",
    r.planned_end ?? "",
    r.technicians_today.length,
    r.occurrences_open,
    r.update_status ? p.update[r.update_status] : "",
    p.healthProject[r.health],
    r.reasons.map((x) => x.text).join(" | "),
  ]);
  const csv = [header, ...lines]
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gestao-sites-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function AnalysisTab({
  projects,
  groups,
  focusGroup,
  onClearFocus,
  onSelect,
  selectedId,
  p,
}: {
  projects: SitesPanelProject[];
  groups: SitesPanelGroup[];
  focusGroup: SitesPanelGroup | null;
  onClearFocus: () => void;
  onSelect: (id: number) => void;
  selectedId: number | null;
  p: PanelText;
}) {
  const healthRank: Record<SitesPanelHealth, number> = { late: 0, risk: 1, no_data: 2, ok: 3 };
  // Filtro por coluna (clicar no título): vale para todos os grupos da tabela.
  const { filtered: visibleProjects, filters: colFilters } = useColumnFilters<SitesPanelProject>(projects, {
    project: (r) => r.name,
    status: (r) => r.status_display,
    resp: (r) => r.responsible_cstr?.name ?? "—",
    progress: (r) => (r.real_pct == null ? p.notStarted : `${r.real_pct}%`),
    end: (r) => fmtDate(r.planned_end),
    deviation: (r) => (r.deviation_pp != null ? `${r.deviation_pp > 0 ? "−" : "+"}${Math.abs(r.deviation_pp)} ${p.pp}` : "—"),
    techs: (r) => String(r.technicians_today.length),
    occ: (r) => String(r.occurrences_open),
    update: (r) => (r.update_status ? p.update[r.update_status] : "—"),
    health: (r) => p.healthProject[r.health],
  });
  const grouped = groups
    .map((g) => ({
      group: g,
      rows: visibleProjects
        .filter((r) => r.group_key === g.key)
        .sort((a, b) => healthRank[a.health] - healthRank[b.health] || (b.deviation_pp ?? -99) - (a.deviation_pp ?? -99)),
    }))
    .filter((x) => x.rows.length > 0);

  return (
    <div className="card sp-table-card">
      <div className="sp-table-toolbar">
        <div>
          {focusGroup && (
            <span className="sp-chip">
              {p.filteredBy}: <b>{focusGroup.label}</b>
              <button onClick={onClearFocus} aria-label={p.clearFilter}>
                <Icon name="close" style={{ fontSize: 14 }} />
              </button>
            </span>
          )}
        </div>
        <button className="btn btn-sm btn-outline" onClick={() => exportCsv(visibleProjects, p)}>
          <Icon name="download" style={{ fontSize: 16 }} />
          {p.exportCsv}
        </button>
      </div>
      <div className="table-wrap">
        <table className="table sp-table">
          <thead>
            <tr>
              <FilterTh colKey="project" label={p.col.project} filters={colFilters} />
              <FilterTh colKey="status" label={p.col.status} filters={colFilters} />
              <FilterTh colKey="resp" label={p.col.resp} filters={colFilters} />
              <FilterTh colKey="progress" label={p.col.progress} filters={colFilters} />
              <FilterTh colKey="end" label={p.col.end} filters={colFilters} />
              <FilterTh colKey="deviation" label={p.col.deviation} filters={colFilters} style={{ textAlign: "right" }} align="right" />
              <FilterTh colKey="techs" label={p.col.techs} filters={colFilters} style={{ textAlign: "right" }} align="right" />
              <FilterTh colKey="occ" label={p.col.occ} filters={colFilters} style={{ textAlign: "right" }} align="right" />
              <FilterTh colKey="update" label={p.col.update} filters={colFilters} />
              <FilterTh colKey="health" label={p.col.health} filters={colFilters} />
            </tr>
          </thead>
          {grouped.map(({ group, rows }) => (
            <tbody key={group.key}>
              <tr className="sp-group-row">
                <td colSpan={10}>
                  <b className="sp-group-label">{group.label}</b>
                  <span className="sp-muted"> · {rows.length}</span>
                  {group.alerts.late + group.alerts.risk > 0 && (
                    <span style={{ color: HEALTH_COLOR[group.alerts.late ? "late" : "risk"], marginLeft: 12, fontWeight: 600 }}>
                      {group.alerts.late} {p.healthProject.late.toLowerCase()} · {group.alerts.risk} {p.healthProject.risk.toLowerCase()}
                    </span>
                  )}
                  {group.technicians && (
                    <span className="sp-muted" style={{ float: "right" }}>
                      {p.presentOf(group.technicians.present, group.technicians.total)}
                    </span>
                  )}
                </td>
              </tr>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`sp-row${selectedId === r.id ? " selected" : ""}`}
                  onClick={() => onSelect(r.id)}
                  style={{ boxShadow: r.health === "late" || r.health === "risk" ? `inset 3px 0 0 ${HEALTH_COLOR[r.health]}` : undefined }}
                >
                  <td>
                    <div className="sp-cell-title">{r.name}</div>
                    <div className="sp-muted">
                      {r.code}
                      {r.site ? ` · ${r.site.code || r.site.name}` : ""}
                    </div>
                  </td>
                  <td>
                    <span className={`badge sp-status sp-status-${r.status}`}>{r.status_display}</span>
                  </td>
                  <td>{r.responsible_cstr?.name ?? <span className="sp-muted">—</span>}</td>
                  <td>
                    <ProgressCell project={r} p={p} />
                  </td>
                  <td>{fmtDate(r.planned_end)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600, color: r.deviation_pp != null && r.deviation_pp >= 5 ? HEALTH_COLOR[r.deviation_pp >= 15 ? "late" : "risk"] : "var(--text-muted)" }}>
                    {r.deviation_pp != null ? `${r.deviation_pp > 0 ? "−" : "+"}${Math.abs(r.deviation_pp)} ${p.pp}` : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>{r.technicians_today.length}</td>
                  <td style={{ textAlign: "right", color: r.occurrences_severe ? "var(--red)" : undefined, fontWeight: r.occurrences_severe ? 700 : undefined }}>
                    {r.occurrences_open}
                  </td>
                  <td>
                    {r.update_status ? (
                      <span className={`sp-update sp-update-${r.update_status}`}>{p.update[r.update_status]}</span>
                    ) : (
                      <span className="sp-muted">—</span>
                    )}
                  </td>
                  <td>
                    <HealthBadge health={r.health} label={p.healthProject[r.health]} />
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba 3 — Regionais e exceções (mapa + fila)
// ---------------------------------------------------------------------------

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function SitesMapView({ data, p, onOpenSite }: { data: SitesPanelData; p: PanelText; onOpenSite: (id: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const onOpenSiteRef = useRef(onOpenSite);
  onOpenSiteRef.current = onOpenSite;

  const sitesWithProjects = new Set(data.projects.map((r) => r.site?.id).filter(Boolean)).size;
  const missing = Math.max(sitesWithProjects - data.sites.length, 0);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current).setView([-15.78, -47.93], 4);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(mapRef.current);
    }
    const map = mapRef.current;
    const layer = L.layerGroup().addTo(map);
    const colors: Record<SitesPanelHealth, string> = {
      late: cssVar("--red", "#dc2626"),
      risk: cssVar("--amber", "#d97706"),
      ok: cssVar("--green", "#16a34a"),
      no_data: cssVar("--text-faint", "#9aa3b2"),
    };
    data.sites.forEach((site) => {
      const radius = 8 + Math.min(site.technicians_total, 30) * 0.6;
      const marker = L.circleMarker([site.lat, site.lng], {
        radius,
        color: "#fff",
        weight: 2,
        fillColor: colors[site.health],
        fillOpacity: 0.9,
      }).addTo(layer);
      const lines = [
        `<strong>${escapeHtml(site.label)}</strong>`,
        `<span style="color:#6b7a90">${escapeHtml(site.region)}</span>`,
        `${site.in_execution} ${escapeHtml(p.cExecution.toLowerCase())} · ${site.planning} ${escapeHtml(p.cPlanning.toLowerCase())}`,
        site.late || site.risk
          ? `<span style="color:${colors.late}">${site.late} ${escapeHtml(p.healthProject.late.toLowerCase())}</span> · <span style="color:${colors.risk}">${site.risk} ${escapeHtml(p.healthProject.risk.toLowerCase())}</span>`
          : "",
        data.include_technicians ? escapeHtml(p.presentOf(site.technicians_present, site.technicians_total)) : "",
        `<a href="#" data-site="${site.id}">${escapeHtml(p.seeProjects)} →</a>`,
      ].filter(Boolean);
      marker.bindPopup(lines.join("<br/>"));
      marker.on("popupopen", (e) => {
        const link = (e.popup.getElement() as HTMLElement | undefined)?.querySelector("a[data-site]");
        link?.addEventListener("click", (ev) => {
          ev.preventDefault();
          onOpenSiteRef.current(site.id);
        });
      });
    });
    map.invalidateSize();
    if (data.sites.length) {
      const bounds = L.latLngBounds(data.sites.map((s) => [s.lat, s.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }
    return () => {
      layer.remove();
    };
  }, [data, p]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  return (
    <div className="card sp-map-card">
      <div className="sp-section-head">
        <b>{p.mapTitle}</b>
        <span className="sp-muted">{p.mapHint}</span>
      </div>
      <div className="sp-map-wrap">
        <div ref={containerRef} className="sp-map" />
        {data.sites.length === 0 && <div className="sp-map-empty">{p.noCoords}</div>}
      </div>
      {missing > 0 && <div className="sp-map-foot sp-muted">{p.sitesWithoutCoords(missing)}</div>}
    </div>
  );
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function ExceptionsTab({
  data,
  p,
  onOpenProject,
  onNavigate,
  onOpenSite,
  canSeeOperations,
}: {
  data: SitesPanelData;
  p: PanelText;
  onOpenProject: (id: number) => void;
  onNavigate: (to: string) => void;
  onOpenSite: (id: number) => void;
  canSeeOperations: boolean;
}) {
  const [filter, setFilter] = useState<ExceptionFilter>("all");
  const counts = data.exceptions.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});
  const items = data.exceptions.filter((e) => filter === "all" || e.kind === filter);

  function actionFor(e: SitesPanelException) {
    if (e.action.type === "project" && e.action.project_id) {
      return { label: p.actionProject, run: () => onOpenProject(e.action.project_id!) };
    }
    if (e.action.type === "operations" && canSeeOperations) {
      return { label: p.actionOperations, run: () => onNavigate("/operacao-do-dia") };
    }
    if (e.action.type === "updates") {
      return { label: p.actionUpdates, run: () => onNavigate("/atualizacoes-projeto") };
    }
    return null;
  }

  return (
    <div className="sp-exceptions-layout">
      <SitesMapView data={data} p={p} onOpenSite={onOpenSite} />
      <div className="card sp-exceptions">
        <div className="sp-section-head">
          <b>{p.exceptionsTitle}</b>
          {data.exceptions.length > 0 && <span className="badge" style={{ background: "var(--red-soft)", color: "var(--red)" }}>{p.exceptionsOpen(data.exceptions.length)}</span>}
        </div>
        <div className="sp-exc-filters">
          {(Object.keys(p.exceptionKinds) as ExceptionFilter[]).map((key) => {
            const n = key === "all" ? data.exceptions.length : counts[key] ?? 0;
            if (key !== "all" && !n) return null;
            return (
              <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>
                {p.exceptionKinds[key]} {n}
              </button>
            );
          })}
        </div>
        {items.length === 0 ? (
          <div className="sp-message">{p.noExceptions}</div>
        ) : (
          <ul className="sp-exc-list">
            {items.map((e, i) => {
              const action = actionFor(e);
              return (
                <li key={i} style={{ borderLeftColor: EXCEPTION_COLOR[e.level] }}>
                  <div>
                    <div className="sp-cell-title">{e.title}</div>
                    {e.detail && <div className="sp-muted">{e.detail}</div>}
                  </div>
                  {action && (
                    <button className="sp-link" onClick={action.run}>
                      {action.label}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel lateral (parte fixa)
// ---------------------------------------------------------------------------

function Trend({ points }: { points: { date: string; percent: number }[] }) {
  const w = 300;
  const h = 70;
  const xs = points.map((_, i) => (points.length === 1 ? w / 2 : (i / (points.length - 1)) * (w - 16) + 8));
  const ys = points.map((pt) => h - 8 - (pt.percent / 100) * (h - 16));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="sp-trend" role="img">
      <line x1="0" x2={w} y1={h - 8} y2={h - 8} stroke="var(--border)" />
      <polyline fill="none" stroke="var(--blue)" strokeWidth="2" points={xs.map((x, i) => `${x},${ys[i]}`).join(" ")} />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r="3" fill="var(--blue)">
          <title>{`${fmtDate(points[i].date)}: ${points[i].percent}%`}</title>
        </circle>
      ))}
      <text x="8" y="12" fontSize="10" fill="var(--text-faint)">{fmtDate(points[0].date)}</text>
      <text x={w - 8} y="12" fontSize="10" fill="var(--text-faint)" textAnchor="end">
        {fmtDate(points[points.length - 1].date)}
      </text>
    </svg>
  );
}

function ProjectDrawer({
  project,
  p,
  canSeeOperations,
  showTeam,
  onClose,
}: {
  project: SitesPanelProject;
  p: PanelText;
  canSeeOperations: boolean;
  showTeam: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tiles = [
    { label: p.drawerReal, value: project.real_pct != null ? `${project.real_pct}%` : "—" },
    { label: p.drawerPlanned, value: project.planned_pct != null ? `${project.planned_pct}%` : p.noBase },
    {
      label: p.drawerDeviation,
      value: project.deviation_pp != null ? `${project.deviation_pp > 0 ? "−" : "+"}${Math.abs(project.deviation_pp)} ${p.pp}` : "—",
      color: project.deviation_pp != null && project.deviation_pp >= 5 ? HEALTH_COLOR[project.deviation_pp >= 15 ? "late" : "risk"] : undefined,
    },
    { label: p.drawerEnd, value: fmtDate(project.planned_end), color: project.reasons.some((r) => r.code === "end_passed") ? "var(--red)" : undefined },
    { label: p.drawerTasks, value: `${project.tasks_completed}/${project.tasks_total}` },
    { label: p.drawerOverdue, value: project.tasks_overdue, color: project.tasks_overdue ? "var(--amber)" : undefined },
  ];

  return (
    <>
      <div className="sp-drawer-backdrop" onClick={onClose} />
      <aside className="sp-drawer" role="dialog" aria-label={project.name}>
        <div className="sp-drawer-head">
          <div>
            <div className="sp-muted">
              {project.code}
              {project.site ? ` · ${project.site.code || project.site.name}` : ""}
            </div>
            <h2>{project.name}</h2>
            <div className="sp-muted">
              {[project.client?.name, project.responsible_cstr?.name].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <HealthBadge health={project.health} label={p.healthProject[project.health]} />
            <button className="sp-icon-btn" onClick={onClose} aria-label={p.close}>
              <Icon name="close" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>
        <div className="sp-drawer-tiles" title={p.noCanceled}>
          {tiles.map((tile) => (
            <div key={tile.label}>
              <span>{tile.label}</span>
              <b style={{ color: tile.color }}>{tile.value}</b>
            </div>
          ))}
        </div>
        {project.reasons.length > 0 && (
          <section>
            <h3>{p.drawerWhy}</h3>
            <ul className="sp-reasons">
              {project.reasons.map((r) => (
                <li key={r.code + r.text}>
                  <i style={{ background: HEALTH_COLOR[r.level] }} />
                  {r.text}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h3>{p.drawerTrend}</h3>
          {project.trend.length ? <Trend points={project.trend} /> : <div className="sp-muted">{p.drawerTrendEmpty}</div>}
        </section>
        {showTeam && (
          <section>
            <h3>{p.drawerTeam(project.technicians_today.length)}</h3>
            {project.technicians_today.length === 0 ? (
              <div className="sp-muted">{p.drawerTeamEmpty}</div>
            ) : (
              <ul className="sp-team">
                {project.technicians_today.map((t) => (
                  <li key={t.id}>
                    <span>{t.name}</span>
                    <span className={`sp-tech-status sp-tech-${t.category}`}>{t.status_display}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <div className="sp-drawer-actions">
          <Link className="btn btn-primary btn-sm" to={`/projetos/${project.id}`}>
            {p.openProject}
          </Link>
          {canSeeOperations && (
            <Link className="btn btn-outline btn-sm" to="/operacao-do-dia">
              {p.openOperations}
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}
