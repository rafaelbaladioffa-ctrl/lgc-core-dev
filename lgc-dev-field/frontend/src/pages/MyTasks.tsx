import { useEffect, useState } from "react";
import { myTasksApi, presenceApi } from "../api/resources";
import type { ProjectTask, TechnicianPresence } from "../api/types";
import { useAuth } from "../context/AuthContext";
import Icon from "../components/ui/Icon";
import { useI18n, usePageText } from "../i18n";
import { PERMS, hasPerm } from "../utils/permissions";

const TEXT = {
  "pt-BR": {
    title: "Minhas Tarefas",
    noProfile: "Seu usuário ainda não está vinculado a um Técnico. Peça para o administrador vincular seu usuário no cadastro de Técnicos.",
    loading: "Carregando...",
    myStatus: "Meu status",
    selectStatus: "Selecione seu status",
    reopenHint: 'Expediente encerrado — escolha "Disponível" acima pra reabrir, se precisar.',
    queueBadge: (n: number) => `Fila #${n}`,
    quantityPlaceholder: "Quantidade executada (opcional)",
    saving: "Salvando...", start: "Iniciar", pause: "Pausar", complete: "Concluir",
    completedAt: (dt: string) => `Concluída em ${dt}`,
    actualStart: "Início real", actualEnd: "Término real", actualHours: "Horas realizadas",
    quantityDone: "Quantidade executada",
    notes: "Observações", notesPlaceholder: "Anote algo sobre esta tarefa...",
    noTasks: "Nenhuma tarefa nesta aba.",
    since: "desde", at: "às",
    pauseWarning: (names: string) => `Suas tarefas em andamento serão pausadas: ${names}. Para retomar, toque em Iniciar na tarefa.`,
    changeStatusQ: (label: string) => `Alterar seu status para "${label}"?`,
    endShiftQ: "Encerrar seu expediente?",
    statusLabels: { not_started: "Não Iniciada", in_progress: "Em Andamento", paused: "Pausada", completed: "Concluída", canceled: "Cancelada" } as Record<string, string>,
    presenceOptions: [
      { key: "available", label: "Disponível" },
      { key: "lunch", label: "Horário de Almoço" },
      { key: "personal", label: "Particular" },
      { key: "meal", label: "Café" },
      { key: "meeting", label: "Reunião" },
      { key: "traveling", label: "Em Deslocamento" },
      { key: "support", label: "Apoio a outro técnico" },
      { key: "site_blocked", label: "Sem Acesso ao Site" },
      { key: "awaiting_release", label: "Aguardando Liberações" },
      { key: "off_duty", label: "Fim de Expediente" },
    ],
    outcomeOptions: [
      { key: "completed", label: "Concluída" },
      { key: "partial", label: "Parcial" },
      { key: "blocked", label: "Bloqueada" },
    ],
    tabs: [
      { key: "pending" as TabKey, label: "Pendentes", short: "Pendentes" },
      { key: "in_progress" as TabKey, label: "Em Andamento", short: "Em curso" },
      { key: "completed" as TabKey, label: "Finalizadas", short: "Finalizadas" },
    ],
  },
  "en-US": {
    title: "My Tasks",
    noProfile: "Your user is not yet linked to a Technician. Ask an administrator to link your user in the Technicians register.",
    loading: "Loading...",
    myStatus: "My status",
    selectStatus: "Select your status",
    reopenHint: 'Shift ended — choose "Available" above to reopen if needed.',
    queueBadge: (n: number) => `Queue #${n}`,
    quantityPlaceholder: "Quantity done (optional)",
    saving: "Saving...", start: "Start", pause: "Pause", complete: "Complete",
    completedAt: (dt: string) => `Completed at ${dt}`,
    actualStart: "Actual start", actualEnd: "Actual end", actualHours: "Actual hours",
    quantityDone: "Quantity done",
    notes: "Notes", notesPlaceholder: "Add a note about this task...",
    noTasks: "No tasks in this tab.",
    since: "since", at: "at",
    pauseWarning: (names: string) => `Your running tasks will be paused: ${names}. To resume, tap Start on the task.`,
    changeStatusQ: (label: string) => `Change your status to "${label}"?`,
    endShiftQ: "End your shift?",
    statusLabels: { not_started: "Not Started", in_progress: "In Progress", paused: "Paused", completed: "Completed", canceled: "Canceled" } as Record<string, string>,
    presenceOptions: [
      { key: "available", label: "Available" },
      { key: "lunch", label: "Lunch break" },
      { key: "personal", label: "Personal" },
      { key: "meal", label: "Coffee Break" },
      { key: "meeting", label: "Meeting" },
      { key: "traveling", label: "Traveling" },
      { key: "support", label: "Supporting another technician" },
      { key: "site_blocked", label: "No Site Access" },
      { key: "awaiting_release", label: "Awaiting Clearance" },
      { key: "off_duty", label: "End of Shift" },
    ],
    outcomeOptions: [
      { key: "completed", label: "Completed" },
      { key: "partial", label: "Partial" },
      { key: "blocked", label: "Blocked" },
    ],
    tabs: [
      { key: "pending" as TabKey, label: "Pending", short: "Pending" },
      { key: "in_progress" as TabKey, label: "In Progress", short: "In progress" },
      { key: "completed" as TabKey, label: "Completed", short: "Completed" },
    ],
  },
  "es-ES": {
    title: "Mis Tareas",
    noProfile: "Tu usuario aún no está vinculado a un Técnico. Pide al administrador que vincule tu usuario en el registro de Técnicos.",
    loading: "Cargando...",
    myStatus: "Mi estado",
    selectStatus: "Selecciona tu estado",
    reopenHint: 'Jornada cerrada — elige "Disponible" arriba para reabrir si es necesario.',
    queueBadge: (n: number) => `Cola #${n}`,
    quantityPlaceholder: "Cantidad ejecutada (opcional)",
    saving: "Guardando...", start: "Iniciar", pause: "Pausar", complete: "Completar",
    completedAt: (dt: string) => `Completada el ${dt}`,
    actualStart: "Inicio real", actualEnd: "Fin real", actualHours: "Horas realizadas",
    quantityDone: "Cantidad ejecutada",
    notes: "Observaciones", notesPlaceholder: "Añade una nota sobre esta tarea...",
    noTasks: "Sin tareas en esta pestaña.",
    since: "desde", at: "a las",
    pauseWarning: (names: string) => `Sus tareas en curso se pausarán: ${names}. Para retomar, toque Iniciar en la tarea.`,
    changeStatusQ: (label: string) => `¿Cambiar su estado a "${label}"?`,
    endShiftQ: "¿Finalizar su jornada?",
    statusLabels: { not_started: "No Iniciada", in_progress: "En Curso", paused: "Pausada", completed: "Completada", canceled: "Cancelada" } as Record<string, string>,
    presenceOptions: [
      { key: "available", label: "Disponible" },
      { key: "lunch", label: "Hora de almuerzo" },
      { key: "personal", label: "Personal" },
      { key: "meal", label: "Café" },
      { key: "meeting", label: "Reunión" },
      { key: "traveling", label: "En desplazamiento" },
      { key: "support", label: "Apoyo a otro técnico" },
      { key: "site_blocked", label: "Sin acceso al sitio" },
      { key: "awaiting_release", label: "Esperando autorizaciones" },
      { key: "off_duty", label: "Fin de jornada" },
    ],
    outcomeOptions: [
      { key: "completed", label: "Completada" },
      { key: "partial", label: "Parcial" },
      { key: "blocked", label: "Bloqueada" },
    ],
    tabs: [
      { key: "pending" as TabKey, label: "Pendientes", short: "Pendientes" },
      { key: "in_progress" as TabKey, label: "En Curso", short: "En curso" },
      { key: "completed" as TabKey, label: "Finalizadas", short: "Finalizadas" },
    ],
  },
};

const STATUS_TONE: Record<string, string> = {
  not_started: "var(--text-faint)",
  in_progress: "var(--blue)",
  paused: "var(--amber)",
  completed: "var(--green)",
  canceled: "var(--red)",
};

const PRESENCE_DOT_COLOR: Record<string, string> = {
  not_started: "var(--text-faint)",
  available: "var(--green)",
  in_progress: "var(--amber)",
  lunch: "var(--purple)",
  personal: "var(--blue)",
  meal: "var(--teal)",
  meeting: "var(--pink)",
  traveling: "var(--cyan)",
  support: "var(--lime)",
  site_blocked: "var(--red)",
  awaiting_release: "var(--orange)",
  off_duty: "var(--text-faint)",
};

type TabKey = "pending" | "in_progress" | "completed";

function tabOf(status: string): TabKey | null {
  if (status === "not_started") return "pending";
  if (status === "in_progress" || status === "paused") return "in_progress";
  if (status === "completed") return "completed";
  return null;
}

function nowISO() {
  return new Date().toISOString();
}

export default function MyTasks() {
  const { user } = useAuth();
  const p = usePageText(TEXT);
  const { locale } = useI18n();

  function formatDateTime(value: string | null) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function formatTime(value: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  const canEdit = hasPerm(user, PERMS.changeMyTasks);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [presence, setPresence] = useState<TechnicianPresence | null>(null);
  const [outcomeByTask, setOutcomeByTask] = useState<Record<number, string>>({});
  const [quantityByTask, setQuantityByTask] = useState<Record<number, string>>({});

  function loadTasks() {
    return myTasksApi.list().then((data) => setTasks(data.results));
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadTasks(), presenceApi.me().then((data) => !cancelled && setPresence(data)).catch(() => {})]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    const timer = setInterval(() => {
      if (!cancelled) loadTasks();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setPresenceStatus(status: string) {
    const label = p.presenceOptions.find((opt) => opt.key === status)?.label || status;
    const running = tasks.filter((t) => t.status === "in_progress");
    const question = status === "off_duty" ? p.endShiftQ : p.changeStatusQ(label);
    // Qualquer status escolhido tira o técnico da execução: avisa que as tarefas em andamento serão pausadas.
    const warning = running.length > 0 ? `

${p.pauseWarning(running.map((t) => t.task_name).join(", "))}` : "";
    if (!confirm(question + warning)) return;
    const updated = await presenceApi.setStatus(status);
    setPresence(updated);
    if (running.length > 0) loadTasks();
  }

  async function save(id: number, patch: Partial<ProjectTask>) {
    setSavingId(id);
    try {
      const updated = await myTasksApi.update(id, patch);
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      // Iniciar/pausar/concluir uma tarefa muda o status de presença
      // automaticamente no backend (ver MyTaskViewSet._sync_presence_with_task) —
      // recarrega pra refletir isso na UI sem esperar o próximo poll.
      if (patch.status) {
        presenceApi.me().then(setPresence).catch(() => {});
      }
    } finally {
      setSavingId(null);
    }
  }

  function startTask(t: ProjectTask) {
    save(t.id, { status: "in_progress", actual_start: t.actual_start || nowISO() });
  }

  function pauseTask(t: ProjectTask) {
    save(t.id, { status: "paused" });
  }

  function completeTask(t: ProjectTask) {
    if (!confirm(`Concluir "${t.task_name}"?`)) return;
    save(t.id, {
      status: "completed",
      actual_end: t.actual_end || nowISO(),
      completion_outcome: outcomeByTask[t.id] || "completed",
      quantity_done: quantityByTask[t.id] || "",
    });
  }

  if (loading) return <p style={{ color: "var(--text-muted)", padding: 20 }}>{p.loading}</p>;

  if (!user?.has_collaborator_profile) {
    return (
      <div>
        <div className="mt-title">{p.title}</div>
        <div className="empty-state">{p.noProfile}</div>
      </div>
    );
  }

  const visibleTasks = tasks.filter((t) => tabOf(t.status) === activeTab);
  const isOffDuty = presence?.status === "off_duty";

  return (
    <div className="mt-screen">
      <div className="mt-title">{p.title}</div>

      {presence && (
        <div className="mt-presence-bar">
          <div className="mt-presence-left">
            <div className="mt-presence-dot" style={{ background: PRESENCE_DOT_COLOR[presence.status] }} />
            <div>
              <div className="mt-presence-label">{presence.status_display}</div>
              {(presence.status_since || presence.checked_in_at) && !isOffDuty && (
                <div className="mt-presence-since">{p.since} {formatTime(presence.status_since || presence.checked_in_at)}</div>
              )}
              {isOffDuty && presence.checked_out_at && (
                <div className="mt-presence-since">{p.at} {formatTime(presence.checked_out_at)}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {presence && (
        <div className="mt-status-select-row">
          <label className="mt-status-select-label">{p.myStatus}</label>
          <select
            className="select"
            value={presence.status === "not_started" ? "" : presence.status}
            onChange={(e) => setPresenceStatus(e.target.value)}
          >
            {presence.status === "not_started" && (
              <option value="" disabled>
                {p.selectStatus}
              </option>
            )}
            {/* "Em Execução" é definido pelo sistema (não dá pra escolher), mas o técnico
                precisa poder sair dele: escolher outro status pausa as tarefas em andamento. */}
            {presence.status === "in_progress" && (
              <option value="in_progress" disabled>
                {presence.status_display}
              </option>
            )}
            {p.presenceOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
          {isOffDuty && (
            <div className="mt-status-reopen-hint">
              {p.reopenHint}
            </div>
          )}
        </div>
      )}

      <div className="mt-tabs">
        {p.tabs.map((tab) => {
          const count = tasks.filter((t) => tabOf(t.status) === tab.key).length;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`mt-tab${activeTab === tab.key ? " active" : ""}`}
            >
              <span className="mt-tab-label">{tab.short}</span>
              <span className="mt-tab-count">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-list">
        {visibleTasks.map((t) => {
          const expanded = expandedId === t.id;
          const saving = savingId === t.id;
          return (
            <div key={t.id} className="mt-card" style={{ borderLeftColor: STATUS_TONE[t.status] || "var(--border)" }}>
              <button className="mt-card-header" onClick={() => setExpandedId(expanded ? null : t.id)}>
                <div className="mt-card-heading">
                  <div className="mt-task-name">{t.task_name}</div>
                  <div className="mt-project-name">
                    {t.project_name} {t.project_code ? `· ${t.project_code}` : ""}
                  </div>
                </div>
                <div className="mt-card-status" style={{ color: STATUS_TONE[t.status] || "var(--text-muted)" }}>
                  {p.statusLabels[t.status] || t.status_display}
                  {t.status === "not_started" && t.queue_order != null && (
                    <span className="mt-queue-badge">{p.queueBadge(t.queue_order)}</span>
                  )}
                  <Icon name={expanded ? "expand_less" : "expand_more"} style={{ fontSize: 20 }} />
                </div>
              </button>

              {canEdit && t.status === "in_progress" && (
                <>
                  <div className="mt-outcome-row">
                    {p.outcomeOptions.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        className={`mt-outcome-pill${(outcomeByTask[t.id] || "completed") === opt.key ? " on" : ""}`}
                        onClick={() => setOutcomeByTask((prev) => ({ ...prev, [t.id]: opt.key }))}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <input
                    className="input mt-quantity-input"
                    style={{ width: "calc(100% - 32px)" }}
                    placeholder={p.quantityPlaceholder}
                    value={quantityByTask[t.id] ?? ""}
                    onChange={(e) => setQuantityByTask((prev) => ({ ...prev, [t.id]: e.target.value }))}
                  />
                </>
              )}

              {canEdit && (
                <div className="mt-actions">
                  {(t.status === "not_started" || t.status === "paused") && (
                    <button
                      onClick={() => startTask(t)}
                      disabled={saving}
                      className="mt-btn mt-btn-start"
                    >
                      <Icon name="play_arrow" style={{ fontSize: 20 }} />
                      {saving ? p.saving : p.start}
                    </button>
                  )}
                  {t.status === "in_progress" && (
                    <>
                      <button onClick={() => pauseTask(t)} disabled={saving} className="mt-btn mt-btn-pause">
                        <Icon name="pause" style={{ fontSize: 20 }} />
                        {p.pause}
                      </button>
                      <button onClick={() => completeTask(t)} disabled={saving} className="mt-btn mt-btn-complete">
                        <Icon name="check" style={{ fontSize: 20 }} />
                        {p.complete}
                      </button>
                    </>
                  )}
                  {t.status === "completed" && (
                    <div className="mt-done-note">
                      <Icon name="task_alt" style={{ fontSize: 18 }} />
                      {p.completedAt(formatDateTime(t.actual_end))}
                    </div>
                  )}
                </div>
              )}
              {expanded && (
                <div className="mt-details">
                  <div className="mt-meta-grid">
                    <div className="mt-meta">
                      <span className="mt-meta-label">{p.actualStart}</span>
                      <span className="mt-meta-value">{formatDateTime(t.actual_start)}</span>
                    </div>
                    <div className="mt-meta">
                      <span className="mt-meta-label">{p.actualEnd}</span>
                      <span className="mt-meta-value">{formatDateTime(t.actual_end)}</span>
                    </div>
                    <div className="mt-meta">
                      <span className="mt-meta-label">{p.actualHours}</span>
                      <span className="mt-meta-value">{t.actual_hours ? `${t.actual_hours}h` : "—"}</span>
                    </div>
                  </div>

                  {t.quantity_done && (
                    <div className="mt-meta" style={{ marginBottom: 12 }}>
                      <span className="mt-meta-label">{p.quantityDone}</span>
                      <span className="mt-meta-value">{t.quantity_done}</span>
                    </div>
                  )}

                  <label className="mt-notes-label">{p.notes}</label>
                  <textarea
                    disabled={!canEdit}
                    className="input mt-notes"
                    defaultValue={t.notes}
                    onBlur={(e) => save(t.id, { notes: e.target.value })}
                    placeholder={p.notesPlaceholder}
                  />
                </div>
              )}
            </div>
          );
        })}
        {visibleTasks.length === 0 && <div className="empty-state">{p.noTasks}</div>}
      </div>
    </div>
  );
}
