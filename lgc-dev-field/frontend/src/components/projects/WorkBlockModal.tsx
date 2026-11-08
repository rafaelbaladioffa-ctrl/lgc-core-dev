import { useEffect, useMemo, useState } from "react";
import { workBlockApi } from "../../api/resources";
import type { ProjectTask } from "../../api/types";
import { useI18n } from "../../i18n";
import Modal from "../ui/Modal";

const TEXT = {
  "pt-BR": {
    title: "Registrar bloco de trabalho",
    intro: "Informe o período em que você trabalhou e marque as tarefas que fez. O tempo do bloco é repartido entre elas, em sequência.",
    start: "Início do bloco",
    end: "Fim do bloco",
    tasks: "Tarefas feitas neste bloco",
    none: "Nenhuma tarefa pendente para registrar.",
    done: "Concluí",
    summary: (n: number, start: string, end: string, duration: string) => `${n} tarefa(s) · ${start}–${end} (${duration})`,
    save: "Registrar bloco",
    saving: "Registrando...",
    cancel: "Cancelar",
    error: "Não foi possível registrar o bloco.",
    hint: "Marque \"Concluí\" nas que terminou; as demais continuam abertas e o próximo bloco segue de onde parou.",
    oneType: "Um bloco por tipo de atividade e por grupo de material: se fez mais de um, registre um bloco para cada, com o horário de cada um.",
    otherType: "Outro tipo de atividade — registre em outro bloco",
    otherGroup: "Outro grupo de material — registre em outro bloco",
  },
  "en-US": {
    title: "Log a work block",
    intro: "Enter the period you worked and tick the tasks you did. The block time is split among them, in sequence.",
    start: "Block start",
    end: "Block end",
    tasks: "Tasks done in this block",
    none: "No pending tasks to log.",
    done: "Finished",
    summary: (n: number, start: string, end: string, duration: string) => `${n} task(s) · ${start}–${end} (${duration})`,
    save: "Log block",
    saving: "Logging...",
    cancel: "Cancel",
    error: "Could not log the block.",
    hint: "Tick \"Finished\" on the ones you completed; the others stay open and the next block continues from there.",
    oneType: "One block per activity type and per material group: if you did more than one, log a block for each, with its own time.",
    otherType: "Different activity type — log it in another block",
    otherGroup: "Different material group — log it in another block",
  },
  "es-ES": {
    title: "Registrar bloque de trabajo",
    intro: "Indique el período en que trabajó y marque las tareas que hizo. El tiempo del bloque se reparte entre ellas, en secuencia.",
    start: "Inicio del bloque",
    end: "Fin del bloque",
    tasks: "Tareas hechas en este bloque",
    none: "No hay tareas pendientes para registrar.",
    done: "Terminé",
    summary: (n: number, start: string, end: string, duration: string) => `${n} tarea(s) · ${start}–${end} (${duration})`,
    save: "Registrar bloque",
    saving: "Registrando...",
    cancel: "Cancelar",
    error: "No se pudo registrar el bloque.",
    hint: "Marque \"Terminé\" en las que concluyó; las demás siguen abiertas y el próximo bloque continúa desde ahí.",
    oneType: "Un bloque por tipo de actividad y por grupo de material: si hizo más de uno, registre un bloque para cada uno, con su horario.",
    otherType: "Otro tipo de actividad — regístrelo en otro bloque",
    otherGroup: "Otro grupo de material — regístrelo en otro bloque",
  },
} as const;

// Horário do Brasil fixo (UTC−3), como no resto do sistema.
const brt = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString();
const hhmm = (iso: string) => brt(iso).slice(11, 16);
const dateOf = (iso: string) => brt(iso).slice(0, 10);
const toIso = (date: string, time: string) => `${date}T${time}:00-03:00`;

function minutesBetween(start: string, end: string) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

function formatDuration(minutes: number) {
  if (minutes <= 0) return "0min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}min` : `${m}min`;
}

export default function WorkBlockModal({
  tasks,
  onClose,
  onSaved,
}: {
  /** Tarefas do técnico que podem entrar no bloco (pendentes ou pausadas). */
  tasks: ProjectTask[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { locale } = useI18n();
  const t = TEXT[(locale as keyof typeof TEXT) in TEXT ? (locale as keyof typeof TEXT) : "pt-BR"];
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [complete, setComplete] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    workBlockApi
      .suggestion()
      .then((s) => {
        setDate(dateOf(s.start));
        setStart(hhmm(s.start));
        setEnd(hhmm(s.end));
      })
      .catch(() => {
        const now = new Date().toISOString();
        setDate(dateOf(now));
        setEnd(hhmm(now));
        setStart(hhmm(new Date(Date.now() - 3600 * 1000).toISOString()));
      });
  }, []);

  const chosen = useMemo(() => tasks.filter((task) => selected[task.id]), [tasks, selected]);
  // Tipo de atividade já escolhido: as tarefas de outro tipo ficam bloqueadas neste bloco.
  const activeType = chosen.length > 0 ? (chosen[0].activity_code ?? "") : null;
  const activeGroup = chosen.length > 0 ? (chosen[0].work_group ?? "") : null;
  const typeOf = (task: ProjectTask) => task.activity_code ?? "";
  const groupOf = (task: ProjectTask) => task.work_group ?? "";
  // Bloqueia a tarefa que misturaria atividade ou grupo de material com o que já foi marcado.
  const blockReason = (task: ProjectTask) =>
    activeType !== null && typeOf(task) !== activeType
      ? t.otherType
      : activeGroup !== null && groupOf(task) !== activeGroup
        ? t.otherGroup
        : undefined;
  const minutes = start && end ? minutesBetween(start, end) : 0;
  const canSave = chosen.length > 0 && minutes > 0 && !saving;

  async function save() {
    setSaving(true);
    setError("");
    try {
      await workBlockApi.register({
        start: toIso(date, start),
        end: toIso(date, end),
        tasks: chosen.map((task) => ({ task_id: task.id, complete: complete[task.id] !== false })),
      });
      onSaved();
      onClose();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setError(detail || t.error);
    } finally {
      setSaving(false);
    }
  }

  const label = { fontSize: 12, color: "var(--text-muted)", fontWeight: 600 } as const;
  return (
    <Modal title={t.title} onClose={onClose} width={520}>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>{t.intro}</p>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          <span style={label}>{t.start}</span>
          <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          <span style={label}>{t.end}</span>
          <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>

      <div style={{ ...label, marginBottom: 6 }}>{t.tasks}</div>
      <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 10 }}>
        {tasks.length === 0 && <div style={{ padding: 12, fontSize: 13, color: "var(--text-muted)" }}>{t.none}</div>}
        {tasks.map((task) => (
          <div
            key={task.id}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 13 }}
          >
            <input
              type="checkbox"
              checked={!!selected[task.id]}
              disabled={!!blockReason(task) && !selected[task.id]}
              onChange={(e) => setSelected((prev) => ({ ...prev, [task.id]: e.target.checked }))}
              aria-label={task.task_name}
            />
            <span
              style={{ flex: 1, minWidth: 0, opacity: blockReason(task) && !selected[task.id] ? 0.45 : 1 }}
              title={blockReason(task)}
            >
              {task.task_name}
              {task.activity_name && <span style={{ color: "var(--text-muted)" }}> · {task.activity_name}</span>}
              {task.work_group_label && <span style={{ color: "var(--text-muted)" }}> · {task.work_group_label}</span>}
            </span>
            {selected[task.id] && (
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={complete[task.id] !== false}
                  onChange={(e) => setComplete((prev) => ({ ...prev, [task.id]: e.target.checked }))}
                />
                {t.done}
              </label>
            )}
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>{t.oneType}</p>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>{t.hint}</p>

      {chosen.length > 0 && minutes > 0 && (
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{t.summary(chosen.length, start, end, formatDuration(minutes))}</p>
      )}
      {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button className="btn btn-outline" onClick={onClose}>
          {t.cancel}
        </button>
        <button className="btn btn-primary" onClick={save} disabled={!canSave}>
          {saving ? t.saving : t.save}
        </button>
      </div>
    </Modal>
  );
}
