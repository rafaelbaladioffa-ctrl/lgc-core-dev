import SearchSelect from "../ui/SearchSelect";
import { useEffect, useState } from "react";
import { adjustmentsApi, type AdjustmentTask } from "../../api/resources";
import { presenceLabel } from "../../utils/timeline";
import Modal from "../ui/Modal";

// Ferramenta interna do administrador (só PT): o backend também restringe a superusuário.
const STATUS_OPTIONS = [
  "not_started",
  "available",
  "in_progress",
  "lunch",
  "meal",
  "personal",
  "meeting",
  "traveling",
  "support",
  "site_blocked",
  "awaiting_release",
  "off_duty",
];
const statusLabel = (s: string) => (s === "not_started" ? "Sem registro (barra apagada)" : presenceLabel(s, "pt-BR"));
const TASK_STATUS_LABEL: Record<string, string> = {
  not_started: "pendente",
  in_progress: "em andamento",
  paused: "pausada",
  completed: "concluída",
  waiting_qaqc: "aguardando QA/QC",
  canceled: "cancelada",
};

// Horário do Brasil fixo (UTC−3), como no resto do sistema.
const toIso = (date: string, time: string) => `${date}T${time}:00-03:00`;
const hhmm = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);

type Tab = "execution" | "status";
type Pause = { start: string; end: string };
/** Linha editável da lista de status do dia. origIso/origTime identificam um registro já gravado e não alterado. */
type StatusRow = { key: number; status: string; time: string; origIso?: string; origTime?: string; origStatus?: string; adjusted?: boolean };

export default function TimelineAdjustModal({
  collaboratorId,
  collaboratorName,
  date,
  onClose,
  onSaved,
}: {
  collaboratorId: number;
  collaboratorName: string;
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<Tab>("execution");
  const [tasks, setTasks] = useState<AdjustmentTask[]>([]);
  const [taskId, setTaskId] = useState<number | "">("");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("09:00");
  const [pauses, setPauses] = useState<Pause[]>([]);
  const [rows, setRows] = useState<StatusRow[]>([]);
  const [rowsLoaded, setRowsLoaded] = useState(false);
  const [deletedIsos, setDeletedIsos] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    adjustmentsApi.tasks(collaboratorId, date).then(setTasks).catch(() => setTasks([]));
    adjustmentsApi
      .statusEvents(collaboratorId, date)
      .then((events) =>
        setRows(
          events.map((e, i) => ({ key: i, status: e.status, time: hhmm(e.changed_at), origIso: e.changed_at, origTime: hhmm(e.changed_at), origStatus: e.status, adjusted: e.adjusted }))
        )
      )
      .catch(() => setRows([]))
      .finally(() => setRowsLoaded(true));
  }, [collaboratorId, date]);

  const dateLabel = new Date(`${date}T00:00`).toLocaleDateString("pt-BR");
  const rowsValid = rows.length > 0 && rows.every((r) => r.time);
  const canSave =
    reason.trim().length >= 3 &&
    !saving &&
    (tab === "execution" ? taskId !== "" && !!start && !!end : rowsValid);

  function updateRow(key: number, patch: Partial<StatusRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(r: StatusRow) {
    // Excluir um registro já gravado apaga a barra dele (o status anterior não passa a valer por cima).
    if (r.origIso && r.origStatus !== "not_started") setDeletedIsos((prev) => [...prev, r.origIso as string]);
    setRows((prev) => prev.filter((x) => x.key !== r.key));
  }

  const selectedTask = tasks.find((t) => t.task_id === taskId);
  const canRemoveExecution = tab === "execution" && !!selectedTask?.assignment_start && reason.trim().length >= 3 && !saving;

  async function removeExecution() {
    if (!selectedTask || !confirm(`Excluir o apontamento de ${collaboratorName} em "${selectedTask.name}"? A barra e as horas dessa execução serão apagadas.`)) return;
    setSaving(true);
    setError("");
    try {
      await adjustmentsApi.removeExecution({ collaborator_id: collaboratorId, task_id: selectedTask.task_id, reason: reason.trim() });
      onSaved();
      onClose();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setError(detail || "Não foi possível excluir o apontamento.");
    } finally {
      setSaving(false);
    }
  }

  function addRow() {
    const last = rows.length ? rows[rows.length - 1] : undefined;
    setRows((prev) => [...prev, { key: Math.max(-1, ...prev.map((r) => r.key)) + 1, status: "available", time: last?.time ?? "12:00" }]);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      if (tab === "execution") {
        await adjustmentsApi.execution({
          collaborator_id: collaboratorId,
          task_id: Number(taskId),
          start: toIso(date, start),
          end: toIso(date, end),
          pauses: pauses.filter((p) => p.start && p.end).map((p) => ({ start: toIso(date, p.start), end: toIso(date, p.end) })),
          reason: reason.trim(),
        });
      } else {
        await adjustmentsApi.saveStatusEvents({
          collaborator_id: collaboratorId,
          date,
          events: rows.map((r) => ({
            status: r.status,
            // registro não alterado segue exatamente como está (preserva segundos e a marca de original)
            changed_at: r.origIso && r.time === r.origTime ? r.origIso : toIso(date, r.time),
          })),
          deleted: deletedIsos,
          reason: reason.trim(),
        });
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setError(detail || "Não foi possível salvar o ajuste.");
    } finally {
      setSaving(false);
    }
  }

  const row = { display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-end" } as const;
  const field = { display: "flex", flexDirection: "column", gap: 4, flex: 1 } as const;
  const label = { fontSize: 12, color: "var(--text-muted)", fontWeight: 600 } as const;

  return (
    <Modal title={`Ajustar timeline — ${collaboratorName}`} subtitle={`Dia ${dateLabel}`} onClose={onClose} width={600}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button type="button" className={`btn btn-sm ${tab === "execution" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("execution")}>
          Registrar execução de tarefa
        </button>
        <button type="button" className={`btn btn-sm ${tab === "status" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("status")}>
          Editar status do dia
        </button>
      </div>

      <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 14 }}>
        {tab === "execution"
          ? "Grava a execução como se o próprio técnico tivesse iniciado e concluído: as horas valem como reais. Substitui o apontamento dele nessa tarefa."
          : "Status registrados no dia, em ordem. Altere o horário ou o tipo, adicione um novo ou exclua um registro errado: ao excluir, a barra dele some da timeline. Cada status vale até o horário do próximo."}
      </p>

      {tab === "execution" && (
        <>
          <div style={{ ...row, flexDirection: "column", alignItems: "stretch" }}>
            <label style={field}>
              <span style={label}>Tarefa</span>
              <SearchSelect
                options={tasks.map((t) => ({
                  value: t.task_id,
                  label: t.name,
                  sublabel: `${t.project_name} · ${TASK_STATUS_LABEL[t.status] ?? t.status}`,
                }))}
                value={taskId}
                onChange={(v) => setTaskId(v === "" ? "" : Number(v))}
                placeholder="Selecione a tarefa…"
              />
            </label>
          </div>
          <div style={row}>
            <label style={field}>
              <span style={label}>Início da execução</span>
              <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label style={field}>
              <span style={label}>Fim da execução</span>
              <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <div style={{ marginBottom: 12 }}>
            {pauses.map((p, i) => (
              <div key={i} style={row}>
                <label style={field}>
                  <span style={label}>Pausa {i + 1} — início</span>
                  <input className="input" type="time" value={p.start} onChange={(e) => setPauses((prev) => prev.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                </label>
                <label style={field}>
                  <span style={label}>fim</span>
                  <input className="input" type="time" value={p.end} onChange={(e) => setPauses((prev) => prev.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                </label>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setPauses((prev) => prev.filter((_, j) => j !== i))}>
                  Remover
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setPauses((prev) => [...prev, { start: "", end: "" }])}>
              + Pausa (não conta como hora trabalhada)
            </button>
          </div>
        </>
      )}

      {tab === "status" && (
        <div style={{ marginBottom: 12 }}>
          {!rowsLoaded && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Carregando…</p>}
          {rowsLoaded && rows.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>Nenhum status registrado neste dia. Adicione abaixo.</p>
          )}
          {rows.map((r) => (
            <div key={r.key} style={row}>
              <label style={{ ...field, flex: "0 0 130px" }}>
                <span style={label}>Horário</span>
                <input className="input" type="time" value={r.time} onChange={(e) => updateRow(r.key, { time: e.target.value })} />
              </label>
              <label style={field}>
                <span style={label}>
                  Status{r.adjusted ? " ✎" : ""}
                </span>
                <SearchSelect
                  options={STATUS_OPTIONS.map((s) => ({ value: s, label: statusLabel(s) }))}
                  value={r.status}
                  onChange={(v) => updateRow(r.key, { status: String(v) })}
                  clearable={false}
                />
              </label>
              <button type="button" className="btn btn-outline btn-sm" style={{ color: "var(--red)" }} onClick={() => removeRow(r)}>
                Excluir
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-sm" onClick={addRow}>
            + Adicionar status
          </button>
        </div>
      )}

      <label style={{ ...field, marginBottom: 12 }}>
        <span style={label}>Motivo do ajuste (obrigatório — fica no histórico)</span>
        <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: técnico esqueceu de sair do almoço; confirmado com o supervisor." />
      </label>

      {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        {canRemoveExecution && (
          <button className="btn btn-outline" style={{ color: "var(--red)", marginRight: "auto" }} onClick={removeExecution}>
            Excluir apontamento desta tarefa
          </button>
        )}
        <button className="btn btn-outline" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={save} disabled={!canSave}>
          {saving ? "Salvando..." : "Salvar ajuste"}
        </button>
      </div>
    </Modal>
  );
}
