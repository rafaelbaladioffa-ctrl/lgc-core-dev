import { useEffect, useMemo, useState } from "react";
import { projectTasksApi, projectsApi, registryApi } from "../../api/resources";
import type { CollaboratorFull, Project, ProjectTask, RackPosition, TaskFull } from "../../api/types";
import { useI18n, usePageText } from "../../i18n";
import DynamicForm, { type FieldConfig, type FormValues } from "../ui/DynamicForm";
import Modal from "../ui/Modal";

type ApiErrors = Record<string, string[]>;

const TEXT = {
  "pt-BR": {
    editar: (name: string) => `Editar Tarefa — ${name}`,
    novo: "Nova Tarefa",
    tarefaLabel: "Tarefa",
    statusLabel: "Status",
    horasPrevistas: "Horas Previstas",
    inicioPrevisto: "Início Previsto",
    terminoPrevisto: "Término Previsto",
    responsaveis: "Responsáveis",
    observacoes: "Observações",
    tarefaFixa: (name: string) => `Tarefa: ${name} (não é possível trocar a tarefa após criada)`,
    instrucaoRP: "Selecionar vários Rack Positions cria uma tarefa separada para cada um (não uma tarefa só cobrindo todos).",
    tarefasCriadas: (c: number, s: number) =>
      `${c} tarefa(s) criada(s) (uma por Rack Position selecionado).${s ? ` ${s} já existia(m) e foi(ram) ignorada(s).` : ""}`,
    statuses: {
      not_started: "Não Iniciada",
      in_progress: "Em Andamento",
      paused: "Pausada",
      completed: "Concluída",
      canceled: "Cancelada",
    },
  },
  "en-US": {
    editar: (name: string) => `Edit Task — ${name}`,
    novo: "New Task",
    tarefaLabel: "Task",
    statusLabel: "Status",
    horasPrevistas: "Estimated Hours",
    inicioPrevisto: "Planned Start",
    terminoPrevisto: "Planned End",
    responsaveis: "Assignees",
    observacoes: "Notes",
    tarefaFixa: (name: string) => `Task: ${name} (cannot change the task after creation)`,
    instrucaoRP: "Selecting multiple Rack Positions creates a separate task for each one (not a single task covering all).",
    tarefasCriadas: (c: number, s: number) =>
      `${c} task(s) created (one per selected Rack Position).${s ? ` ${s} already existed for the selected Rack Position(s) and were skipped.` : ""}`,
    statuses: {
      not_started: "Not Started",
      in_progress: "In Progress",
      paused: "Paused",
      completed: "Completed",
      canceled: "Canceled",
    },
  },
  "es-ES": {
    editar: (name: string) => `Editar Tarea — ${name}`,
    novo: "Nueva Tarea",
    tarefaLabel: "Tarea",
    statusLabel: "Estado",
    horasPrevistas: "Horas Estimadas",
    inicioPrevisto: "Inicio Previsto",
    terminoPrevisto: "Fin Previsto",
    responsaveis: "Responsables",
    observacoes: "Observaciones",
    tarefaFixa: (name: string) => `Tarea: ${name} (no es posible cambiar la tarea tras la creación)`,
    instrucaoRP: "Seleccionar varios Rack Positions crea una tarea separada para cada uno (no una tarea cubriendo todos).",
    tarefasCriadas: (c: number, s: number) =>
      `${c} tarea(s) creada(s) (una por Rack Position seleccionado).${s ? ` ${s} ya existía(n) para los Rack Position(s) seleccionados y fue(ron) ignorada(s).` : ""}`,
    statuses: {
      not_started: "No Iniciada",
      in_progress: "En Progreso",
      paused: "Pausada",
      completed: "Completada",
      canceled: "Cancelada",
    },
  },
};

export default function ProjectTaskFormModal({
  project,
  projectTask,
  existingTasks,
  rackPositions,
  onClose,
  onSaved,
}: {
  project: Project;
  projectTask: ProjectTask | null;
  existingTasks: ProjectTask[];
  rackPositions: RackPosition[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const p = usePageText(TEXT);

  const statusOptions = [
    { value: "not_started", label: p.statuses.not_started },
    { value: "in_progress", label: p.statuses.in_progress },
    { value: "paused", label: p.statuses.paused },
    { value: "completed", label: p.statuses.completed },
    { value: "canceled", label: p.statuses.canceled },
  ];

  const [catalogTasks, setCatalogTasks] = useState<TaskFull[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorFull[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);

  const [values, setValues] = useState<FormValues>(
    projectTask
      ? {
          ...projectTask,
          collaborator_ids: projectTask.collaborators.map((c) => c.id),
          estimated_hours: projectTask.estimated_hours,
        }
      : {
          task: null,
          status: "not_started",
          planned_start: null,
          planned_end: null,
          estimated_hours: null,
          collaborator_ids: [],
          rack_positions: [],
          notes: "",
        }
  );
  const [errors, setErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.allSettled([
      registryApi.tasks.list({ page_size: "500", is_active: "true" } as never),
      registryApi.collaborators.list({ page_size: "500" } as never),
    ])
      .then(([taskRes, collabRes]) => {
        if (taskRes.status === "fulfilled") setCatalogTasks(taskRes.value.results);
        if (collabRes.status === "fulfilled") setCollaborators(collabRes.value.results);
      })
      .finally(() => setLoadingRefs(false));
  }, []);

  const availableCatalogTasks = useMemo(() => {
    const others = existingTasks.filter(
      (task): task is ProjectTask & { task: number } => task.id !== projectTask?.id && task.task !== null
    );
    if (project.has_rack_positions && rackPositions.length > 0) {
      const coveredByTask = new Map<number, Set<number>>();
      others.forEach((task) => {
        const set = coveredByTask.get(task.task) ?? new Set<number>();
        task.rack_positions.forEach((rpId) => set.add(rpId));
        coveredByTask.set(task.task, set);
      });
      return catalogTasks.filter((task) => (coveredByTask.get(task.id)?.size ?? 0) < rackPositions.length);
    }
    const alreadyUsed = new Set(others.map((task) => task.task));
    return catalogTasks.filter((task) => !alreadyUsed.has(task.id));
  }, [catalogTasks, existingTasks, projectTask, project.has_rack_positions, rackPositions]);

  const companyCollaborators = useMemo(
    () => collaborators.filter((c) => !project.company || c.company === project.company),
    [collaborators, project.company]
  );

  const fields: FieldConfig[] = useMemo(() => {
    const base: FieldConfig[] = [
      {
        name: "task",
        label: p.tarefaLabel,
        type: "select",
        required: true,
        span: 2,
        options: availableCatalogTasks.map((task) => ({ value: task.id, label: task.name })),
      },
      { name: "status", label: p.statusLabel, type: "select", required: true, options: statusOptions },
      { name: "estimated_hours", label: p.horasPrevistas, type: "number" },
      { name: "planned_start", label: p.inicioPrevisto, type: "datetime" },
      { name: "planned_end", label: p.terminoPrevisto, type: "datetime" },
      {
        name: "collaborator_ids",
        label: p.responsaveis,
        type: "multiselect",
        span: 2,
        options: companyCollaborators.map((c) => ({ value: c.id, label: c.name })),
      },
    ];
    if (project.has_rack_positions) {
      base.push({
        name: "rack_positions",
        label: "Rack Positions",
        type: "multiselect",
        span: 2,
        options: rackPositions.map((rp) => ({ value: rp.id, label: rp.position })),
      });
    }
    base.push({ name: "notes", label: p.observacoes, type: "textarea", span: 2 });
    return base;
  }, [availableCatalogTasks, companyCollaborators, project.has_rack_positions, rackPositions, p]);

  async function handleSave() {
    setSaving(true);
    setErrors({});
    try {
      if (projectTask) {
        await projectTasksApi.update(projectTask.id, values);
      } else {
        const rackPositionIds = (values.rack_positions as number[] | undefined) ?? [];
        const result = await projectsApi.createTasks(project.id, {
          task: values.task as number,
          rack_position_ids: rackPositionIds,
          status: values.status as string,
          planned_start: values.planned_start as string | null,
          planned_end: values.planned_end as string | null,
          estimated_hours: values.estimated_hours as number | null,
          collaborator_ids: (values.collaborator_ids as number[] | undefined) ?? [],
          notes: values.notes as string,
        });
        if (rackPositionIds.length > 1) {
          alert(p.tarefasCriadas(result.created, result.skipped ?? 0));
        }
      }
      onSaved();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: ApiErrors } };
      if (axiosErr.response?.data) setErrors(axiosErr.response.data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={projectTask ? p.editar(projectTask.task_name) : p.novo} onClose={onClose} width={640}>
      {loadingRefs ? (
        <p style={{ color: "var(--text-muted)" }}>{t.common.carregando}</p>
      ) : (
        <>
          {projectTask ? (
            <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginBottom: 10 }}>
              {p.tarefaFixa(projectTask.task_name)}
            </p>
          ) : null}
          <DynamicForm
            fields={projectTask ? fields.filter((f) => f.name !== "task") : fields}
            values={values}
            errors={errors}
            onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
          />
          {!projectTask && project.has_rack_positions && (
            <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginTop: -6, marginBottom: 12 }}>
              {p.instrucaoRP}
            </p>
          )}
          {errors.non_field_errors && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{errors.non_field_errors.join(" ")}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <button className="btn btn-outline" onClick={onClose}>
              {t.common.cancelar}
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? t.common.salvando : t.common.salvar}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
