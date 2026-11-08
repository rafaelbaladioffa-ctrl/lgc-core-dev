import SearchSelect, { SearchMultiSelect } from "../ui/SearchSelect";
import { useMemo, useState } from "react";
import { projectsApi } from "../../api/resources";
import type { CollaboratorFull, Project, RackPosition } from "../../api/types";
import { useI18n, usePageText } from "../../i18n";
import DateInput from "../ui/DateInput";
import Icon from "../ui/Icon";

const TEXT = {
  "pt-BR": {
    titulo: (n: number) => `${n} tarefa(s) selecionada(s) — Ações em Massa`,
    limparSelecao: "Limpar seleção",
    statusLabel: "Status",
    inicio: "Início",
    termino: "Término",
    horas: "Horas",
    responsaveis: "Responsáveis (substitui os atuais)",
    rackPositions: "Rack Positions (substitui os atuais)",
    atualizar: "Atualizar selecionadas",
    excluir: "Excluir selecionadas",
    confirmarExcluir: (n: number) => `Excluir ${n} tarefa(s) selecionada(s)?`,
    tarefasAtualizadas: (n: number) => `${n} Tarefa(s) atualizada(s) em massa.`,
    tarefasExcluidas: (n: number) => `${n} Tarefa(s) excluída(s) do Projeto.`,
    erroAtualizar: "Não foi possível atualizar as tarefas selecionadas.",
    erroExcluir: "Não foi possível excluir as tarefas selecionadas.",
    statuses: {
      "": "Manter status atual",
      not_started: "Não Iniciada",
      in_progress: "Em Andamento",
      paused: "Pausada",
      completed: "Concluída",
      canceled: "Cancelada",
    },
  },
  "en-US": {
    titulo: (n: number) => `${n} task(s) selected — Bulk Actions`,
    limparSelecao: "Clear selection",
    statusLabel: "Status",
    inicio: "Start",
    termino: "End",
    horas: "Hours",
    responsaveis: "Assignees (replaces current)",
    rackPositions: "Rack Positions (replaces current)",
    atualizar: "Update selected",
    excluir: "Delete selected",
    confirmarExcluir: (n: number) => `Delete ${n} selected task(s)?`,
    tarefasAtualizadas: (n: number) => `${n} Task(s) bulk-updated.`,
    tarefasExcluidas: (n: number) => `${n} Task(s) deleted from the Project.`,
    erroAtualizar: "Could not update the selected tasks.",
    erroExcluir: "Could not delete the selected tasks.",
    statuses: {
      "": "Keep current status",
      not_started: "Not Started",
      in_progress: "In Progress",
      paused: "Paused",
      completed: "Completed",
      canceled: "Canceled",
    },
  },
  "es-ES": {
    titulo: (n: number) => `${n} tarea(s) seleccionada(s) — Acciones en Masa`,
    limparSelecao: "Limpiar selección",
    statusLabel: "Estado",
    inicio: "Inicio",
    termino: "Fin",
    horas: "Horas",
    responsaveis: "Responsables (reemplaza los actuales)",
    rackPositions: "Rack Positions (reemplaza los actuales)",
    atualizar: "Actualizar seleccionadas",
    excluir: "Eliminar seleccionadas",
    confirmarExcluir: (n: number) => `¿Eliminar ${n} tarea(s) seleccionada(s)?`,
    tarefasAtualizadas: (n: number) => `${n} Tarea(s) actualizada(s) en masa.`,
    tarefasExcluidas: (n: number) => `${n} Tarea(s) eliminada(s) del Proyecto.`,
    erroAtualizar: "No se pudo actualizar las tareas seleccionadas.",
    erroExcluir: "No se pudo eliminar las tareas seleccionadas.",
    statuses: {
      "": "Mantener estado actual",
      not_started: "No Iniciada",
      in_progress: "En Progreso",
      paused: "Pausada",
      completed: "Completada",
      canceled: "Cancelada",
    },
  },
};

export default function TasksBulkUpdatePanel({
  project,
  selectedIds,
  collaborators,
  rackPositions,
  onClear,
  onApplied,
}: {
  project: Project;
  selectedIds: number[];
  collaborators: CollaboratorFull[];
  rackPositions: RackPosition[];
  onClear: () => void;
  onApplied: () => void;
}) {
  const { t } = useI18n();
  const p = usePageText(TEXT);

  const statusOptions = Object.entries(p.statuses).map(([value, label]) => ({ value, label }));

  const [status, setStatus] = useState("");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [collaboratorIds, setCollaboratorIds] = useState<number[]>([]);
  const [rackPositionIds, setRackPositionIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const companyCollaborators = useMemo(
    () => collaborators.filter((c) => !project.company || c.company === project.company),
    [collaborators, project.company]
  );

  async function applyUpdate() {
    setSaving(true);
    setError("");
    try {
      const result = await projectsApi.tasksBulk(project.id, {
        action: "update",
        task_ids: selectedIds,
        status: status || undefined,
        planned_start: plannedStart ? `${plannedStart}T00:00` : undefined,
        planned_end: plannedEnd ? `${plannedEnd}T00:00` : undefined,
        estimated_hours: estimatedHours || undefined,
        collaborator_ids: collaboratorIds,
        rack_position_ids: rackPositionIds,
      });
      alert(p.tarefasAtualizadas(result.updated ?? 0));
      onApplied();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || p.erroAtualizar);
    } finally {
      setSaving(false);
    }
  }

  async function applyDelete() {
    if (!confirm(p.confirmarExcluir(selectedIds.length))) return;
    setSaving(true);
    setError("");
    try {
      const result = await projectsApi.tasksBulk(project.id, { action: "delete", task_ids: selectedIds });
      alert(p.tarefasExcluidas(result.deleted ?? 0));
      onApplied();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || p.erroExcluir);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16, border: "1px solid var(--orange)" }}>
      <div className="section-header-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <strong style={{ fontSize: 13.5 }}>{p.titulo(selectedIds.length)}</strong>
        <button className="btn btn-outline btn-sm" onClick={onClear}>
          <Icon name="close" style={{ fontSize: 14 }} />
          {p.limparSelecao}
        </button>
      </div>

      <div className="dynamic-form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
        <div className="field-group">
          <span className="field-label">{p.statusLabel}</span>
          <SearchSelect
            options={statusOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
            value={status}
            onChange={(v) => setStatus(String(v))}
            clearable={false}
          />
        </div>
        <div className="field-group">
          <span className="field-label">{p.inicio}</span>
          <DateInput value={plannedStart} onChange={setPlannedStart} />
        </div>
        <div className="field-group">
          <span className="field-label">{p.termino}</span>
          <DateInput value={plannedEnd} onChange={setPlannedEnd} />
        </div>
        <div className="field-group">
          <span className="field-label">{p.horas}</span>
          <input type="number" className="input" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} />
        </div>
        <div className="field-group" style={{ gridColumn: "1 / 3" }}>
          <span className="field-label">{p.responsaveis}</span>
          <SearchMultiSelect
            options={companyCollaborators.map((c) => ({ value: c.id, label: c.name }))}
            value={collaboratorIds}
            onChange={(next) => setCollaboratorIds(next.map(Number))}
          />
        </div>
        {project.has_rack_positions && (
          <div className="field-group" style={{ gridColumn: "3 / 5" }}>
            <span className="field-label">{p.rackPositions}</span>
            <SearchMultiSelect
              options={rackPositions.map((rp) => ({ value: rp.id, label: rp.position }))}
              value={rackPositionIds}
              onChange={(next) => setRackPositionIds(next.map(Number))}
            />
          </div>
        )}
      </div>

      {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{error}</p>}

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-primary" onClick={applyUpdate} disabled={saving}>
          {p.atualizar}
        </button>
        <button className="btn btn-outline" onClick={applyDelete} disabled={saving} style={{ color: "var(--red)" }}>
          {t.common.excluir !== "Excluir" ? t.common.excluir : p.excluir}
        </button>
      </div>
    </div>
  );
}
