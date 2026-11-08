import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { dashboardApi } from "../api/resources";
import type { ProjectsPerformanceData, TechnicalPerformanceData } from "../api/types";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import { useAuth } from "../context/AuthContext";
import { usePageText } from "../i18n";
import { PERMS, hasPerm } from "../utils/permissions";

const TEXT = {
  "pt-BR": {
    greeting: (): string => { const h = new Date().getHours(); return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; },
    subtitle: "Acompanhe as pendências e acesse os módulos do sistema.",
    kpiActive: "Em andamento", kpiActiveHint: "projetos ativos",
    kpiOverdue: "Em atraso", kpiOverdueHint: "prazo vencido",
    kpiTasks: "Tarefas concluídas", kpiTasksHint: "acumuladas",
    kpiHours: "Horas trabalhadas", kpiHoursHint: "acumuladas",
    quickAccess: "Acesso rápido", customize: "Personalizar atalhos",
    add: "Adicionar",
    alerts: "Atenção imediata", overdueCount: (n: number) => `${n} em atraso`,
    viewProjects: "Ver projetos →",
    loading: "Carregando...",
    tagOverdue: "Atrasado", tagUrgent: "Urgente",
    modalTitle: "Personalizar atalhos",
    modalSubtitle: (max: number) => `Selecione até ${max} atalhos para exibir na tela inicial.`,
    selected: (n: number, max: number) => `${n} / ${max} selecionados`,
    cancel: "Cancelar", save: "Salvar",
    noPermission: "Você não tem permissão para acessar esta página.",
    overdueLabel: (days: number) => `Prazo vencido há ${days} dia(s)`,
    dueIn: (days: number) => (days === 0 ? "Vence hoje" : `Vence em ${days} dia(s)`),
    semAlerta: "Nenhum alerta no momento",
    prazosOk: "Todos os prazos estão em dia",
    shortcuts: [
      { id: "projetos",     label: "Projetos",            sub: "Ver portfólio" },
      { id: "operacoes",    label: "Operações do dia",    sub: "Central de despacho" },
      { id: "timeline",     label: "Timeline",            sub: "Gantt operacional" },
      { id: "relatorios",   label: "Relatórios",          sub: "Indicadores" },
      { id: "tarefas",      label: "Minhas tarefas",      sub: "Visão do técnico" },
      { id: "atualizacoes", label: "Atualizações diárias",sub: "Relatório ao cliente" },
      { id: "mapa",         label: "Mapa de sites",       sub: "Localização das obras" },
      { id: "auditoria",    label: "Auditoria",           sub: "Log de alterações" },
      { id: "cadastros",    label: "Cadastros",           sub: "Dados mestres" },
      { id: "dashboard",    label: "Dashboard",           sub: "Performance técnica" },
    ],
  },
  "en-US": {
    greeting: () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; },
    subtitle: "Track pending items and access system modules.",
    kpiActive: "In progress", kpiActiveHint: "active projects",
    kpiOverdue: "Overdue", kpiOverdueHint: "deadline passed",
    kpiTasks: "Tasks completed", kpiTasksHint: "accumulated",
    kpiHours: "Hours worked", kpiHoursHint: "accumulated",
    quickAccess: "Quick access", customize: "Customize shortcuts",
    add: "Add",
    alerts: "Immediate attention", overdueCount: (n: number) => `${n} overdue`,
    viewProjects: "View projects →",
    loading: "Loading...",
    tagOverdue: "Overdue", tagUrgent: "Urgent",
    modalTitle: "Customize shortcuts",
    modalSubtitle: (max: number) => `Select up to ${max} shortcuts to display on the home screen.`,
    selected: (n: number, max: number) => `${n} / ${max} selected`,
    cancel: "Cancel", save: "Save",
    noPermission: "You don't have permission to access this page.",
    overdueLabel: (days: number) => `Overdue by ${days} day(s)`,
    dueIn: (days: number) => (days === 0 ? "Due today" : `Due in ${days} day(s)`),
    semAlerta: "No alerts at the moment",
    prazosOk: "All deadlines are on track",
    shortcuts: [
      { id: "projetos",     label: "Projects",           sub: "View portfolio" },
      { id: "operacoes",    label: "Today's operations", sub: "Dispatch center" },
      { id: "timeline",     label: "Timeline",           sub: "Operational Gantt" },
      { id: "relatorios",   label: "Reports",            sub: "Indicators" },
      { id: "tarefas",      label: "My tasks",           sub: "Technician view" },
      { id: "atualizacoes", label: "Daily updates",      sub: "Client report" },
      { id: "mapa",         label: "Sites map",          sub: "Job site locations" },
      { id: "auditoria",    label: "Audit",              sub: "Change log" },
      { id: "cadastros",    label: "Registries",         sub: "Master data" },
      { id: "dashboard",    label: "Dashboard",          sub: "Technical performance" },
    ],
  },
  "es-ES": {
    greeting: () => { const h = new Date().getHours(); return h < 12 ? "Buenos días" : h < 18 ? "Buenas tardes" : "Buenas noches"; },
    subtitle: "Sigue las pendientes y accede a los módulos del sistema.",
    kpiActive: "En curso", kpiActiveHint: "proyectos activos",
    kpiOverdue: "En atraso", kpiOverdueHint: "plazo vencido",
    kpiTasks: "Tareas completadas", kpiTasksHint: "acumuladas",
    kpiHours: "Horas trabajadas", kpiHoursHint: "acumuladas",
    quickAccess: "Acceso rápido", customize: "Personalizar accesos",
    add: "Agregar",
    alerts: "Atención inmediata", overdueCount: (n: number) => `${n} en atraso`,
    viewProjects: "Ver proyectos →",
    loading: "Cargando...",
    tagOverdue: "Atrasado", tagUrgent: "Urgente",
    modalTitle: "Personalizar accesos directos",
    modalSubtitle: (max: number) => `Selecciona hasta ${max} accesos para mostrar en la pantalla de inicio.`,
    selected: (n: number, max: number) => `${n} / ${max} seleccionados`,
    cancel: "Cancelar", save: "Guardar",
    noPermission: "No tienes permiso para acceder a esta página.",
    overdueLabel: (days: number) => `Vencido hace ${days} día(s)`,
    dueIn: (days: number) => (days === 0 ? "Vence hoy" : `Vence en ${days} día(s)`),
    semAlerta: "Sin alertas por el momento",
    prazosOk: "Todos los plazos están al día",
    shortcuts: [
      { id: "projetos",     label: "Proyectos",          sub: "Ver portafolio" },
      { id: "operacoes",    label: "Operaciones del día",sub: "Central de despacho" },
      { id: "timeline",     label: "Timeline",           sub: "Gantt operacional" },
      { id: "relatorios",   label: "Informes",           sub: "Indicadores" },
      { id: "tarefas",      label: "Mis tareas",         sub: "Vista del técnico" },
      { id: "atualizacoes", label: "Actualizaciones",    sub: "Reporte al cliente" },
      { id: "mapa",         label: "Mapa de sitios",     sub: "Ubicación de obras" },
      { id: "auditoria",    label: "Auditoría",          sub: "Registro de cambios" },
      { id: "cadastros",    label: "Registros",          sub: "Datos maestros" },
      { id: "dashboard",    label: "Dashboard",          sub: "Performance técnica" },
    ],
  },
};

// ── Shortcut catalog ─────────────────────────────────────────────────────────
interface ShortcutDef {
  id: string;
  label: string;
  sub: string;
  icon: string;
  path: string;
  perm?: string;
}

const SHORTCUT_META: Record<string, { icon: string; path: string }> = {
  projetos:     { icon: "folder_open",     path: "/projetos" },
  operacoes:    { icon: "manage_accounts", path: "/operacao-do-dia" },
  timeline:     { icon: "view_timeline",   path: "/timeline-operacional" },
  relatorios:   { icon: "bar_chart",       path: "/relatorios-indicadores" },
  tarefas:      { icon: "checklist",       path: "/minhas-tarefas" },
  atualizacoes: { icon: "send",            path: "/atualizacoes-diarias" },
  mapa:         { icon: "map",             path: "/sites/mapa" },
  auditoria:    { icon: "policy",          path: "/auditoria" },
  cadastros:    { icon: "database",        path: "/cadastros" },
  dashboard:    { icon: "monitoring",      path: "/dashboard" },
};

const DEFAULT_SHORTCUTS = ["projetos", "operacoes", "timeline", "relatorios"];
const MAX_SHORTCUTS = 6;

function loadShortcuts(userId: string | number): string[] {
  try {
    const raw = localStorage.getItem(`home_shortcuts_${userId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_SHORTCUTS;
}

function saveShortcuts(userId: string | number, ids: string[]) {
  try { localStorage.setItem(`home_shortcuts_${userId}`, JSON.stringify(ids)); } catch {}
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatHours(hours: number) {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function daysDiff(value: string | null): number | null {
  if (!value) return null;
  const target = new Date(value + "T00:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86400000);
}

function greeting() {
  return "";
}

type DP = typeof TEXT["pt-BR"];

// ── Shortcut editor modal ────────────────────────────────────────────────────
function ShortcutEditor({
  selected, onSave, onClose, p, allShortcuts,
}: {
  selected: string[];
  onSave: (ids: string[]) => void;
  onClose: () => void;
  p: DP;
  allShortcuts: ShortcutDef[];
}) {
  const [draft, setDraft] = useState<string[]>(selected);

  function toggle(id: string) {
    setDraft((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < MAX_SHORTCUTS ? [...prev, id] : prev
    );
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "var(--white)", borderRadius: 12, width: 420, maxWidth: "calc(100vw - 32px)", boxShadow: "0 8px 32px rgba(0,0,0,0.16)" }}>
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{p.modalTitle}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {p.modalSubtitle(MAX_SHORTCUTS)}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4 }}>
            <Icon name="close" style={{ fontSize: 20 }} />
          </button>
        </div>

        <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
          {allShortcuts.map((s) => {
            const active = draft.includes(s.id);
            const disabled = !active && draft.length >= MAX_SHORTCUTS;
            return (
              <div
                key={s.id}
                onClick={() => !disabled && toggle(s.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                  borderRadius: 8, border: `1px solid ${active ? "var(--orange)" : "var(--border)"}`,
                  background: active ? "var(--orange-soft)" : "var(--surface)",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.4 : 1,
                  transition: "all 0.12s",
                }}
              >
                <Icon name={s.icon} style={{ fontSize: 20, color: active ? "var(--orange)" : "var(--text-muted)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: active ? "var(--orange)" : "var(--text)" }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.sub}</div>
                </div>
                <div style={{
                  width: 18, height: 18, borderRadius: 4, border: `2px solid ${active ? "var(--orange)" : "var(--border)"}`,
                  background: active ? "var(--orange)" : "transparent", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {active && <Icon name="check" style={{ fontSize: 13, color: "#fff" }} />}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.selected(draft.length, MAX_SHORTCUTS)}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-outline" onClick={onClose}>{p.cancel}</button>
            <button className="btn btn-primary" onClick={() => { onSave(draft); onClose(); }}>{p.save}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const p = usePageText(TEXT);
  const canViewProjects = hasPerm(user, PERMS.viewProject);
  const canViewTechnical = hasPerm(user, PERMS.viewCollaborator);

  const allShortcuts: ShortcutDef[] = useMemo(
    () => p.shortcuts.map((s) => ({ ...s, ...(SHORTCUT_META[s.id] ?? { icon: "link", path: "/" }) })),
    [p.shortcuts]
  );

  const userId = user?.id ?? "guest";
  const [shortcuts, setShortcuts] = useState<string[]>(() => loadShortcuts(userId));
  const [editorOpen, setEditorOpen] = useState(false);

  const [projectsData, setProjectsData] = useState<ProjectsPerformanceData | null>(null);
  const [technical, setTechnical] = useState<TechnicalPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const reqs: Promise<unknown>[] = [];
    if (canViewProjects) reqs.push(dashboardApi.projects({}).then(setProjectsData));
    if (canViewTechnical) reqs.push(dashboardApi.technical({}).then(setTechnical));
    Promise.all(reqs).finally(() => setLoading(false));
  }, [canViewProjects, canViewTechnical]);

  function handleSaveShortcuts(ids: string[]) {
    setShortcuts(ids);
    saveShortcuts(userId, ids);
  }

  const activeShortcuts = useMemo(
    () => allShortcuts.filter((s) => shortcuts.includes(s.id)).sort((a, b) => shortcuts.indexOf(a.id) - shortcuts.indexOf(b.id)),
    [allShortcuts, shortcuts]
  );

  // Build alert list from projects data
  const alerts = useMemo(() => {
    if (!projectsData) return [];
    const list: { id: number | null; name: string; meta: string; level: "red" | "orange" | "blue" }[] = [];

    // Overdue projects
    projectsData.projects
      .filter((pr) => pr.is_overdue)
      .slice(0, 3)
      .forEach((pr) => {
        const diff = daysDiff(pr.planned_end ?? null);
        const days = diff !== null ? Math.abs(diff) : 0;
        list.push({ id: pr.id, name: pr.name, meta: `${pr.code} · ${p.overdueLabel(days)} · ${pr.client || "—"}`, level: "red" });
      });

    // Near deadline (within 7 days, not overdue)
    projectsData.projects
      .filter((pr) => {
        if (pr.is_overdue) return false;
        const diff = daysDiff(pr.planned_end ?? null);
        return diff !== null && diff <= 7;
      })
      .slice(0, 4)
      .forEach((pr) => {
        const diff = daysDiff(pr.planned_end ?? null);
        list.push({ id: pr.id, name: pr.name, meta: `${pr.code} · ${p.dueIn(diff ?? 0)} · ${pr.client || "—"}`, level: "orange" });
      });

    if (list.length === 0 && !loading) {
      list.push({ id: null, name: p.semAlerta, meta: p.prazosOk, level: "blue" });
    }

    return list.slice(0, 6);
  }, [projectsData, loading]);

  // KPI values
  const kpis = useMemo(() => {
    const active = projectsData?.by_status.find((s) => s.status === "in_progress")?.count ?? 0;
    const overdue = projectsData?.summary.overdue_projects ?? 0;
    const hours = technical?.summary.total_hours_worked ?? projectsData?.summary.total_worked_hours ?? 0;
    const tasks = technical?.summary.total_tasks_completed ?? 0;
    return { active, overdue, hours, tasks };
  }, [projectsData, technical]);

  const firstName = user?.full_name?.split(" ")[0] || user?.username || "você";
  const cols = 3;

  if (!canViewProjects && !canViewTechnical) {
    return <p style={{ padding: 32, color: "var(--text-muted)" }}>{p.noPermission}</p>;
  }

  return (
    <div>
      <PageHeader
        eyebrow={p.greeting()}
        title={firstName}
        subtitle={p.subtitle}
      />

      {/* KPI row */}
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--blue)", lineHeight: 1 }}>{loading ? "—" : kpis.active}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 6 }}>{p.kpiActive}</div>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>{p.kpiActiveHint}</div>
        </div>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: kpis.overdue > 0 ? "var(--red)" : "var(--green)", lineHeight: 1 }}>{loading ? "—" : kpis.overdue}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 6 }}>{p.kpiOverdue}</div>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>{p.kpiOverdueHint}</div>
        </div>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>{loading ? "—" : kpis.tasks}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 6 }}>{p.kpiTasks}</div>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>{p.kpiTasksHint}</div>
        </div>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>{loading ? "—" : formatHours(kpis.hours)}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 6 }}>{p.kpiHours}</div>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>{p.kpiHoursHint}</div>
        </div>
      </div>

      {/* Main 2-col layout */}
      <div className="dashboard-main-grid" style={{ display: "grid", gridTemplateColumns: "2fr 3fr", gap: 16, alignItems: "flex-start" }}>

        {/* Atalhos */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="grid_view" style={{ fontSize: 16, color: "var(--text-muted)" }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{p.quickAccess}</span>
            </div>
            <button
              onClick={() => setEditorOpen(true)}
              title="Personalizar atalhos"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex", alignItems: "center", gap: 4 }}
            >
              <Icon name="tune" style={{ fontSize: 16 }} />
            </button>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            padding: 12,
            gap: 8,
          }}>
            {activeShortcuts.map((s) => (
              <Link
                key={s.id}
                to={s.path}
                style={{ textDecoration: "none" }}
              >
                <div
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8, padding: "12px 10px",
                    display: "flex", flexDirection: "column", alignItems: "center",
                    gap: 6, cursor: "pointer", transition: "all 0.12s",
                    textAlign: "center",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--orange)"; (e.currentTarget as HTMLDivElement).style.background = "var(--orange-soft)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLDivElement).style.background = "var(--surface)"; }}
                >
                  <Icon name={s.icon} style={{ fontSize: 22, color: "var(--orange)" }} />
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>{s.label}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.2 }}>{s.sub}</div>
                </div>
              </Link>
            ))}

            {/* Add shortcut placeholder */}
            {activeShortcuts.length < MAX_SHORTCUTS && (
              <div
                onClick={() => setEditorOpen(true)}
                style={{
                  border: "1px dashed var(--border)", borderRadius: 8, padding: "12px 10px",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                  cursor: "pointer", opacity: 0.5, textAlign: "center",
                }}
              >
                <Icon name="add" style={{ fontSize: 22, color: "var(--text-muted)" }} />
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{p.add}</div>
              </div>
            )}
          </div>
        </div>

        {/* Alertas */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="warning" style={{ fontSize: 16, color: "var(--orange)" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{p.alerts}</span>
            {kpis.overdue > 0 && (
              <span style={{ background: "var(--red-soft)", color: "var(--red)", fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 10 }}>
                {p.overdueCount(kpis.overdue)}
              </span>
            )}
            <div style={{ flex: 1 }} />
            {canViewProjects && (
              <Link to="/projetos" style={{ fontSize: 12, color: "var(--orange)", textDecoration: "none", fontWeight: 600 }}>
                {p.viewProjects}
              </Link>
            )}
          </div>

          {loading ? (
            <div style={{ padding: "20px 18px", color: "var(--text-muted)", fontSize: 13 }}>{p.loading}</div>
          ) : (
            <div>
              {alerts.map((a, i) => {
                const color = a.level === "red" ? "var(--red)" : a.level === "orange" ? "var(--orange)" : "var(--blue)";
                const bgColor = a.level === "red" ? "var(--red-soft)" : a.level === "orange" ? "var(--orange-soft)" : "var(--blue-soft)";
                const inner = (
                  <>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 5 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{a.meta}</div>
                    </div>
                    {a.level !== "blue" && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 8, background: bgColor, color, flexShrink: 0 }}>
                        {a.level === "red" ? p.tagOverdue : p.tagUrgent}
                      </span>
                    )}
                    {a.id !== null && (
                      <Icon name="chevron_right" style={{ fontSize: 16, color: "var(--text-faint)", flexShrink: 0 }} />
                    )}
                  </>
                );
                const rowStyle: React.CSSProperties = {
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 18px",
                  borderBottom: i < alerts.length - 1 ? "1px solid var(--border)" : "none",
                  textDecoration: "none",
                };
                return a.id !== null ? (
                  <Link
                    key={i}
                    to={`/projetos/${a.id}`}
                    style={rowStyle}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={i} style={rowStyle}>{inner}</div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {editorOpen && (
        <ShortcutEditor
          selected={shortcuts}
          onSave={handleSaveShortcuts}
          onClose={() => setEditorOpen(false)}
          p={p}
          allShortcuts={allShortcuts}
        />
      )}
    </div>
  );
}
