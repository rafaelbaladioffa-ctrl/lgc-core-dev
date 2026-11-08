import { useEffect, useMemo, useState } from "react";
import { projectsApi, registryApi } from "../../api/resources";
import type { Project, ProjectTask, RackPosition, TaskFull } from "../../api/types";
import { useI18n, usePageText } from "../../i18n";
import Modal from "../ui/Modal";

const TEXT = {
  "pt-BR": {
    titulo: "Adicionar Tarefas do Catálogo",
    instrucaoRP: "Cada tarefa selecionada é criada uma vez para cada Rack Position marcado abaixo (que ainda não a tem).",
    tarefasCatalogo: "Tarefas do Catálogo",
    todasAdicionadas: "Todas as tarefas do catálogo já foram adicionadas a este projeto.",
    adicionando: "Adicionando...",
    adicionar: (n: number) => `Adicionar (${n})`,
    tarefasAdicionadas: (n: number) => `${n} Tarefa(s) adicionada(s) ao Projeto.`,
    erroAdicionar: "Não foi possível adicionar as tarefas.",
  },
  "en-US": {
    titulo: "Add Catalog Tasks",
    instrucaoRP: "Each selected task is created once per checked Rack Position below (those that don't have it yet).",
    tarefasCatalogo: "Catalog Tasks",
    todasAdicionadas: "All catalog tasks have already been added to this project.",
    adicionando: "Adding...",
    adicionar: (n: number) => `Add (${n})`,
    tarefasAdicionadas: (n: number) => `${n} Task(s) added to the Project.`,
    erroAdicionar: "Could not add the tasks.",
  },
  "es-ES": {
    titulo: "Agregar Tareas del Catálogo",
    instrucaoRP: "Cada tarea seleccionada se crea una vez por Rack Position marcado abajo (los que aún no la tienen).",
    tarefasCatalogo: "Tareas del Catálogo",
    todasAdicionadas: "Todas las tareas del catálogo ya han sido agregadas a este proyecto.",
    adicionando: "Agregando...",
    adicionar: (n: number) => `Agregar (${n})`,
    tarefasAdicionadas: (n: number) => `${n} Tarea(s) agregada(s) al Proyecto.`,
    erroAdicionar: "No se pudo agregar las tareas.",
  },
};

export default function TasksCatalogAddModal({
  project,
  existingTasks,
  rackPositions,
  onClose,
  onSaved,
}: {
  project: Project;
  existingTasks: ProjectTask[];
  rackPositions: RackPosition[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const p = usePageText(TEXT);
  const [catalogTasks, setCatalogTasks] = useState<TaskFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTasks, setSelectedTasks] = useState<number[]>([]);
  const [selectedRackPositions, setSelectedRackPositions] = useState<number[]>(() => rackPositions.map((rp) => rp.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const usesRackPositions = project.has_rack_positions && rackPositions.length > 0;

  useEffect(() => {
    registryApi.tasks
      .list({ page_size: "500", is_active: "true" } as never)
      .then((r) => setCatalogTasks(r.results))
      .finally(() => setLoading(false));
  }, []);

  const availableTasks = useMemo(() => {
    const catalogLinked = existingTasks.filter((t): t is ProjectTask & { task: number } => t.task !== null);
    if (usesRackPositions) {
      const coveredByTask = new Map<number, Set<number>>();
      catalogLinked.forEach((t) => {
        const set = coveredByTask.get(t.task) ?? new Set<number>();
        t.rack_positions.forEach((rpId) => set.add(rpId));
        coveredByTask.set(t.task, set);
      });
      return catalogTasks.filter((t) => (coveredByTask.get(t.id)?.size ?? 0) < rackPositions.length);
    }
    const alreadyUsed = new Set(catalogLinked.map((t) => t.task));
    return catalogTasks.filter((t) => !alreadyUsed.has(t.id));
  }, [catalogTasks, existingTasks, usesRackPositions, rackPositions]);

  function toggleTask(id: number) {
    setSelectedTasks((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  function toggleRackPosition(id: number) {
    setSelectedRackPositions((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  async function handleSave() {
    if (!selectedTasks.length) return;
    setSaving(true);
    setError("");
    try {
      const result = await projectsApi.tasksBulk(project.id, {
        action: "add",
        add_task_ids: selectedTasks,
        rack_position_ids: usesRackPositions ? selectedRackPositions : undefined,
      });
      alert(p.tarefasAdicionadas(result.created ?? 0));
      onSaved();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || p.erroAdicionar);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={p.titulo} onClose={onClose} width={560}>
      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>{t.common.carregando}</p>
      ) : (
        <>
          {usesRackPositions && (
            <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginBottom: 10 }}>
              {p.instrucaoRP}
            </p>
          )}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: 2, minWidth: 220 }}>
              <span className="field-label">{p.tarefasCatalogo}</span>
              <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, marginTop: 6 }}>
                {availableTasks.map((task) => (
                  <label
                    key={task.id}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 13.5, borderBottom: "1px solid var(--border)" }}
                  >
                    <input type="checkbox" checked={selectedTasks.includes(task.id)} onChange={() => toggleTask(task.id)} />
                    {task.name}
                  </label>
                ))}
                {availableTasks.length === 0 && (
                  <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
                    {p.todasAdicionadas}
                  </div>
                )}
              </div>
            </div>
            {usesRackPositions && (
              <div style={{ flex: 1, minWidth: 160 }}>
                <span className="field-label">Rack Positions</span>
                <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, marginTop: 6 }}>
                  {rackPositions.map((rp) => (
                    <label
                      key={rp.id}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 13.5, borderBottom: "1px solid var(--border)" }}
                    >
                      <input type="checkbox" checked={selectedRackPositions.includes(rp.id)} onChange={() => toggleRackPosition(rp.id)} />
                      {rp.position}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{error}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button className="btn btn-outline" onClick={onClose}>
              {t.common.cancelar}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !selectedTasks.length || (usesRackPositions && !selectedRackPositions.length)}
            >
              {saving ? p.adicionando : p.adicionar(selectedTasks.length)}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
