import { useEffect, useMemo, useRef, useState } from "react";
import { FilterTh, useColumnFilters } from "../components/ui/ColumnFilter";
import { Link, useSearchParams } from "react-router-dom";
import { projectsApi } from "../api/resources";
import type { Project } from "../api/types";
import ProjectFormModal from "../components/projects/ProjectFormModal";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import ProjectWizardModal from "../components/projects/ProjectWizardModal";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import Pagination from "../components/ui/Pagination";
import StatCard from "../components/ui/StatCard";
import StatusBadge from "../components/ui/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { useTabs } from "../context/TabsContext";
import { useI18n, usePageText } from "../i18n";
import { downloadCsv } from "../utils/csv";
import { PERMS, hasPerm } from "../utils/permissions";

const TEXT = {
  "pt-BR": {
    eyebrow: "Portfólio", title: "Projetos",
    subtitle: "Acompanhe o portfólio, prazos e evolução operacional.",
    newProject: "Novo projeto",
    statActive: "Em andamento", statActiveHint: "projetos ativos",
    statPaused: "Pausados", statPausedHint: "aguardando retomada",
    statPlanning: "Planejamentos", statPlanningHint: "em preparação",
    statCompleted: "Finalizados", statCompletedHint: "concluídos ou cancelados",
    tabActive: "Ativos", tabPaused: "Pausados", tabPlanning: "Planejamentos", tabFinished: "Finalizados",
    viewKanban: "Visão Kanban", viewList: "Lista de projetos",
    found: (n: number) => `${n} projeto(s) encontrado(s)`,
    listView: "Visualização em lista", kanbanView: "Visualização em kanban",
    export: "Exportar",
    search: "Buscar", searchPlaceholder: "Buscar por nome ou PO...",
    client: "Cliente", site: "Site", category: "Categoria", all: "Todos", allFem: "Todas",
    loading: "Carregando...",
    colProject: "Projeto", colClientSite: "Cliente / Site", colTasks: "Tarefas",
    colProgress: "Progresso", colStatus: "Status", colDeadline: "Prazo", colActions: "Ações",
    tasksLabel: "tarefas",
    open: "Abrir", noProjects: "Nenhum projeto encontrado.",
    detailProgress: "progresso geral",
    detailClient: "Cliente", detailSite: "Site", detailCategory: "Categoria",
    detailTasks: "Tarefas", detailHours: "Horas", detailDeadline: "Prazo",
    openProject: "Abrir projeto", openTab: "Abrir em guia", edit: "Editar",
    deadlineNoDeadline: "Sem prazo", deadlineOverdue: (d: number) => `${d}d em atraso`,
    deadlineToday: "Vence hoje", deadlineDays: (d: number) => `${d}d restantes`,
    dropHere: "Soltar aqui", noProjectsKanban: "Nenhum projeto",
    moveNoPermission: "Você não tem permissão para alterar o status de projetos. Peça ao administrador para liberar a edição de projetos no seu grupo.",
    moveFailed: "Não foi possível mover o projeto. Tente novamente.",
    kanbanActive: "Em andamento", kanbanPaused: "Pausados", kanbanPlanning: "Planejamento", kanbanFinished: "Finalizados",
  },
  "en-US": {
    eyebrow: "Portfolio", title: "Projects",
    subtitle: "Track your portfolio, deadlines, and operational progress.",
    newProject: "New project",
    statActive: "In progress", statActiveHint: "active projects",
    statPaused: "Paused", statPausedHint: "awaiting resumption",
    statPlanning: "Planning", statPlanningHint: "in preparation",
    statCompleted: "Completed", statCompletedHint: "concluded or canceled",
    tabActive: "Active", tabPaused: "Paused", tabPlanning: "Planning", tabFinished: "Completed",
    viewKanban: "Kanban view", viewList: "Projects list",
    found: (n: number) => `${n} project(s) found`,
    listView: "List view", kanbanView: "Kanban view",
    export: "Export",
    search: "Search", searchPlaceholder: "Search by name or PO...",
    client: "Client", site: "Site", category: "Category", all: "All", allFem: "All",
    loading: "Loading...",
    colProject: "Project", colClientSite: "Client / Site", colTasks: "Tasks",
    colProgress: "Progress", colStatus: "Status", colDeadline: "Deadline", colActions: "Actions",
    tasksLabel: "tasks",
    open: "Open", noProjects: "No projects found.",
    detailProgress: "overall progress",
    detailClient: "Client", detailSite: "Site", detailCategory: "Category",
    detailTasks: "Tasks", detailHours: "Hours", detailDeadline: "Deadline",
    openProject: "Open project", openTab: "Open in tab", edit: "Edit",
    deadlineNoDeadline: "No deadline", deadlineOverdue: (d: number) => `${d}d overdue`,
    deadlineToday: "Due today", deadlineDays: (d: number) => `${d}d remaining`,
    dropHere: "Drop here", noProjectsKanban: "No projects",
    moveNoPermission: "You do not have permission to change project status. Ask an administrator to grant project editing to your group.",
    moveFailed: "Could not move the project. Please try again.",
    kanbanActive: "In progress", kanbanPaused: "Paused", kanbanPlanning: "Planning", kanbanFinished: "Completed",
  },
  "es-ES": {
    eyebrow: "Portafolio", title: "Proyectos",
    subtitle: "Sigue el portafolio, plazos y evolución operacional.",
    newProject: "Nuevo proyecto",
    statActive: "En curso", statActiveHint: "proyectos activos",
    statPaused: "Pausados", statPausedHint: "en espera de reanudación",
    statPlanning: "Planificación", statPlanningHint: "en preparación",
    statCompleted: "Finalizados", statCompletedHint: "concluidos o cancelados",
    tabActive: "Activos", tabPaused: "Pausados", tabPlanning: "Planificación", tabFinished: "Finalizados",
    viewKanban: "Vista Kanban", viewList: "Lista de proyectos",
    found: (n: number) => `${n} proyecto(s) encontrado(s)`,
    listView: "Vista de lista", kanbanView: "Vista Kanban",
    export: "Exportar",
    search: "Buscar", searchPlaceholder: "Buscar por nombre o PO...",
    client: "Cliente", site: "Sitio", category: "Categoría", all: "Todos", allFem: "Todas",
    loading: "Cargando...",
    colProject: "Proyecto", colClientSite: "Cliente / Sitio", colTasks: "Tareas",
    colProgress: "Progreso", colStatus: "Estado", colDeadline: "Plazo", colActions: "Acciones",
    tasksLabel: "tareas",
    open: "Abrir", noProjects: "Ningún proyecto encontrado.",
    detailProgress: "progreso general",
    detailClient: "Cliente", detailSite: "Sitio", detailCategory: "Categoría",
    detailTasks: "Tareas", detailHours: "Horas", detailDeadline: "Plazo",
    openProject: "Abrir proyecto", openTab: "Abrir en pestaña", edit: "Editar",
    deadlineNoDeadline: "Sin plazo", deadlineOverdue: (d: number) => `${d}d de retraso`,
    deadlineToday: "Vence hoy", deadlineDays: (d: number) => `${d}d restantes`,
    dropHere: "Soltar aquí", noProjectsKanban: "Ningún proyecto",
    moveNoPermission: "No tienes permiso para cambiar el estado de los proyectos. Pide a un administrador que habilite la edición de proyectos en tu grupo.",
    moveFailed: "No se pudo mover el proyecto. Inténtalo de nuevo.",
    kanbanActive: "En curso", kanbanPaused: "Pausados", kanbanPlanning: "Planificación", kanbanFinished: "Finalizados",
  },
};

type TabKey = "in_progress" | "paused" | "planning" | "completed";
type ViewMode = "list" | "kanban";

function formatHours(hours: number) {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatDate(value: string | null, locale: string) {
  if (!value) return "—";
  return new Date(value + "T00:00:00").toLocaleDateString(locale);
}

function daysDiff(value: string | null): number | null {
  if (!value) return null;
  const target = new Date(value + "T00:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86400000);
}

function exportCsv(projects: Project[]) {
  const header = ["Codigo", "Projeto", "Site", "Cliente", "Categoria", "Horas", "Tarefas", "Progresso", "Status", "Prazo"];
  const rows = projects.map((p) => [
    p.code,
    p.name,
    p.site_name || "",
    p.client_name || "",
    p.category_name || "",
    formatHours(p.worked_hours),
    `${p.completed_tasks}/${p.total_tasks}`,
    `${p.progress_percent}%`,
    p.status_display,
    p.planned_end || "",
  ]);
  downloadCsv("projetos.csv", [header, ...rows]);
}

function DeadlineLabel({ planned_end, noDeadline, overdue, today, days }: {
  planned_end: string | null;
  noDeadline: string;
  overdue: (d: number) => string;
  today: string;
  days: (d: number) => string;
}) {
  const diff = daysDiff(planned_end);
  if (diff === null) return <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{noDeadline}</span>;
  if (diff < 0)
    return <span style={{ color: "var(--red)", fontSize: 11, fontWeight: 600 }}>{overdue(Math.abs(diff))}</span>;
  if (diff === 0)
    return <span style={{ color: "var(--orange)", fontSize: 11, fontWeight: 600 }}>{today}</span>;
  if (diff <= 14)
    return <span style={{ color: "var(--orange)", fontSize: 11 }}>{days(diff)}</span>;
  return <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{days(diff)}</span>;
}

type PL = typeof TEXT["pt-BR"];

// ── Detail panel shown beside the list ──────────────────────────────────────
function DetailPanel({ project, canChange, onEdit, onClose, onOpenTab, p }: {
  project: Project;
  canChange: boolean;
  onEdit: (p: Project) => void;
  onClose: () => void;
  onOpenTab: (p: Project) => void;
  p: PL;
}) {
  const { locale } = useI18n();
  const diff = daysDiff(project.planned_end);
  const progressColor =
    project.progress_percent >= 80 ? "var(--green)" :
    project.progress_percent >= 40 ? "var(--blue)" : "var(--red)";

  return (
    <div style={{
      width: 240,
      flexShrink: 0,
      borderLeft: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      background: "var(--surface)",
    }}>
      {/* header */}
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", lineHeight: 1.3, marginBottom: 2 }}>{project.name}</div>
          {project.po && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>PO: {project.po}</div>}
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, flexShrink: 0 }}
        >
          <Icon name="close" style={{ fontSize: 16 }} />
        </button>
      </div>

      {/* big progress */}
      <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: progressColor, lineHeight: 1 }}>{project.progress_percent}%</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, marginBottom: 10 }}>{p.detailProgress}</div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${project.progress_percent}%`, background: progressColor }} />
        </div>
      </div>

      {/* stats */}
      <div style={{ padding: "12px 16px", flex: 1, overflowY: "auto" }}>
        {[
          { label: p.detailClient, value: project.client_name || "—" },
          { label: p.detailSite, value: project.site_name || "—" },
          { label: p.detailCategory, value: project.category_name || "—" },
          { label: p.detailTasks, value: `${project.completed_tasks} / ${project.total_tasks}` },
          { label: p.detailHours, value: formatHours(project.worked_hours) },
          { label: p.detailDeadline, value: formatDate(project.planned_end, locale) },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{value}</span>
          </div>
        ))}
        {diff !== null && (
          <div style={{ padding: "8px 0" }}>
            <DeadlineLabel planned_end={project.planned_end} noDeadline={p.deadlineNoDeadline} overdue={p.deadlineOverdue} today={p.deadlineToday} days={p.deadlineDays} />
          </div>
        )}
      </div>

      {/* actions */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
        <Link to={`/projetos/${project.id}`} className="btn btn-primary btn-sm" style={{ textAlign: "center", textDecoration: "none" }}>
          {p.openProject}
        </Link>
        <button className="btn btn-outline btn-sm" onClick={() => onOpenTab(project)}>
          <Icon name="tab" style={{ fontSize: 14 }} /> {p.openTab}
        </button>
        {canChange && (
          <button className="btn btn-outline btn-sm" onClick={() => onEdit(project)}>
            <Icon name="edit" style={{ fontSize: 14 }} /> {p.edit}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Kanban card ──────────────────────────────────────────────────────────────
function KanbanCard({
  project, selected, onClick, onDragStart, draggable, p,
}: {
  project: Project;
  selected: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  draggable: boolean;
  p: PL;
}) {
  const diff = daysDiff(project.planned_end);
  const overdue = diff !== null && diff < 0;
  const overrideColor =
    project.status === "completed" ? "var(--green)" :
    overdue ? "var(--red)" :
    undefined;

  const borderColor = selected ? "var(--orange)" : "var(--border)";

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      style={{
        background: "var(--surface)",
        border: `1.5px solid ${borderColor}`,
        borderRadius: 8,
        padding: "11px 12px",
        marginBottom: 8,
        cursor: "grab",
        transition: "box-shadow 0.12s",
        boxShadow: selected ? "0 0 0 2px var(--orange-soft)" : undefined,
        opacity: 1,
      }}
      onMouseEnter={(e) => { if (!selected) (e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"); }}
      onMouseLeave={(e) => { if (!selected) (e.currentTarget.style.boxShadow = ""); }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", lineHeight: 1.35, marginBottom: 3 }}>{project.name}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
        {project.client_name || "—"} · {project.site_name || "—"}
      </div>
      <div className="progress-track" style={{ marginBottom: 6 }}>
        <div
          className="progress-fill"
          style={{ width: `${project.progress_percent}%`, ...(overrideColor ? { background: overrideColor } : {}) }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{project.completed_tasks}/{project.total_tasks} {p.tasksLabel}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>{project.progress_percent}%</span>
      </div>
      {diff !== null && (
        <div style={{ marginTop: 5 }}>
          <DeadlineLabel planned_end={project.planned_end} noDeadline={p.deadlineNoDeadline} overdue={p.deadlineOverdue} today={p.deadlineToday} days={p.deadlineDays} />
        </div>
      )}
    </div>
  );
}

// ── Kanban board ─────────────────────────────────────────────────────────────
const KANBAN_COLS_BASE: { key: string | string[]; labelKey: keyof PL; statusKey: string; color: string; dropStatus: string }[] = [
  { key: "in_progress", labelKey: "kanbanActive", statusKey: "in_progress", color: "#185fa5", dropStatus: "in_progress" },
  { key: "paused", labelKey: "kanbanPaused", statusKey: "paused", color: "#854f0b", dropStatus: "paused" },
  { key: ["planning", "not_started"], labelKey: "kanbanPlanning", statusKey: "planning", color: "#534ab7", dropStatus: "planning" },
  { key: ["completed", "canceled"], labelKey: "kanbanFinished", statusKey: "completed", color: "#3b6d11", dropStatus: "completed" },
];

function KanbanView({
  projects, selectedId, onSelect, onStatusChange, canMove, p,
}: {
  projects: Project[];
  selectedId: number | null;
  onSelect: (p: Project) => void;
  onStatusChange: (projectId: number, newStatus: string) => void;
  canMove: boolean;
  p: PL;
}) {
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const dragIdRef = useRef<number | null>(null);

  return (
    <div className="kanban-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, minHeight: 300 }}>
      {KANBAN_COLS_BASE.map((col, ci) => {
        const colProjects = projects.filter((proj) =>
          Array.isArray(col.key) ? col.key.includes(proj.status) : proj.status === col.key
        );
        const colLabel = p[col.labelKey] as string;
        const isOver = dragOverCol === col.dropStatus;
        return (
          <div
            key={ci}
            onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.dropStatus); }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverCol(null);
              if (dragIdRef.current !== null) {
                onStatusChange(dragIdRef.current, col.dropStatus);
                dragIdRef.current = null;
              }
            }}
            style={{
              borderRight: ci < 3 ? "1px solid var(--border)" : "none",
              padding: "14px 12px",
              background: isOver ? "var(--orange-soft)" : undefined,
              transition: "background 0.1s",
              minHeight: 80,
            }}
          >
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 12,
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {colLabel}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 700,
                background: col.statusKey === "in_progress" ? "#e6f1fb" :
                  col.statusKey === "paused" ? "#faeeda" :
                  col.statusKey === "planning" ? "#eeedfe" : "#eaf3de",
                color: col.color,
                borderRadius: 10, padding: "1px 8px",
              }}>
                {colProjects.length}
              </span>
            </div>
            {colProjects.length === 0 && (
              <div style={{
                fontSize: 12, color: "var(--text-faint)", textAlign: "center", padding: "20px 0",
                border: isOver ? "2px dashed var(--orange)" : "2px dashed transparent",
                borderRadius: 8, transition: "border-color 0.1s",
              }}>
                {isOver ? p.dropHere : p.noProjectsKanban}
              </div>
            )}
            {colProjects.map((proj) => (
              <KanbanCard
                key={proj.id}
                project={proj}
                selected={selectedId === proj.id}
                onClick={() => onSelect(proj)}
                draggable={canMove}
                onDragStart={(e) => {
                  dragIdRef.current = proj.id;
                  e.dataTransfer.effectAllowed = "move";
                }}
                p={p}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function ProjectsList() {
  const { user } = useAuth();
  const { openTab } = useTabs();
  const lp = usePageText(TEXT);
  const { locale } = useI18n();
  const canAdd = hasPerm(user, PERMS.addProject);
  const canChange = hasPerm(user, PERMS.changeProject);

  function handleOpenProjectTab(p: Project) {
    const path = `/projetos/${p.id}`;
    // abre a guia e permanece na tela atual
    openTab({ id: path, label: p.name || p.code || `Projeto ${p.id}`, path, icon: "folder" });
  }
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabKey = (searchParams.get("tab") as TabKey) || "in_progress";
  function setTab(next: TabKey) {
    setSearchParams(next === "in_progress" ? {} : { tab: next }, { replace: true });
  }
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [siteFilter, setSiteFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function reload() {
    setLoading(true);
    projectsApi
      .list()
      .then((data) => setProjects(data.results))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, []);

  function openCreate() { setWizardOpen(true); }
  function openEdit(project: Project) { setEditingProject(project); setFormOpen(true); }
  function handleSaved() { setFormOpen(false); reload(); }
  function handleWizardSaved() { reload(); }

  useEffect(() => { setPage(1); }, [tab, search, clientFilter, siteFilter, categoryFilter]);

  // close detail panel on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setSelectedProject(null);
      }
    }
    if (selectedProject) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [selectedProject]);

  const scoped = useMemo(() => {
    const statusMap: Record<TabKey, string | string[]> = {
      in_progress: "in_progress",
      paused: "paused",
      planning: ["planning", "not_started"],
      completed: ["completed", "canceled"],
    };
    const target = statusMap[tab];
    return projects.filter((p) =>
      Array.isArray(target) ? target.includes(p.status) : p.status === target
    );
  }, [projects, tab]);

  // In kanban mode, search/filters apply to all projects
  const kanbanBase = useMemo(() => projects.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.po.toLowerCase().includes(search.toLowerCase())) return false;
    if (clientFilter.length && !clientFilter.includes(p.client_name ?? "")) return false;
    if (siteFilter.length && !siteFilter.includes(p.site_name ?? "")) return false;
    if (categoryFilter.length && !categoryFilter.includes(p.category_name ?? "")) return false;
    return true;
  }), [projects, search, clientFilter, siteFilter, categoryFilter]);

  const clientOptions = useMemo(() => Array.from(new Set(
    (viewMode === "kanban" ? projects : scoped).map((p) => p.client_name).filter(Boolean)
  )) as string[], [scoped, projects, viewMode]);

  const siteOptions = useMemo(() => Array.from(new Set(
    (viewMode === "kanban" ? projects : scoped).map((p) => p.site_name).filter(Boolean)
  )) as string[], [scoped, projects, viewMode]);

  const categoryOptions = useMemo(() => Array.from(new Set(
    (viewMode === "kanban" ? projects : scoped).map((p) => p.category_name).filter(Boolean)
  )) as string[], [scoped, projects, viewMode]);

  const baseFiltered = useMemo(() => {
    return scoped.filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.po.toLowerCase().includes(search.toLowerCase())) return false;
      if (clientFilter.length && !clientFilter.includes(p.client_name ?? "")) return false;
      if (siteFilter.length && !siteFilter.includes(p.site_name ?? "")) return false;
      if (categoryFilter.length && !categoryFilter.includes(p.category_name ?? "")) return false;
      return true;
    });
  }, [scoped, search, clientFilter, siteFilter, categoryFilter]);

  // Filtro por coluna (clicar no título da coluna da lista)
  const { filtered, filters: colFilters } = useColumnFilters<Project>(baseFiltered, {
    project: (pr) => pr.name,
    client_site: (pr) => `${pr.client_name || "—"} / ${pr.site_name || "—"}`,
    tasks: (pr) => `${pr.completed_tasks}/${pr.total_tasks}`,
    progress: (pr) => `${pr.progress_percent}%`,
    status: (pr) => pr.status_display,
    deadline: (pr) => formatDate(pr.planned_end, locale),
  });
  useEffect(() => {
    setPage(1);
  }, [colFilters.selected]);

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const inProgressCount = projects.filter((p) => p.status === "in_progress").length;
  const pausedCount = projects.filter((p) => p.status === "paused").length;
  const planningCount = projects.filter((p) => p.status === "planning" || p.status === "not_started").length;
  const completedCount = projects.filter((p) => p.status === "completed" || p.status === "canceled").length;

  const activeCount = viewMode === "kanban" ? kanbanBase.length : filtered.length;

  return (
    <div>
      <PageHeader
        eyebrow={lp.eyebrow}
        title={lp.title}
        subtitle={lp.subtitle}
        actions={
          canAdd ? (
            <button className="btn btn-primary" onClick={openCreate}>
              <Icon name="add" style={{ fontSize: 18 }} />
              {lp.newProject}
            </button>
          ) : undefined
        }
      />

      <div className="stat-grid">
        <StatCard label={lp.statActive} value={inProgressCount} hint={lp.statActiveHint} />
        <StatCard label={lp.statPaused} value={pausedCount} hint={lp.statPausedHint} />
        <StatCard label={lp.statPlanning} value={planningCount} hint={lp.statPlanningHint} />
        <StatCard label={lp.statCompleted} value={completedCount} hint={lp.statCompletedHint} />
      </div>

      <div className="card" style={{ padding: 0, overflow: "visible" }}>

        {/* tabs — only in list mode */}
        {viewMode === "list" && (
          <>
            <div className="tabs" style={{ padding: "16px 20px 0", marginBottom: 0, borderBottom: "none" }}>
              <button className={`tab-btn${tab === "in_progress" ? " active" : ""}`} onClick={() => setTab("in_progress")}>{lp.tabActive}</button>
              <button className={`tab-btn${tab === "paused" ? " active" : ""}`} onClick={() => setTab("paused")}>{lp.tabPaused}</button>
              <button className={`tab-btn${tab === "planning" ? " active" : ""}`} onClick={() => setTab("planning")}>{lp.tabPlanning}</button>
              <button className={`tab-btn${tab === "completed" ? " active" : ""}`} onClick={() => setTab("completed")}>{lp.tabFinished}</button>
            </div>
            <div style={{ borderBottom: "1px solid var(--border)" }} />
          </>
        )}

        {/* toolbar */}
        <div className="toolbar" style={{ padding: "14px 20px" }}>
          <div>
            <div className="toolbar-title">
              {viewMode === "kanban" ? lp.viewKanban : lp.viewList}
            </div>
            <div className="toolbar-subtitle">{lp.found(activeCount)}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* view toggle */}
            <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
              <button
                title="Visualização em lista"
                onClick={() => setViewMode("list")}
                style={{
                  padding: "5px 10px", border: "none", cursor: "pointer",
                  background: viewMode === "list" ? "var(--orange)" : "transparent",
                  color: viewMode === "list" ? "#fff" : "var(--text-muted)",
                  borderRight: "1px solid var(--border)",
                  display: "flex", alignItems: "center",
                }}
              >
                <Icon name="view_list" style={{ fontSize: 16 }} />
              </button>
              <button
                title="Visualização em kanban"
                onClick={() => { setViewMode("kanban"); setSelectedProject(null); }}
                style={{
                  padding: "5px 10px", border: "none", cursor: "pointer",
                  background: viewMode === "kanban" ? "var(--orange)" : "transparent",
                  color: viewMode === "kanban" ? "#fff" : "var(--text-muted)",
                  display: "flex", alignItems: "center",
                }}
              >
                <Icon name="view_kanban" style={{ fontSize: 16 }} />
              </button>
            </div>
            <button className="btn btn-outline" onClick={() => exportCsv(viewMode === "kanban" ? kanbanBase : filtered)}>
              <Icon name="download" style={{ fontSize: 16 }} />
              {lp.export}
            </button>
          </div>
        </div>

        {/* filters */}
        <div className="filter-row" style={{ padding: "0 20px 14px" }}>
          <div className="field-group" style={{ flex: 1, minWidth: 220 }}>
            <span className="field-label">{lp.search}</span>
            <div className="search-input-wrap">
              <Icon name="search" />
              <input
                className="input"
                placeholder={lp.searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <MultiSelectFilter
            label={lp.client}
            options={clientOptions.map((c) => ({ value: c, label: c }))}
            selected={clientFilter}
            onChange={setClientFilter}
            allLabel={lp.all}
          />
          <MultiSelectFilter
            label={lp.site}
            options={siteOptions.map((s) => ({ value: s, label: s }))}
            selected={siteFilter}
            onChange={setSiteFilter}
            allLabel={lp.all}
          />
          <MultiSelectFilter
            label={lp.category}
            options={categoryOptions.map((c) => ({ value: c, label: c }))}
            selected={categoryFilter}
            onChange={setCategoryFilter}
            allLabel={lp.allFem}
          />
        </div>

        <div style={{ borderTop: "1px solid var(--border)" }} />

        {loading ? (
          <p style={{ padding: 20, color: "var(--text-muted)" }}>{lp.loading}</p>
        ) : viewMode === "kanban" ? (
          /* ── KANBAN VIEW ── */
          <>
          {moveError && (
            <div role="alert" style={{ margin: "12px 16px 0", padding: "10px 14px", borderRadius: 8, background: "var(--red-soft)", color: "var(--red)", fontSize: 13, display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>{moveError}</span>
              <button type="button" onClick={() => setMoveError(null)} aria-label="Fechar" style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: 700 }}>×</button>
            </div>
          )}
          <div className="projects-layout" style={{ display: "flex", alignItems: "flex-start" }}>
            <div className="kanban-scroll-wrap" style={{ flex: 1, minWidth: 0 }}>
              <KanbanView
                projects={kanbanBase}
                selectedId={selectedProject?.id ?? null}
                onSelect={setSelectedProject}
                canMove={canChange}
                onStatusChange={(projectId, newStatus) => {
                  if (!canChange) { setMoveError(lp.moveNoPermission); return; }
                  setMoveError(null);
                  const STATUS_DISPLAY: Record<string, string> = {
                    in_progress: lp.kanbanActive,
                    paused: lp.kanbanPaused,
                    planning: lp.kanbanPlanning,
                    completed: lp.kanbanFinished,
                    canceled: lp.kanbanFinished,
                  };
                  const current = projects.find((pr) => pr.id === projectId);
                  if (!current || current.status === newStatus) return;
                  const display = STATUS_DISPLAY[newStatus] ?? newStatus;
                  setProjects((prev) => prev.map((pr) => pr.id === projectId ? { ...pr, status: newStatus, status_display: display } : pr));
                  if (selectedProject?.id === projectId) setSelectedProject((prev) => prev ? { ...prev, status: newStatus, status_display: display } : prev);
                  projectsApi.update(projectId, { status: newStatus } as Partial<Project>).catch((err: { response?: { status?: number } }) => {
                    setMoveError(err?.response?.status === 403 ? lp.moveNoPermission : lp.moveFailed);
                    reload();
                  });
                }}
                p={lp}
              />
            </div>
            {selectedProject && (
              <div className="projects-detail-panel" ref={panelRef}>
                <DetailPanel
                  project={selectedProject}
                  canChange={canChange}
                  onEdit={openEdit}
                  onClose={() => setSelectedProject(null)}
                  onOpenTab={handleOpenProjectTab}
                  p={lp}
                />
              </div>
            )}
          </div>
          </>
        ) : (
          /* ── LIST VIEW ── */
          <div className="projects-layout" style={{ display: "flex", alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
              <table className="table" style={{ minWidth: 700 }}>
                <thead>
                  <tr>
                    <FilterTh colKey="project" label={lp.colProject} filters={colFilters} style={{ minWidth: 200 }} />
                    <FilterTh colKey="client_site" label={lp.colClientSite} filters={colFilters} />
                    <FilterTh colKey="tasks" label={lp.colTasks} filters={colFilters} style={{ textAlign: "center" }} align="center" />
                    <FilterTh colKey="progress" label={lp.colProgress} filters={colFilters} style={{ minWidth: 160 }} />
                    <FilterTh colKey="status" label={lp.colStatus} filters={colFilters} />
                    <FilterTh colKey="deadline" label={lp.colDeadline} filters={colFilters} />
                    <th>{lp.colActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((pr) => {
                    const isSelected = selectedProject?.id === pr.id;
                    const diff = daysDiff(pr.planned_end);
                    const overrideColor =
                      pr.status === "completed" ? "var(--green)" :
                      diff !== null && diff < 0 ? "var(--red)" :
                      undefined;
                    return (
                      <tr
                        key={pr.id}
                        style={{
                          background: isSelected ? "var(--surface-2)" : undefined,
                          cursor: "pointer",
                        }}
                        onClick={() => setSelectedProject(isSelected ? null : pr)}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <Link to={`/projetos/${pr.id}`} className="project-cell-link" title={lp.open}>
                            <div className="project-cell-name">{pr.name}</div>
                            {pr.po && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>PO: {pr.po}</div>}
                          </Link>
                        </td>
                        <td>
                          <div style={{ fontSize: 13, color: "var(--text)" }}>{pr.client_name || "—"}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{pr.site_name || "—"}</div>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                            {pr.completed_tasks}<span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>/{pr.total_tasks}</span>
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{lp.tasksLabel}</div>
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div className="progress-track" style={{ flex: 1 }}>
                              <div
                                className="progress-fill"
                                style={{ width: `${pr.progress_percent}%`, ...(overrideColor ? { background: overrideColor } : {}) }}
                              />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", minWidth: 32, textAlign: "right" }}>
                              {pr.progress_percent}%
                            </span>
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={pr.status} label={pr.status_display} />
                        </td>
                        <td>
                          <div style={{ fontSize: 12, color: "var(--text)" }}>{formatDate(pr.planned_end, locale)}</div>
                          <DeadlineLabel planned_end={pr.planned_end} noDeadline={lp.deadlineNoDeadline} overdue={lp.deadlineOverdue} today={lp.deadlineToday} days={lp.deadlineDays} />
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <Link to={`/projetos/${pr.id}`} className="btn btn-outline btn-sm">{lp.open}</Link>
                            {canChange && (
                              <button className="btn btn-outline btn-sm" onClick={() => openEdit(pr)}>
                                <Icon name="edit" style={{ fontSize: 14 }} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {paged.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <div className="table-empty">{lp.noProjects}</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {selectedProject && (
              <div className="projects-detail-panel" ref={panelRef}>
                <DetailPanel
                  project={selectedProject}
                  canChange={canChange}
                  onEdit={openEdit}
                  onClose={() => setSelectedProject(null)}
                  onOpenTab={handleOpenProjectTab}
                  p={lp}
                />
              </div>
            )}
          </div>
        )}

        {viewMode === "list" && (
          <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        )}
      </div>

      {wizardOpen && canAdd && (
        <ProjectWizardModal onClose={() => setWizardOpen(false)} onSaved={handleWizardSaved} />
      )}
      {formOpen && editingProject && canChange && (
        <ProjectFormModal project={editingProject} onClose={() => setFormOpen(false)} onSaved={handleSaved} />
      )}
    </div>
  );
}
