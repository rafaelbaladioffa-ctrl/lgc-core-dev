import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { operationsApi, sitesApi, type Site } from "../api/resources";
import type {
  OperationsBoard as OperationsBoardData,
  OperationsBoardTask,
  OperationsBoardTechnician,
  StatusEvent,
  TimelineBlock,
} from "../api/types";
import TechnicianAbsenceFormModal from "../components/projects/TechnicianAbsenceFormModal";
import DateInput from "../components/ui/DateInput";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import StatCard from "../components/ui/StatCard";
import { useI18n, usePageText } from "../i18n";
import {
  AWAY_STATUSES,
  BUSY_COLOR,
  DONE_COLOR,
  HOURS,
  PRESENCE_COLOR,
  WINDOW_END_HOUR,
  WINDOW_START_HOUR,
  assignLanes,
  buildTechSegments,
  collapseLanes,
  formatTime,
  groupByPair,
  initials,
  pairRowClass,
  pct,
  presenceLabel,
  reorderRowsByPair,
} from "../utils/timeline";

const TEXT = {
  "pt-BR": {
    eyebrow: "Central de Operações",
    title: "Operação do Dia",
    subtitleToday: "Pool de atividades, técnicos e timeline em tempo real",
    subtitleDate: (date: string) => `Visualizando ${date}`,
    today: "Hoje",
    allSites: "Todos os sites",
    statPlanned: "Atividades Planejadas",
    statActive: "Em Execução",
    statCompleted: "Concluídas",
    statPending: "Pendentes",
    statOnSite: "Técnicos no Site",
    statAbsent: "Técnicos Ausentes",
    progressLabel: "Progresso do Dia",
    techCardTitle: "Técnicos",
    techCardHint: (n: number) => `${n} no site hoje`,
    pairLabel: "Dupla",
    statusInProgress: "Em execução",
    statusPaused: "Pausado",
    openTasks: (n: number) => ` · ${n} tarefas abertas`,
    poolTitle: "Pool de Atividades do Dia",
    poolHint: (n: number) => `${n} pendentes`,
    dispatchSelectTech: "Selecione um técnico disponível na coluna ao lado",
    dispatchTechsSelected: (n: number) => `${n} técnico(s) selecionado(s)`,
    tasksSelected: (n: number) => `${n} ${n === 1 ? "atividade selecionada" : "atividades selecionadas"}`,
    clearSelection: "Limpar seleção",
    multiSelectHint: "Marque tarefas para selecionar várias; Ctrl+clique e Shift+clique também funcionam no desktop.",
    selectTask: (name: string) => `Selecionar ${name}`,
    deselectTask: (name: string) => `Desmarcar ${name}`,
    packagePartial: "Pacote parcialmente selecionado",
    dispatchError: "Não foi possível despachar. Verifique a conexão e tente novamente.",
    dispatching: "Despachando...",
    dispatch: "Despachar",
    colActivity: "Atividade",
    colProject: "Projeto",
    colSite: "Site",
    colDuration: "Duração Est.",
    colStatus: "Status",
    colActions: "Ações",
    badgeDispatched: (names: string) => `Despachada · ${names}`,
    badgeWaiting: "Aguardando despacho",
    dispatchBtn: "Despachar",
    removing: "Removendo...",
    removeDispatch: "Remover Despacho",
    noPoolActivity: "Nenhuma atividade pendente neste site.",
    expandAll: "Expandir todos", collapseAll: "Recolher todos",
    projectActivities: (n: number) => `${n} ${n === 1 ? "atividade" : "atividades"}`,
    packageTasks: (n: number) => `${n} ${n === 1 ? "tarefa" : "tarefas"}`,
    poolGroupBy: "Agrupar por",
    poolModePackage: "Pacote (atividade + material)",
    poolModeCable: "Cabo (workflow)",
    poolModeActivity: "Atividade (todos os materiais)",
    allMaterials: "Todos os materiais",
    cableSteps: (n: number) => `${n} ${n === 1 ? "etapa" : "etapas"}`,
    packageSelect: "Selecionar pacote",
    packageSelected: "Pacote selecionado",
    packageReady: "Pronto",
    packageBlocked: (n: number) => `${n} aguardando etapa anterior`,
    taskBlocked: (names: string) => `Aguarda: ${names}`,
    noGroup: "Sem grupo",
    noActivity: "Sem atividade do catálogo",
    projectWaiting: (n: number) => `${n} aguardando`, projectDispatched: (n: number) => `${n} despachada${n === 1 ? "" : "s"}`,
    expandProject: "Expandir projeto", collapseProject: "Recolher projeto",
    techniciansLabel: (n: number) => `TÉCNICOS (${n})`,
    rowStats: (done: number, doneLabel: string, pending: number, pendingLabel: string) =>
      `${done} ${doneLabel} · ${pending} ${pendingLabel}`,
    finishedSingular: "finalizada",
    finishedPlural: "finalizadas",
    pendingSingular: "pendente",
    pendingPlural: "pendentes",
    inProgress: " – em andamento",
    closeLabel: "Fechar",
    legendDone: "Concluída",
    legendInProgress: "Em execução",
    legendAvailable: "Disponível",
    legendPaused: "Pausa",
    legendLunch: "Horário de Almoço",
    legendPersonal: "Particular",
    legendMeal: "Café",
    legendMeeting: "Reunião",
    legendTraveling: "Em Deslocamento",
    legendSupport: "Apoio a outro técnico",
    expandLanes: (n: number) => `▾ +${n} simultâneas`,
    collapseLanes: "▴ Recolher",
    legendSiteBlocked: "Sem Acesso ao Site",
    legendAwaiting: "Aguardando Liberações",
    legendNotStarted: "Não iniciado / Fim de Expediente",
    sidePanelTitle: "Próximas atividades / Operações",
    othersLabel: (n: number) => `Outros técnicos (${n})`,
    noQueueActivity: "Nenhuma atividade pendente na fila.",
    viewAll: "Ver todas as atividades do dia",
    footerHint: "Clique em uma atividade para ver detalhes completos.",
    confirmUndispatch: "Remover o despacho dessa tarefa? Os técnicos voltam a ficar disponíveis pro pool.",
    returnToPool: "Devolver ao pool",
    confirmReturnToPool: "Devolver essa tarefa ao pool para este técnico? O despacho dele é removido e o tempo que ele já apontou (início, pausas e horas) é zerado. Os demais técnicos da tarefa não são afetados.",
    absenceTitle: "Ausências planejadas (férias, atestado, folga)",
    noTechLinked: "Nenhum técnico vinculado a este site.",
    noTechLoggedIn: "Nenhum técnico fez login nesta data.",
    loading: "Carregando...",
  },
  "en-US": {
    eyebrow: "Operations Center",
    title: "Day Operations",
    subtitleToday: "Activity pool, technicians and real-time timeline",
    subtitleDate: (date: string) => `Viewing ${date}`,
    today: "Today",
    allSites: "All sites",
    statPlanned: "Planned Activities",
    statActive: "In Progress",
    statCompleted: "Completed",
    statPending: "Pending",
    statOnSite: "On-Site Technicians",
    statAbsent: "Absent Technicians",
    progressLabel: "Day Progress",
    techCardTitle: "Technicians",
    techCardHint: (n: number) => `${n} on site today`,
    pairLabel: "Pair",
    statusInProgress: "In progress",
    statusPaused: "Paused",
    openTasks: (n: number) => ` · ${n} open tasks`,
    poolTitle: "Day Activity Pool",
    poolHint: (n: number) => `${n} pending`,
    dispatchSelectTech: "Select an available technician in the column to the right",
    dispatchTechsSelected: (n: number) => `${n} technician(s) selected`,
    tasksSelected: (n: number) => `${n} ${n === 1 ? "activity selected" : "activities selected"}`,
    clearSelection: "Clear selection",
    multiSelectHint: "Check tasks to select several; Ctrl+click and Shift+click also work on desktop.",
    selectTask: (name: string) => `Select ${name}`,
    deselectTask: (name: string) => `Deselect ${name}`,
    packagePartial: "Package partially selected",
    dispatchError: "Dispatch failed. Check your connection and try again.",
    dispatching: "Dispatching...",
    dispatch: "Dispatch",
    colActivity: "Activity",
    colProject: "Project",
    colSite: "Site",
    colDuration: "Est. Duration",
    colStatus: "Status",
    colActions: "Actions",
    badgeDispatched: (names: string) => `Dispatched · ${names}`,
    badgeWaiting: "Awaiting dispatch",
    dispatchBtn: "Dispatch",
    removing: "Removing...",
    removeDispatch: "Remove Dispatch",
    noPoolActivity: "No pending activities at this site.",
    expandAll: "Expand all", collapseAll: "Collapse all",
    projectActivities: (n: number) => `${n} ${n === 1 ? "activity" : "activities"}`,
    packageTasks: (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`,
    poolGroupBy: "Group by",
    poolModePackage: "Package (activity + material)",
    poolModeCable: "Cable (workflow)",
    poolModeActivity: "Activity (all materials)",
    allMaterials: "All materials",
    cableSteps: (n: number) => `${n} ${n === 1 ? "step" : "steps"}`,
    packageSelect: "Select package",
    packageSelected: "Package selected",
    packageReady: "Ready",
    packageBlocked: (n: number) => `${n} waiting for previous step`,
    taskBlocked: (names: string) => `Waiting for: ${names}`,
    noGroup: "No group",
    noActivity: "No catalog activity",
    projectWaiting: (n: number) => `${n} waiting`, projectDispatched: (n: number) => `${n} dispatched`,
    expandProject: "Expand project", collapseProject: "Collapse project",
    techniciansLabel: (n: number) => `TECHNICIANS (${n})`,
    rowStats: (done: number, doneLabel: string, pending: number, pendingLabel: string) =>
      `${done} ${doneLabel} · ${pending} ${pendingLabel}`,
    finishedSingular: "completed",
    finishedPlural: "completed",
    pendingSingular: "pending",
    pendingPlural: "pending",
    inProgress: " – in progress",
    closeLabel: "Close",
    legendDone: "Completed",
    legendInProgress: "In progress",
    legendAvailable: "Available",
    legendPaused: "Paused",
    legendLunch: "Lunch Break",
    legendPersonal: "Personal",
    legendMeal: "Coffee Break",
    legendMeeting: "Meeting",
    legendTraveling: "Traveling",
    legendSupport: "Supporting another technician",
    expandLanes: (n: number) => `▾ +${n} concurrent`,
    collapseLanes: "▴ Collapse",
    legendSiteBlocked: "No Site Access",
    legendAwaiting: "Awaiting Releases",
    legendNotStarted: "Not started / End of Shift",
    sidePanelTitle: "Upcoming activities / Operations",
    othersLabel: (n: number) => `Other technicians (${n})`,
    noQueueActivity: "No pending activities in queue.",
    viewAll: "View all activities for the day",
    footerHint: "Click an activity to see full details.",
    confirmUndispatch: "Remove the dispatch for this task? Technicians will return to the pool.",
    returnToPool: "Return to pool",
    confirmReturnToPool: "Return this task to the pool for this technician? Their dispatch is removed and the time they already logged (start, pauses and hours) is reset. Other technicians on the task are not affected.",
    absenceTitle: "Planned absences (vacation, sick leave, day off)",
    noTechLinked: "No technician linked to this site.",
    noTechLoggedIn: "No technician has logged in on this date.",
    loading: "Loading...",
  },
  "es-ES": {
    eyebrow: "Central de Operaciones",
    title: "Operación del Día",
    subtitleToday: "Grupo de actividades, técnicos y línea de tiempo en tiempo real",
    subtitleDate: (date: string) => `Visualizando ${date}`,
    today: "Hoy",
    allSites: "Todos los sitios",
    statPlanned: "Actividades Planificadas",
    statActive: "En Ejecución",
    statCompleted: "Completadas",
    statPending: "Pendientes",
    statOnSite: "Técnicos en Sitio",
    statAbsent: "Técnicos Ausentes",
    progressLabel: "Progreso del Día",
    techCardTitle: "Técnicos",
    techCardHint: (n: number) => `${n} en sitio hoy`,
    pairLabel: "Dupla",
    statusInProgress: "En ejecución",
    statusPaused: "Pausado",
    openTasks: (n: number) => ` · ${n} tareas abiertas`,
    poolTitle: "Grupo de Actividades del Día",
    poolHint: (n: number) => `${n} pendientes`,
    dispatchSelectTech: "Seleccione un técnico disponible en la columna de al lado",
    dispatchTechsSelected: (n: number) => `${n} técnico(s) seleccionado(s)`,
    tasksSelected: (n: number) => `${n} ${n === 1 ? "actividad seleccionada" : "actividades seleccionadas"}`,
    clearSelection: "Limpiar selección",
    multiSelectHint: "Marque tareas para seleccionar varias; Ctrl+clic y Shift+clic también funcionan en escritorio.",
    selectTask: (name: string) => `Seleccionar ${name}`,
    deselectTask: (name: string) => `Desmarcar ${name}`,
    packagePartial: "Paquete parcialmente seleccionado",
    dispatchError: "No se pudo despachar. Compruebe la conexión e inténtelo de nuevo.",
    dispatching: "Despachando...",
    dispatch: "Despachar",
    colActivity: "Actividad",
    colProject: "Proyecto",
    colSite: "Sitio",
    colDuration: "Duración Est.",
    colStatus: "Estado",
    colActions: "Acciones",
    badgeDispatched: (names: string) => `Despachada · ${names}`,
    badgeWaiting: "Esperando despacho",
    dispatchBtn: "Despachar",
    removing: "Eliminando...",
    removeDispatch: "Eliminar Despacho",
    noPoolActivity: "No hay actividades pendientes en este sitio.",
    expandAll: "Expandir todos", collapseAll: "Contraer todos",
    projectActivities: (n: number) => `${n} ${n === 1 ? "actividad" : "actividades"}`,
    packageTasks: (n: number) => `${n} ${n === 1 ? "tarea" : "tareas"}`,
    poolGroupBy: "Agrupar por",
    poolModePackage: "Paquete (actividad + material)",
    poolModeCable: "Cable (workflow)",
    poolModeActivity: "Actividad (todos los materiales)",
    allMaterials: "Todos los materiales",
    cableSteps: (n: number) => `${n} ${n === 1 ? "etapa" : "etapas"}`,
    packageSelect: "Seleccionar paquete",
    packageSelected: "Paquete seleccionado",
    packageReady: "Listo",
    packageBlocked: (n: number) => `${n} esperando etapa anterior`,
    taskBlocked: (names: string) => `Espera: ${names}`,
    noGroup: "Sin grupo",
    noActivity: "Sin actividad del catálogo",
    projectWaiting: (n: number) => `${n} en espera`, projectDispatched: (n: number) => `${n} despachada${n === 1 ? "" : "s"}`,
    expandProject: "Expandir proyecto", collapseProject: "Contraer proyecto",
    techniciansLabel: (n: number) => `TÉCNICOS (${n})`,
    rowStats: (done: number, doneLabel: string, pending: number, pendingLabel: string) =>
      `${done} ${doneLabel} · ${pending} ${pendingLabel}`,
    finishedSingular: "finalizada",
    finishedPlural: "finalizadas",
    pendingSingular: "pendiente",
    pendingPlural: "pendientes",
    inProgress: " – en progreso",
    closeLabel: "Cerrar",
    legendDone: "Completada",
    legendInProgress: "En ejecución",
    legendAvailable: "Disponible",
    legendPaused: "Pausa",
    legendLunch: "Hora del Almuerzo",
    legendPersonal: "Personal",
    legendMeal: "Café",
    legendMeeting: "Reunión",
    legendTraveling: "En desplazamiento",
    legendSupport: "Apoyo a otro técnico",
    expandLanes: (n: number) => `▾ +${n} simultáneas`,
    collapseLanes: "▴ Contraer",
    legendSiteBlocked: "Sin Acceso al Sitio",
    legendAwaiting: "Esperando Liberaciones",
    legendNotStarted: "No iniciado / Fin de Jornada",
    sidePanelTitle: "Próximas actividades / Operaciones",
    othersLabel: (n: number) => `Otros técnicos (${n})`,
    noQueueActivity: "No hay actividades pendientes en la cola.",
    viewAll: "Ver todas las actividades del día",
    footerHint: "Haga clic en una actividad para ver los detalles completos.",
    confirmUndispatch: "¿Eliminar el despacho de esta tarea? Los técnicos volverán a estar disponibles en el grupo.",
    returnToPool: "Devolver al grupo",
    confirmReturnToPool: "¿Devolver esta tarea al grupo para este técnico? Se elimina su despacho y se reinicia el tiempo que ya registró (inicio, pausas y horas). Los demás técnicos de la tarea no se ven afectados.",
    absenceTitle: "Ausencias planificadas (vacaciones, baja médica, día libre)",
    noTechLinked: "Ningún técnico vinculado a este sitio.",
    noTechLoggedIn: "Ningún técnico inició sesión en esta fecha.",
    loading: "Cargando...",
  },
};

function formatElapsed(startIso: string | null, now: number) {
  if (!startIso) return "";
  const start = new Date(startIso).getTime();
  const minutes = Math.max(0, Math.floor((now - start) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

const POOL_ACCENTS = ["--blue", "--teal", "--purple", "--pink", "--amber"];

interface PoolPackage {
  key: string;
  activityName: string;
  groupLabel: string;
  step: number;
  tasks: OperationsBoardTask[];
  units: number;
  unitsLabel: string;
  hours: number;
  blocked: number;
  /** Pacote por cabo (workflow): mostra etapas em vez de quantidade. */
  cable?: boolean;
}

export default function OperationsBoard() {
  const p = usePageText(TEXT);
  const { locale } = useI18n();
  const [sites, setSites] = useState<Site[]>([]);
  // "all" ou um ou mais ids separados por vírgula ("12,15")
  const [siteId, setSiteId] = useState<string>("all");
  const showSiteLabels = !/^\d+$/.test(siteId);
  const [board, setBoard] = useState<OperationsBoardData | null>(null);
  const [timelineByTech, setTimelineByTech] = useState<
    Record<number, { blocks: TimelineBlock[]; statusEvents: StatusEvent[] }>
  >({});
  const [loading, setLoading] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState(false);
  const [undispatchingId, setUndispatchingId] = useState<number | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<number[]>([]);
  const [poolMode, setPoolMode] = useState<"package" | "activity" | "cable">("package");
  const anchorTaskRef = useRef<number | null>(null);
  const [selectedTechs, setSelectedTechs] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  function toggleRow(techId: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(techId)) next.delete(techId); else next.add(techId);
      return next;
    });
  }
  const [todPopup, setTodPopup] = useState<{ key: string; label: string; start: Date; end: Date | null; color: string; top: number; left: number; taskId?: number; collaboratorId?: number } | null>(null);
  const todPopupRef = useRef<HTMLDivElement>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [techOpen, setTechOpen] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [absenceTech, setAbsenceTech] = useState<{ id: number; name: string } | null>(null);
  const [dragTaskIds, setDragTaskIds] = useState<number[]>([]);
  const [dragOverTechId, setDragOverTechId] = useState<number | null>(null);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const isToday = selectedDate === todayStr;

  useEffect(() => {
    sitesApi.list().then((data) => {
      setSites(data.results);
    });
  }, []);

  function loadAll(site: string, date?: string) {
    setLoading(true);
    const dateParam = date && date !== todayStr ? date : undefined;
    Promise.all([
      operationsApi.board(site, dateParam).then(setBoard),
      operationsApi.timeline(site, dateParam).then((data) => {
        const map: Record<number, { blocks: TimelineBlock[]; statusEvents: StatusEvent[] }> = {};
        for (const t of data.technicians) map[t.id] = { blocks: t.blocks, statusEvents: t.status_events };
        setTimelineByTech(map);
      }),
    ]).finally(() => setLoading(false));
  }

  useEffect(() => {
    clearTaskSelection();
    loadAll(siteId, selectedDate);
    // Auto-refresh apenas no dia atual
    if (selectedDate === todayStr) {
      const timer = setInterval(() => loadAll(siteId, selectedDate), 20000);
      return () => clearInterval(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, selectedDate]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setTodPopup(null); setSelectedTasks([]); setSelectedTechs([]); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function toggleTech(techId: number, available: boolean) {
    if (!available) return;
    const tech = (board?.technicians || []).find((t) => t.id === techId);
    const partnerId = tech?.pair_partner?.id;
    const ids = partnerId != null ? [techId, partnerId] : [techId];
    setSelectedTechs((prev) => {
      const isSelected = prev.includes(techId);
      return isSelected ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])];
    });
  }

  // Seleção de atividades do pool: clique simples seleciona uma (ou limpa, se já era a única),
  // Ctrl/Cmd+clique alterna, Shift+clique seleciona o intervalo desde a última âncora.
  function handleTaskClick(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, taskId: number, visibleIds: number[]) {
    const additive = e.ctrlKey || e.metaKey;
    if (e.shiftKey && anchorTaskRef.current != null && visibleIds.includes(anchorTaskRef.current)) {
      const from = visibleIds.indexOf(anchorTaskRef.current);
      const to = visibleIds.indexOf(taskId);
      const range = visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1);
      setSelectedTasks((prev) => (additive ? [...new Set([...prev, ...range])] : range));
    } else if (additive) {
      setSelectedTasks((prev) => (prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]));
      anchorTaskRef.current = taskId;
    } else {
      setSelectedTasks((prev) => (prev.length === 1 && prev[0] === taskId ? [] : [taskId]));
      anchorTaskRef.current = taskId;
    }
    setSelectedTechs([]);
  }

  // Botão "Despachar" da linha: garante que a atividade está na seleção (mantém as demais se já estava).
  function prepareDispatchFor(taskId: number) {
    setSelectedTasks((prev) => (prev.includes(taskId) ? prev : [taskId]));
    anchorTaskRef.current = taskId;
    setSelectedTechs([]);
  }

  function clearTaskSelection() {
    setSelectedTasks([]);
    setSelectedTechs([]);
    anchorTaskRef.current = null;
    setDispatchError(false);
  }

  function toggleTaskSelection(taskId: number) {
    setSelectedTasks((prev) => prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]);
    anchorTaskRef.current = taskId;
    setDispatchError(false);
  }

  // Ids na ordem em que aparecem na tela (a ordem da seleção é a ordem da fila do técnico).
  function orderedSelection() {
    const order = new Map<number, number>();
    let i = 0;
    for (const g of poolGroups) {
      if (collapsedProjects.has(g.key)) continue;
      for (const t of g.tasks) order.set(t.id, i++);
    }
    return [...selectedTasks].filter((id) => order.has(id)).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  async function dispatch() {
    const ids = orderedSelection();
    if (dispatching || ids.length === 0 || selectedTechs.length === 0) return;
    setDispatchError(false);
    setDispatching(true);
    try {
      await operationsApi.dispatchBulk(ids, selectedTechs);
      clearTaskSelection();
      loadAll(siteId, selectedDate);
    } catch {
      setDispatchError(true);
    } finally {
      setDispatching(false);
    }
  }

  async function handleUndispatch(taskId: number) {
    if (!confirm(p.confirmUndispatch)) return;
    setUndispatchingId(taskId);
    try {
      await operationsApi.undispatch(taskId);
      if (siteId != null) loadAll(siteId, selectedDate);
    } finally {
      setUndispatchingId(null);
    }
  }

  async function handleReturnToPool(taskId: number, collaboratorId: number) {
    if (!confirm(p.confirmReturnToPool)) return;
    setUndispatchingId(taskId);
    try {
      await operationsApi.returnToPool(taskId, [collaboratorId]);
      if (siteId != null) loadAll(siteId, selectedDate);
    } catch {
      alert("Não foi possível devolver a tarefa ao pool.");
    } finally {
      setUndispatchingId(null);
    }
  }

  const technicians = board?.technicians || [];
  const pool = board?.pool || [];
  // Pool agrupado por projeto: a barra do projeto identifica a sequência de atividades abaixo dela.
  const poolGroups = useMemo(() => {
    const byKey = new Map<string, { key: string; name: string; code: string; site: string; tasks: typeof pool }>();
    for (const task of pool) {
      const key = task.project_code || task.project_name;
      let g = byKey.get(key);
      if (!g) {
        g = { key, name: task.project_name, code: task.project_code, site: task.site_name, tasks: [] };
        byKey.set(key, g);
      }
      g.tasks.push(task);
    }
    // Dentro do projeto, as tarefas formam pacotes de trabalho (atividade + grupo de material), na ordem
    // do fluxo (etapa do template). O pacote é a unidade natural de despacho e de bloco do técnico.
    return Array.from(byKey.values()).map((g) => {
      const byPackage = new Map<string, PoolPackage>();
      // "Separar materiais 72F OS2 ... 45m" → "72F OS2 ... 45m": o cabo sem o nome da etapa.
      const cableLabel = (t: OperationsBoardTask) =>
        t.activity_name && t.name.startsWith(t.activity_name) ? t.name.slice(t.activity_name.length).trim() : t.name;
      g.tasks.forEach((task, index) => {
        const pkgKey =
          poolMode === "cable"
            ? `item|${task.scope_item_code ?? `task-${task.id}`}`
            : poolMode === "activity"
              ? `${task.activity_code ?? ""}|*`
              : `${task.activity_code ?? ""}|${task.work_group ?? ""}`;
        let pkg = byPackage.get(pkgKey);
        if (!pkg) {
          pkg = {
            key: `${g.key}|${pkgKey}`,
            activityName: poolMode === "cable" ? cableLabel(task) : (task.activity_name ?? ""),
            groupLabel: poolMode === "activity" ? p.allMaterials : (task.work_group_label ?? ""),
            step: poolMode === "cable" ? index : (task.step_order ?? 9999),
            cable: poolMode === "cable",
            tasks: [],
            units: 0,
            unitsLabel: task.work_units_label ?? "",
            hours: 0,
            blocked: 0,
          };
          byPackage.set(pkgKey, pkg);
        }
        pkg.tasks.push(task);
        pkg.units += task.work_units ?? 0;
        pkg.hours += task.estimated_hours ? Number(task.estimated_hours) : 0;
        if ((task.blocked_by?.length ?? 0) > 0) pkg.blocked += 1;
      });
      const packages = Array.from(byPackage.values()).sort(
        (a, b) => a.step - b.step || a.activityName.localeCompare(b.activityName) || a.groupLabel.localeCompare(b.groupLabel)
      );
      // Por cabo, as etapas seguem a ordem do fluxo (etapa do template).
      if (poolMode === "cable") for (const pkg of packages) pkg.tasks.sort((a, b) => (a.step_order ?? 9999) - (b.step_order ?? 9999));
      return { ...g, packages, tasks: packages.flatMap((pkg) => pkg.tasks) };
    });
  }, [pool, poolMode]);
  function selectPackage(ids: number[]) {
    setSelectedTasks((prev) => {
      const all = ids.every((id) => prev.includes(id));
      return all ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])];
    });
  }
  const visibleTaskIds = poolGroups.flatMap((g) => (collapsedProjects.has(g.key) ? [] : g.tasks.map((t) => t.id)));
  useEffect(() => {
    if (!board) return;
    const currentIds = new Set(board.pool.map((task) => task.id));
    setSelectedTasks((prev) => {
      const valid = prev.filter((id) => currentIds.has(id));
      return valid.length === prev.length ? prev : valid;
    });
  }, [board]);
  const allCollapsed = poolGroups.length > 0 && poolGroups.every((g) => collapsedProjects.has(g.key));
  function toggleProject(key: string) {
    const group = poolGroups.find((g) => g.key === key);
    if (group && !collapsedProjects.has(key)) {
      const hidden = new Set(group.tasks.map((t) => t.id));
      setSelectedTasks((prev) => prev.filter((id) => !hidden.has(id)));
    }
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  const stats = board?.stats;
  const nowDate = isToday ? new Date(now) : new Date(selectedDate + "T18:00:00");
  const base = isToday ? nowDate : new Date(selectedDate + "T07:00:00");
  const nowPct = pct(nowDate, base);
  const techRows = reorderRowsByPair(
    technicians
      .filter((tech) => !tech.on_leave && tech.presence_status !== "not_started")
      .map((tech) => {
      const { blocks = [], statusEvents = [] } = timelineByTech[tech.id] || {};
      const segments = buildTechSegments(blocks, statusEvents, nowDate, true, locale);
      const allLaned = assignLanes(segments);
      const lanes = collapseLanes(allLaned, expandedRows.has(tech.id));
      return {
        tech,
        allLaned,
        lanedSegments: lanes.visible,
        laneCount: lanes.laneCount,
        hiddenCount: lanes.hiddenCount,
        collapsible: lanes.collapsible,
        expanded: lanes.expanded,
        doneCount: blocks.filter((b) => b.status === "completed").length,
        pendingCount: tech.queue.length,
      };
    })
  );

  const windowEnd = new Date(base);
  windowEnd.setHours(WINDOW_END_HOUR, 0, 0, 0);

  const NOT_STARTED_DURATION_MS = 1.5 * 60 * 60 * 1000;
  function notStartedBars(row: (typeof techRows)[number]) {
    if (row.tech.queue.length === 0) return [];
    let lane = 0;
    let cursor = nowDate;
    if (row.allLaned.length > 0) {
      for (const { segment, lane: segLane } of row.allLaned) {
        const end = segment.end ?? nowDate;
        if (end >= cursor) {
          cursor = end;
          lane = segLane;
        }
      }
    }
    const bars: { key: number; label: string; start: Date; end: Date; lane: number }[] = [];
    for (const q of row.tech.queue) {
      if (cursor >= windowEnd) break;
      const end = new Date(Math.min(cursor.getTime() + NOT_STARTED_DURATION_MS, windowEnd.getTime()));
      bars.push({ key: q.task_id, label: q.task_name, start: cursor, end, lane: row.collapsible && !row.expanded ? 0 : lane });
      cursor = end;
    }
    return bars;
  }

  const techsWithQueue = technicians.filter((t) => t.queue.length > 0).sort((a, b) => b.queue.length - a.queue.length);
  const expandedGroups = techsWithQueue.slice(0, 3);
  const otherGroups = techsWithQueue.slice(3);

  const techStatusLabel = (tech: OperationsBoardTechnician) => {
    const hasInProgress = tech.current_tasks.some((t) => t.status === "in_progress");
    const hasPaused = tech.current_tasks.some((t) => t.status === "paused");
    const pausedAway = hasPaused && AWAY_STATUSES.includes(tech.presence_status);
    if (hasInProgress) return p.statusInProgress;
    if (hasPaused && !pausedAway) return p.statusPaused;
    return presenceLabel(tech.presence_status, locale, tech.presence_status_display);
  };

  const techStatusColor = (tech: OperationsBoardTechnician) => {
    const hasInProgress = tech.current_tasks.some((t) => t.status === "in_progress");
    const hasPaused = tech.current_tasks.some((t) => t.status === "paused");
    const pausedAway = hasPaused && AWAY_STATUSES.includes(tech.presence_status);
    if (hasInProgress) return BUSY_COLOR.in_progress;
    if (hasPaused && !pausedAway) return BUSY_COLOR.paused;
    return PRESENCE_COLOR[tech.presence_status];
  };

  return (
    <div>
      <PageHeader
        eyebrow={p.eyebrow}
        title={p.title}
        subtitle={
          isToday
            ? p.subtitleToday
            : p.subtitleDate(
                new Date(selectedDate + "T12:00:00").toLocaleDateString(locale, {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })
              )
        }
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                className="btn btn-outline btn-sm"
                style={{ padding: "4px 8px" }}
                onClick={() => {
                  const d = new Date(selectedDate + "T12:00:00");
                  d.setDate(d.getDate() - 1);
                  setSelectedDate(d.toISOString().slice(0, 10));
                }}
              >
                <Icon name="chevron_left" style={{ fontSize: 16 }} />
              </button>
              <DateInput
                value={selectedDate}
                onChange={(v) => setSelectedDate(v || todayStr)}
                className="btn btn-outline btn-sm"
                style={{ minWidth: 130 }}
              />
              <button
                className="btn btn-outline btn-sm"
                style={{ padding: "4px 8px" }}
                disabled={isToday}
                onClick={() => {
                  const d = new Date(selectedDate + "T12:00:00");
                  d.setDate(d.getDate() + 1);
                  const next = d.toISOString().slice(0, 10);
                  setSelectedDate(next > todayStr ? todayStr : next);
                }}
              >
                <Icon name="chevron_right" style={{ fontSize: 16 }} />
              </button>
              {!isToday && (
                <button className="btn btn-outline btn-sm" onClick={() => setSelectedDate(todayStr)}>
                  {p.today}
                </button>
              )}
            </div>
            <MultiSelectFilter
              label={p.colSite}
              options={sites.map((s) => ({ value: String(s.id), label: s.name }))}
              selected={siteId === "all" ? [] : String(siteId).split(",")}
              onChange={(next) => setSiteId(next.length ? next.join(",") : "all")}
              allLabel={p.allSites}
            />
          </div>
        }
      />

      {loading && !board ? (
        <p style={{ color: "var(--text-muted)" }}>{p.loading}</p>
      ) : (
        <>
          <div className="ops-stat-row">
            <div className="stat-grid" style={{ flex: 1, marginBottom: 0, gridTemplateColumns: "repeat(6, 1fr)" }}>
              <StatCard label={p.statPlanned} value={stats?.planned ?? 0} />
              <StatCard label={p.statActive} value={stats?.active ?? 0} />
              <StatCard label={p.statCompleted} value={stats?.completed ?? 0} />
              <StatCard label={p.statPending} value={stats?.pending ?? 0} />
              <StatCard label={p.statOnSite} value={stats?.technicians_on_site ?? 0} />
              <StatCard label={p.statAbsent} value={stats?.technicians_absent ?? 0} />
            </div>
            <div className="ops-progress-card">
              <div className="ops-progress-ring" style={{ ["--pct" as string]: stats?.progress_pct ?? 0 }}>
                <div className="ops-progress-ring-inner">{stats?.progress_pct ?? 0}%</div>
              </div>
              <div className="ops-progress-label">{p.progressLabel}</div>
            </div>
          </div>

          <div className="ops-columns">
            <div className="ops-tech-card">
              <button type="button" className="ops-card-head ops-card-head-toggle" onClick={() => setTechOpen((v) => !v)}>
                <div className="ops-card-title">{p.techCardTitle}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="ops-card-hint">{p.techCardHint(technicians.length)}</div>
                  <Icon name={techOpen ? "expand_less" : "expand_more"} style={{ fontSize: 20, color: "var(--text-faint)" }} />
                </div>
              </button>
              {techOpen && groupByPair(technicians).map(({ primary, partner }) => {
                const rows = partner ? [primary, partner] : [primary];
                const content = rows.map((tech) => {
                  const hasInProgress = tech.current_tasks.some((t) => t.status === "in_progress");
                  const hasPaused = tech.current_tasks.some((t) => t.status === "paused");
                  const pausedAway = hasPaused && AWAY_STATUSES.includes(tech.presence_status);
                  const busyStatus = hasInProgress ? "in_progress" : hasPaused && !pausedAway ? "paused" : undefined;
                  const dotColor = pausedAway
                    ? PRESENCE_COLOR[tech.presence_status]
                    : busyStatus
                      ? BUSY_COLOR[busyStatus]
                      : PRESENCE_COLOR[tech.presence_status];
                  const dispatchable = !tech.on_leave && tech.presence_status !== "not_started" && tech.presence_status !== "off_duty";
                  const selectable = selectedTasks.length > 0 && dispatchable;
                  const isSelected = selectedTechs.includes(tech.id);
                  const droppable = !tech.on_leave && dragTaskIds.length > 0;
                  return (
                    <div
                      key={tech.id}
                      className={`ops-tech-row${selectable ? " selectable" : ""}${isSelected ? " selected" : ""}${
                        tech.on_leave || tech.presence_status === "off_duty" || tech.presence_status === "not_started" ? " dim" : ""
                      }${dragOverTechId === tech.id ? " drag-over" : ""}`}
                      onClick={() => toggleTech(tech.id, selectable)}
                      onDragOver={(e) => {
                        if (!droppable) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDragOverTechId(tech.id);
                      }}
                      onDragLeave={(e) => {
                        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragOverTechId(null);
                      }}
                      onDrop={async (e) => {
                        e.preventDefault();
                        setDragOverTechId(null);
                        if (dragTaskIds.length === 0 || tech.on_leave) return;
                        const techIds = tech.pair_partner ? [tech.id, tech.pair_partner.id] : [tech.id];
                        setDispatching(true);
                        try {
                          await operationsApi.dispatchBulk(dragTaskIds, techIds);
                          setDragTaskIds([]);
                          clearTaskSelection();
                          if (siteId != null) loadAll(siteId);
                        } finally {
                          setDispatching(false);
                        }
                      }}
                    >
                      <div className="ops-avatar">
                        {initials(tech.name)}
                        <span className="ops-avatar-dot" style={{ background: dotColor }} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="ops-tech-name">
                          {tech.name}
                          {showSiteLabels && tech.site_name && <span className="ops-tech-site"> · {tech.site_name}</span>}
                        </div>
                        <div className="ops-tech-status" style={{ color: dotColor }}>
                          {busyStatus === "in_progress"
                            ? p.statusInProgress
                            : busyStatus === "paused"
                              ? p.statusPaused
                              : presenceLabel(tech.presence_status, locale, tech.presence_status_display)}
                          {tech.current_tasks.length > 1 && p.openTasks(tech.current_tasks.length)}
                        </div>
                        {tech.current_tasks.map((t) => (
                          <div key={t.id} className="ops-tech-current">
                            {t.status === "paused" ? "⏸ " : ""}
                            {t.name}
                            {t.status === "in_progress" && t.actual_start && (
                              <span className="ops-tech-timer"> · {formatElapsed(t.actual_start, now)}</span>
                            )}
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              style={{ color: "var(--red)", marginLeft: 8, padding: "0 6px" }}
                              disabled={undispatchingId === t.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReturnToPool(t.id, tech.id);
                              }}
                            >
                              {undispatchingId === t.id ? p.removing : p.returnToPool}
                            </button>
                          </div>
                        ))}
                        {tech.queue.length > 0 && (
                          <div className="ops-queue-row">
                            {tech.queue.map((q, idx) => (
                              <span key={q.task_id} className="ops-queue-chip" title={q.task_name}>
                                <span className="ops-queue-num">{idx + 1}</span>
                                {q.task_name}
                                <button
                                  type="button"
                                  title={p.returnToPool}
                                  aria-label={p.returnToPool}
                                  disabled={undispatchingId === q.task_id}
                                  style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", padding: "0 0 0 6px", fontWeight: 700 }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleReturnToPool(q.task_id, tech.id);
                                  }}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="ops-tech-absence-btn"
                        title={p.absenceTitle}
                        onClick={(e) => {
                          e.stopPropagation();
                          setAbsenceTech({ id: tech.id, name: tech.name });
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--text-faint)",
                          display: "flex",
                          alignItems: "center",
                          padding: 4,
                        }}
                      >
                        <Icon name="event_busy" style={{ fontSize: 18 }} />
                      </button>
                    </div>
                  );
                });
                if (!partner) return content;
                return (
                  <div key={primary.id} className="ops-pair-group">
                    <div className="ops-pair-label">
                      <Icon name="groups" style={{ fontSize: 13 }} />
                      {p.pairLabel}
                    </div>
                    {content}
                  </div>
                );
              })}
              {techOpen && technicians.length === 0 && <div className="empty-state">{p.noTechLinked}</div>}
            </div>

            <div className="ops-pool-card">
              <button type="button" className="ops-card-head ops-card-head-toggle" onClick={() => setPoolOpen((v) => !v)}>
                <div className="ops-card-title">{p.poolTitle}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="ops-card-hint">{p.poolHint(pool.length)}</div>
                  <Icon name={poolOpen ? "expand_less" : "expand_more"} style={{ fontSize: 20, color: "var(--text-faint)" }} />
                </div>
              </button>
              {poolOpen && (
                <>
                  {selectedTasks.length > 0 && (
                    <div className="ops-dispatch-bar" role="status">
                      <span className="ops-dispatch-bar-text">
                        <b>{p.tasksSelected(selectedTasks.length)}</b>
                        {" · "}
                        {selectedTechs.length === 0
                          ? p.dispatchSelectTech
                          : p.dispatchTechsSelected(selectedTechs.length)}
                      </span>
                      <button className="btn btn-outline btn-sm" onClick={clearTaskSelection}>{p.clearSelection}</button>
                      <button className="btn btn-primary btn-sm" disabled={selectedTechs.length === 0 || dispatching} onClick={dispatch}>
                        {dispatching ? p.dispatching : p.dispatch}
                      </button>
                    </div>
                  )}
                  {dispatchError && <div className="ops-dispatch-error" role="alert">{p.dispatchError}</div>}
                  {poolGroups.length > 0 && (
                    <div className="ops-pool-toolbar">
                      <span className="ops-pool-hint">{p.multiSelectHint}</span>
                      <select
                        className="select"
                        style={{ width: "auto" }}
                        aria-label={p.poolGroupBy}
                        value={poolMode}
                        onChange={(e) => setPoolMode(e.target.value as "package" | "activity" | "cable")}
                      >
                        <option value="package">{p.poolGroupBy}: {p.poolModePackage}</option>
                        <option value="activity">{p.poolGroupBy}: {p.poolModeActivity}</option>
                        <option value="cable">{p.poolGroupBy}: {p.poolModeCable}</option>
                      </select>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => { if (!allCollapsed) clearTaskSelection(); setCollapsedProjects(allCollapsed ? new Set() : new Set(poolGroups.map((g) => g.key))); }}
                      >
                        <Icon name={allCollapsed ? "unfold_more" : "unfold_less"} style={{ fontSize: 15 }} />
                        {allCollapsed ? p.expandAll : p.collapseAll}
                      </button>
                    </div>
                  )}
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{p.colActivity}</th>
                          <th>{p.colDuration}</th>
                          <th>{p.colStatus}</th>
                          <th>{p.colActions}</th>
                        </tr>
                      </thead>
                      {poolGroups.map((group, gi) => {
                        const collapsed = collapsedProjects.has(group.key);
                        const accent = POOL_ACCENTS[gi % POOL_ACCENTS.length];
                        const dispatched = group.tasks.filter((t) => t.assignees.length > 0).length;
                        const waiting = group.tasks.length - dispatched;
                        return (
                          <tbody key={group.key}>
                            <tr
                              className="ops-pool-group"
                              onClick={() => toggleProject(group.key)}
                              style={{ ["--pool-accent" as string]: `var(${accent})`, ["--pool-accent-soft" as string]: `var(${accent}-soft)` }}
                            >
                              <td colSpan={4}>
                                <div className="ops-pool-group-bar">
                                  <Icon name={collapsed ? "chevron_right" : "expand_more"} style={{ fontSize: 20 }} />
                                  <span className="ops-pool-group-name">{group.name}</span>
                                  {group.code && <span className="ops-pool-group-code">{group.code}</span>}
                                  {showSiteLabels && <span className="ops-pool-group-site">{group.site}</span>}
                                  <span className="ops-pool-group-spacer" />
                                  <span className="ops-pool-group-count">{p.projectActivities(group.tasks.length)}</span>
                                  {waiting > 0 && <span className="ops-pool-group-sub">{p.projectWaiting(waiting)}</span>}
                                  {dispatched > 0 && <span className="ops-pool-group-sub ops-pool-group-sub-ok">{p.projectDispatched(dispatched)}</span>}
                                </div>
                              </td>
                            </tr>
                            {!collapsed && group.packages.map((pkg, pi) => {
                              const pkgIds = pkg.tasks.map((t) => t.id);
                              const pkgSelected = pkgIds.every((id) => selectedTasks.includes(id));
                              const pkgPartial = !pkgSelected && pkgIds.some((id) => selectedTasks.includes(id));
                              const offset = group.packages.slice(0, pi).reduce((n, other) => n + other.tasks.length, 0);
                              return (
                                <Fragment key={pkg.key}>
                                  <tr className="ops-pool-package" style={{ ["--pool-accent" as string]: `var(${accent})` }}>
                                    <td colSpan={4}>
                                      <div className="ops-pool-package-bar">
                                        <span className="ops-pool-package-name">{pkg.activityName || p.noActivity}</span>
                                        <span className="ops-pool-package-group">{pkg.groupLabel || p.noGroup}</span>
                                        <span className="ops-pool-package-meta">
                                          {pkg.cable ? p.cableSteps(pkg.tasks.length) : p.packageTasks(pkg.tasks.length)}
                                          {!pkg.cable && pkg.units > 0 && ` · ${Math.round(pkg.units).toLocaleString("pt-BR")} ${pkg.unitsLabel}`}
                                          {pkg.hours > 0 && ` · ${Math.round(pkg.hours * 10) / 10}h`}
                                        </span>
                                        {pkg.blocked === 0 ? (
                                          <span className="ops-pool-package-ready">{p.packageReady}</span>
                                        ) : (
                                          <span className="ops-pool-package-blocked">{p.packageBlocked(pkg.blocked)}</span>
                                        )}
                                        <span className="ops-pool-group-spacer" />
                                        <button
                                          type="button"
                                          className={`btn btn-sm ${pkgSelected ? "btn-primary" : "btn-outline"}`}
                                          onClick={(e) => { e.stopPropagation(); selectPackage(pkgIds); }}
                                        >
                                          {pkgSelected ? p.packageSelected : pkgPartial ? p.packagePartial : p.packageSelect}
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                  {pkg.tasks.map((task, tk) => {
                                    const ti = offset + tk;
                                    return (
                              <tr
                                key={task.id}
                                className="ops-pool-task"
                                draggable={true}
                                onDragStart={(e) => {
                                  // Arrastar uma atividade selecionada leva toda a seleção; senão, só ela.
                                  const ids = selectedTasks.includes(task.id) ? orderedSelection() : [task.id];
                                  setDragTaskIds(ids);
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("taskId", String(task.id));
                                  if (ids.length > 1) {
                                    const badge = document.createElement("div");
                                    badge.textContent = p.tasksSelected(ids.length);
                                    badge.style.cssText = "position:fixed;top:-100px;left:-100px;padding:8px 14px;border-radius:8px;background:#f16023;color:#fff;font:700 13px sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.3)";
                                    document.body.appendChild(badge);
                                    e.dataTransfer.setDragImage(badge, 12, 12);
                                    setTimeout(() => badge.remove(), 0);
                                  }
                                }}
                                onDragEnd={() => { setDragTaskIds([]); setDragOverTechId(null); }}
                                onClick={(e) => {
                                  if (window.matchMedia("(pointer: coarse)").matches) return;
                                  handleTaskClick(e, task.id, visibleTaskIds);
                                }}
                                style={{
                                  cursor: "grab",
                                  background: selectedTasks.includes(task.id) ? "rgba(241, 96, 35, 0.16)" : dragTaskIds.includes(task.id) ? "var(--bg)" : undefined,
                                  opacity: dragTaskIds.includes(task.id) ? 0.5 : 1,
                                  ["--pool-accent" as string]: `var(${accent})`,
                                }}
                              >
                                <td style={{ fontWeight: 700 }}>
                                  <label className="ops-task-check" onClick={(e) => e.stopPropagation()}>
                                    <input
                                      type="checkbox"
                                      checked={selectedTasks.includes(task.id)}
                                      aria-label={selectedTasks.includes(task.id) ? p.deselectTask(task.name) : p.selectTask(task.name)}
                                      onChange={() => toggleTaskSelection(task.id)}
                                    />
                                  </label>
                                  <span className="ops-pool-seq">{ti + 1}</span>
                                  {task.name}
                                  {(task.blocked_by?.length ?? 0) > 0 && (
                                    <span className="badge ops-pool-task-blocked" title={p.taskBlocked((task.blocked_by ?? []).join(", "))}>
                                      {p.taskBlocked((task.blocked_by ?? []).join(", "))}
                                    </span>
                                  )}
                                </td>
                                <td>{task.estimated_hours ? `${task.estimated_hours}h` : "—"}</td>
                                <td>
                                  {task.assignees.length > 0 ? (
                                    <span className="badge" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>
                                      {p.badgeDispatched(task.assignees.map((a) => a.name).join(", "))}
                                    </span>
                                  ) : (
                                    <span className="badge" style={{ background: "var(--bg)", color: "var(--text-muted)" }}>
                                      {p.badgeWaiting}
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <div style={{ display: "flex", gap: 6 }}>
                                    <button
                                      className="btn btn-outline btn-sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        prepareDispatchFor(task.id);
                                      }}
                                    >
                                      {p.dispatchBtn}
                                    </button>
                                    {task.assignees.length > 0 && (
                                      <button
                                        className="btn btn-outline btn-sm"
                                        style={{ color: "var(--red)" }}
                                        disabled={undispatchingId === task.id}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleUndispatch(task.id);
                                        }}
                                      >
                                        {undispatchingId === task.id ? p.removing : p.removeDispatch}
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                                    );
                                  })}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        );
                      })}
                    </table>
                    {pool.length === 0 && <div className="table-empty">{p.noPoolActivity}</div>}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="tod-layout" style={{ marginTop: 16 }}>
            <div className="tod-tech-panel">
              <div className="tod-panel-head">
                <div className="tod-tech-title">{p.techniciansLabel(techRows.length)}</div>
                <div className="tod-ruler">
                  {HOURS.map((h) => (
                    <span
                      key={h}
                      className="tod-ruler-tick"
                      style={{ left: `${((h - WINDOW_START_HOUR) / (WINDOW_END_HOUR - WINDOW_START_HOUR)) * 100}%` }}
                    >
                      {String(h).padStart(2, "0")}:00
                    </span>
                  ))}
                </div>
              </div>
              <div className="tod-body">
                <div className="tod-overlay">
                  {HOURS.slice(1, -1).map((h) => (
                    <div
                      key={h}
                      className="tod-gridline"
                      style={{ left: `${((h - WINDOW_START_HOUR) / (WINDOW_END_HOUR - WINDOW_START_HOUR)) * 100}%` }}
                    />
                  ))}
                  <div className="tod-now-line" style={{ left: `${nowPct}%` }}>
                    <div className="tod-now-tag">
                      {nowDate.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="tod-now-dot" />
                  </div>
                </div>

                {techRows.map((row, rowIdx) => {
                  const { tech, lanedSegments, laneCount, doneCount, pendingCount } = row;
                  const badgeColor = techStatusColor(tech);
                  const badgeLabel = techStatusLabel(tech);
                  const rowHeight = laneCount <= 1 ? 88 : 36 + laneCount * 52;
                  const barH = 22;
                  const barT = (lane: number) => 8 + lane * 52;
                  const notStarted = notStartedBars(row);
                  const doneLabel = doneCount === 1 ? p.finishedSingular : p.finishedPlural;
                  const pendLabel = pendingCount === 1 ? p.pendingSingular : p.pendingPlural;
                  return (
                    <div
                      key={tech.id}
                      className={`tod-row ${pairRowClass(techRows, rowIdx)}`}
                      style={{ minHeight: rowHeight }}
                      onClick={() => setTodPopup(null)}
                    >
                      <div className="tod-row-info">
                        <div className="tod-row-name-line">
                          <div className="tod-row-avatar">
                            {initials(tech.name)}
                            <span className="tod-row-avatar-dot" style={{ background: badgeColor }} />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="tod-row-name">{tech.name}</div>
                            <span
                              className="tod-status-badge"
                              style={{ background: `color-mix(in srgb, ${badgeColor} 16%, white)`, color: badgeColor }}
                            >
                              {badgeLabel}
                            </span>
                          </div>
                        </div>
                        {tech.site_name && <div className="tod-row-sites">{tech.site_name}</div>}
                        <div className="tod-row-stats">
                          {doneCount} {doneLabel} · {pendingCount} {pendLabel}
                        </div>
                        {row.collapsible && (
                          <button
                            type="button"
                            className="tod-expand-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRow(tech.id);
                            }}
                          >
                            {row.expanded ? p.collapseLanes : p.expandLanes(row.hiddenCount)}
                          </button>
                        )}
                      </div>
                      {lanedSegments.length === 0 && notStarted.length === 0 ? (
                        <div className="tod-empty-row">{presenceLabel(tech.presence_status, locale, tech.presence_status_display)}</div>
                      ) : (
                        <div className="tod-track" style={{ minHeight: rowHeight - 20 }}>
                          {lanedSegments.map(({ segment, lane }, idx) => {
                            const left = pct(segment.start, base);
                            const rightPct = segment.end ? pct(segment.end, base) : nowPct;
                            const width = Math.max(1, rightPct - left);
                            const barKey = `${tech.id}-seg-${idx}`;
                            return (
                              <div
                                key={idx}
                                className={`tod-bar${todPopup?.key === barKey ? " expanded" : ""}`}
                                title={segment.label}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setTodPopup((prev) =>
                                    prev?.key === barKey
                                      ? null
                                      : { key: barKey, label: segment.label, start: segment.start, end: segment.end ?? null, color: segment.color, top: rect.bottom + 6, left: rect.left, taskId: segment.taskId, collaboratorId: tech.id }
                                  );
                                }}
                                style={{ left: `${left}%`, width: `${width}%`, top: barT(lane), height: barH, background: segment.color }}
                              >
                                <span className="tod-bar-label">{segment.label}</span>
                              </div>
                            );
                          })}
                          {notStarted.map((bar) => {
                            const barKey = `${tech.id}-ns-${bar.key}`;
                            return (
                              <div
                                key={bar.key}
                                className={`tod-bar tod-bar-notstarted${todPopup?.key === barKey ? " expanded" : ""}`}
                                title={bar.label}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setTodPopup((prev) =>
                                    prev?.key === barKey
                                      ? null
                                      : { key: barKey, label: bar.label, start: bar.start, end: bar.end, color: "transparent", top: rect.bottom + 6, left: rect.left, taskId: bar.key, collaboratorId: tech.id }
                                  );
                                }}
                                style={{
                                  left: `${pct(bar.start, base)}%`,
                                  width: `${Math.max(1, pct(bar.end, base) - pct(bar.start, base))}%`,
                                  top: barT(bar.lane),
                                  height: barH,
                                }}
                              >
                                <span className="tod-bar-label">{bar.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {techRows.length === 0 && (
                <div className="empty-state">{technicians.length === 0 ? p.noTechLinked : p.noTechLoggedIn}</div>
              )}
              <div className="tl-legend-row tod-legend-row">
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: DONE_COLOR }} />
                  {p.legendDone}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: BUSY_COLOR.in_progress }} />
                  {p.legendInProgress}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.available }} />
                  {p.legendAvailable}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: BUSY_COLOR.paused }} />
                  {p.legendPaused}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.lunch }} />
                  {p.legendLunch}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.personal }} />
                  {p.legendPersonal}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.meal }} />
                  {p.legendMeal}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.meeting }} />
                  {p.legendMeeting}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.traveling }} />
                  {p.legendTraveling}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.support }} />
                  {p.legendSupport}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.site_blocked }} />
                  {p.legendSiteBlocked}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.awaiting_release }} />
                  {p.legendAwaiting}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch tod-legend-notstarted" />
                  {p.legendNotStarted}
                </div>
              </div>
            </div>

            <div className="tod-side-panel">
              <div className="tod-side-head">
                <div className="tod-side-title">{p.sidePanelTitle}</div>
                <button type="button" className="tod-filter-btn" onClick={() => setPoolOpen(true)} title="Ver pool completo">
                  <Icon name="filter_list" style={{ fontSize: 16 }} />
                </button>
              </div>
              <div className="tod-side-body">
                {expandedGroups.map((tech) => (
                  <div key={tech.id} className="tod-tech-group">
                    <div className="tod-tech-group-head">
                      <div className="tod-tech-group-name">{tech.name}</div>
                      <span className="tod-count-badge">{tech.queue.length}</span>
                    </div>
                    {tech.queue.slice(0, 2).map((q) => (
                      <div key={q.task_id} className="tod-activity-card">
                        <div className="tod-activity-name">{q.task_name}</div>
                        <div className="tod-activity-project">{q.project_name}</div>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{ color: "var(--red)", marginTop: 4, padding: "0 6px" }}
                          disabled={undispatchingId === q.task_id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleReturnToPool(q.task_id, tech.id);
                          }}
                        >
                          {undispatchingId === q.task_id ? p.removing : p.returnToPool}
                        </button>
                      </div>
                    ))}
                  </div>
                ))}

                {otherGroups.length > 0 && (
                  <div className="tod-others-row" onClick={() => setOthersOpen((v) => !v)}>
                    <span>
                      {p.othersLabel(otherGroups.length)}
                    </span>
                    <Icon name={othersOpen ? "expand_less" : "chevron_right"} style={{ fontSize: 18 }} />
                  </div>
                )}
                {othersOpen &&
                  otherGroups.map((tech) => (
                    <div key={tech.id} className="tod-tech-group" style={{ marginTop: 10 }}>
                      <div className="tod-tech-group-head">
                        <div className="tod-tech-group-name">{tech.name}</div>
                        <span className="tod-count-badge">{tech.queue.length}</span>
                      </div>
                      {tech.queue.slice(0, 2).map((q) => (
                        <div key={q.task_id} className="tod-activity-card">
                          <div className="tod-activity-name">{q.task_name}</div>
                          <div className="tod-activity-project">{q.project_name}</div>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            style={{ color: "var(--red)", marginTop: 4, padding: "0 6px" }}
                            disabled={undispatchingId === q.task_id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReturnToPool(q.task_id, tech.id);
                            }}
                          >
                            {undispatchingId === q.task_id ? p.removing : p.returnToPool}
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                {techsWithQueue.length === 0 && <div className="empty-state">{p.noQueueActivity}</div>}
              </div>
              <button type="button" className="tod-viewall-link" onClick={() => setPoolOpen(true)}>
                {p.viewAll}
                <Icon name="arrow_forward" style={{ fontSize: 15 }} />
              </button>
            </div>
          </div>
          <div className="tod-footer-hint">{p.footerHint}</div>
        </>
      )}
      {todPopup && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 199 }} onClick={() => setTodPopup(null)} />
          <div
            ref={todPopupRef}
            className="tl-popup"
            style={{ top: todPopup.top, left: Math.min(todPopup.left, window.innerWidth - 280) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tl-popup-color" style={{ background: todPopup.color }} />
            <div className="tl-popup-body">
              <div className="tl-popup-label">{todPopup.label}</div>
              <div className="tl-popup-time">
                {formatTime(todPopup.start.toISOString())}
                {todPopup.end ? ` – ${formatTime(todPopup.end.toISOString())}` : p.inProgress}
              </div>
              {todPopup.taskId != null && todPopup.collaboratorId != null && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{ color: "var(--red)", marginTop: 6 }}
                  onClick={() => {
                    const { taskId, collaboratorId } = todPopup;
                    setTodPopup(null);
                    handleReturnToPool(taskId!, collaboratorId!);
                  }}
                >
                  {p.returnToPool}
                </button>
              )}
            </div>
            <button className="tl-popup-close" onClick={() => setTodPopup(null)} aria-label={p.closeLabel}>×</button>
          </div>
        </>
      )}
      {absenceTech && (
        <TechnicianAbsenceFormModal
          collaboratorId={absenceTech.id}
          collaboratorName={absenceTech.name}
          onClose={() => setAbsenceTech(null)}
          onSaved={() => siteId != null && loadAll(siteId)}
        />
      )}
    </div>
  );
}
