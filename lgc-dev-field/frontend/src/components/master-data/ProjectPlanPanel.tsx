import SearchSelect, { SearchMultiSelect } from "../ui/SearchSelect";
import ProjectCombobox from "../ui/ProjectCombobox";
import MultiSelectFilter from "../ui/MultiSelectFilter";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { collaboratorsApi, planningApi, projectTasksApi, projectsApi } from "../../api/resources";
import type { Collaborator, Project, ProjectPlan, ProjectTask, SowImport } from "../../api/types";
import { usePageText } from "../../i18n";
import DateInput from "../ui/DateInput";
import Icon from "../ui/Icon";

const TEXT = {
  "pt-BR": {
    titulo: "Plano do Projeto",
    subtitulo: "Consolida uma SOW (ou um conjunto de Itens de Escopo) dentro de um Projeto e transforma as Tarefas Geradas já resolvidas em Tarefas do Projeto reais — atribuíveis a técnicos, visíveis em Minhas Tarefas.",
    projeto: "Projeto",
    selecione: "Selecione...",
    importacaoSow: "Importação SOW",
    semSow: "(nenhuma — usar todos os Itens de Escopo do projeto)",
    semTitulo: "sem título",
    carregar: "Carregar",
    carregando: "Carregando…",
    erroProjeto: "Selecione um projeto.",
    erroCarregarPlano: "Não foi possível carregar o plano.",
    erroCriarTarefas: "Não foi possível criar as tarefas.",
    erroAtribuir: "Não foi possível atribuir as tarefas.",
    erroAtribuirValidacao: "Selecione ao menos uma tarefa e um técnico.",
    planoProjeto: (name: string) => `Projeto: ${name}`,
    scopeItemsProntos: (ready: number, total: number, pending: number) =>
      `ScopeItems prontos: ${ready} de ${total} (${pending} aguardando resolução de template)`,
    tarefasACriar: (n: number) => `Tarefas operacionais a criar: ${n}`,
    tarefasExistentes: (n: number) => `Tarefas já existentes: ${n}`,
    expansaoPaths: (paths: string[]) =>
      `Expansão por Path A/B: ${paths.length > 0 ? `sim (${paths.join(", ")})` : "não"}`,
    criarTarefas: "Criar tarefas do projeto",
    criando: "Criando…",
    tarefasCriadas: (created: number, existing: number) =>
      `${created} tarefa(s) criada(s) no projeto (${existing} já existiam).`,
    abrirTarefas: "Abrir tarefas do projeto",
    atribuirEquipe: "Atribuir equipe",
    itemEscopo: "Item de Escopo",
    statusRegra: "Status da Regra",
    template: "Template",
    revisao: "Revisão",
    exigeRevisao: "Exige revisão",
    tarefasGeradas: "Tarefas Geradas",
    tarefasProjetoExistentes: "Tarefas do Projeto já existentes",
    nenhumItem: "Nenhum Item de Escopo encontrado para este filtro.",
    tarefasDoProjeto: (sow: string) => `Tarefas do projeto${sow ? ` (SOW ${sow})` : ""}`,
    todasAtividades: "Todas as Atividades",
    todosPaths: "Todos os Paths",
    todosStatus: "Todos os Status",
    carregandoTarefas: "Carregando tarefas…",
    tarefa: "Tarefa",
    atividade: "Atividade",
    path: "Path",
    qtd: "Qtd",
    status: "Status",
    responsaveis: "Responsáveis",
    nenhumaTarefa: 'Nenhuma tarefa do projeto ainda — clique em "Criar tarefas do projeto" acima.',
    tecnicos: "Técnico(s)",
    prazo: "Prazo",
    prioridade: "Prioridade",
    naoAlterar: "(não alterar)",
    priorities: { low: "Baixa", medium: "Média", high: "Alta", urgent: "Urgente" },
    confirmarAtribuicao: (n: number) => `Confirmar atribuição (${n})`,
    atribuindo: "Atribuindo…",
    tarefasAtribuidas: (n: number) => `${n} tarefa(s) atribuída(s).`,
  },
  "en-US": {
    titulo: "Project Plan",
    subtitulo: "Consolidates a SOW (or a set of Scope Items) within a Project and turns resolved Generated Tasks into real Project Tasks — assignable to technicians, visible in My Tasks.",
    projeto: "Project",
    selecione: "Select...",
    importacaoSow: "SOW Import",
    semSow: "(none — use all Scope Items of the project)",
    semTitulo: "no title",
    carregar: "Load",
    carregando: "Loading…",
    erroProjeto: "Select a project.",
    erroCarregarPlano: "Could not load the plan.",
    erroCriarTarefas: "Could not create the tasks.",
    erroAtribuir: "Could not assign the tasks.",
    erroAtribuirValidacao: "Select at least one task and one technician.",
    planoProjeto: (name: string) => `Project: ${name}`,
    scopeItemsProntos: (ready: number, total: number, pending: number) =>
      `Ready scope items: ${ready} of ${total} (${pending} awaiting template resolution)`,
    tarefasACriar: (n: number) => `Operational tasks to create: ${n}`,
    tarefasExistentes: (n: number) => `Already existing tasks: ${n}`,
    expansaoPaths: (paths: string[]) =>
      `Path A/B expansion: ${paths.length > 0 ? `yes (${paths.join(", ")})` : "no"}`,
    criarTarefas: "Create project tasks",
    criando: "Creating…",
    tarefasCriadas: (created: number, existing: number) =>
      `${created} task(s) created in the project (${existing} already existed).`,
    abrirTarefas: "Open project tasks",
    atribuirEquipe: "Assign team",
    itemEscopo: "Scope Item",
    statusRegra: "Rule Status",
    template: "Template",
    revisao: "Review",
    exigeRevisao: "Requires review",
    tarefasGeradas: "Generated Tasks",
    tarefasProjetoExistentes: "Existing Project Tasks",
    nenhumItem: "No Scope Items found for this filter.",
    tarefasDoProjeto: (sow: string) => `Project tasks${sow ? ` (SOW ${sow})` : ""}`,
    todasAtividades: "All Activities",
    todosPaths: "All Paths",
    todosStatus: "All Statuses",
    carregandoTarefas: "Loading tasks…",
    tarefa: "Task",
    atividade: "Activity",
    path: "Path",
    qtd: "Qty",
    status: "Status",
    responsaveis: "Assignees",
    nenhumaTarefa: 'No project tasks yet — click "Create project tasks" above.',
    tecnicos: "Technician(s)",
    prazo: "Deadline",
    prioridade: "Priority",
    naoAlterar: "(do not change)",
    priorities: { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" },
    confirmarAtribuicao: (n: number) => `Confirm assignment (${n})`,
    atribuindo: "Assigning…",
    tarefasAtribuidas: (n: number) => `${n} task(s) assigned.`,
  },
  "es-ES": {
    titulo: "Plan del Proyecto",
    subtitulo: "Consolida un SOW (o un conjunto de Ítems de Alcance) dentro de un Proyecto y convierte las Tareas Generadas ya resueltas en Tareas del Proyecto reales — asignables a técnicos, visibles en Mis Tareas.",
    projeto: "Proyecto",
    selecione: "Seleccione...",
    importacaoSow: "Importación SOW",
    semSow: "(ninguna — usar todos los Ítems de Alcance del proyecto)",
    semTitulo: "sin título",
    carregar: "Cargar",
    carregando: "Cargando…",
    erroProjeto: "Seleccione un proyecto.",
    erroCarregarPlano: "No se pudo cargar el plan.",
    erroCriarTarefas: "No se pudieron crear las tareas.",
    erroAtribuir: "No se pudieron asignar las tareas.",
    erroAtribuirValidacao: "Seleccione al menos una tarea y un técnico.",
    planoProjeto: (name: string) => `Proyecto: ${name}`,
    scopeItemsProntos: (ready: number, total: number, pending: number) =>
      `Ítems de alcance listos: ${ready} de ${total} (${pending} en espera de resolución de template)`,
    tarefasACriar: (n: number) => `Tareas operacionales a crear: ${n}`,
    tarefasExistentes: (n: number) => `Tareas ya existentes: ${n}`,
    expansaoPaths: (paths: string[]) =>
      `Expansión por Path A/B: ${paths.length > 0 ? `sí (${paths.join(", ")})` : "no"}`,
    criarTarefas: "Crear tareas del proyecto",
    criando: "Creando…",
    tarefasCriadas: (created: number, existing: number) =>
      `${created} tarea(s) creada(s) en el proyecto (${existing} ya existían).`,
    abrirTarefas: "Abrir tareas del proyecto",
    atribuirEquipe: "Asignar equipo",
    itemEscopo: "Ítem de Alcance",
    statusRegra: "Estado de Regla",
    template: "Template",
    revisao: "Revisión",
    exigeRevisao: "Requiere revisión",
    tarefasGeradas: "Tareas Generadas",
    tarefasProjetoExistentes: "Tareas del Proyecto ya existentes",
    nenhumItem: "No se encontraron Ítems de Alcance para este filtro.",
    tarefasDoProjeto: (sow: string) => `Tareas del proyecto${sow ? ` (SOW ${sow})` : ""}`,
    todasAtividades: "Todas las Actividades",
    todosPaths: "Todos los Paths",
    todosStatus: "Todos los Estados",
    carregandoTarefas: "Cargando tareas…",
    tarefa: "Tarea",
    atividade: "Actividad",
    path: "Path",
    qtd: "Cant.",
    status: "Estado",
    responsaveis: "Responsables",
    nenhumaTarefa: 'Sin tareas del proyecto aún — haga clic en "Crear tareas del proyecto" arriba.',
    tecnicos: "Técnico(s)",
    prazo: "Plazo",
    prioridade: "Prioridad",
    naoAlterar: "(no cambiar)",
    priorities: { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" },
    confirmarAtribuicao: (n: number) => `Confirmar asignación (${n})`,
    atribuindo: "Asignando…",
    tarefasAtribuidas: (n: number) => `${n} tarea(s) asignada(s).`,
  },
};

export default function ProjectPlanPanel() {
  const [searchParams] = useSearchParams();
  const p = usePageText(TEXT);

  const priorityOptions = Object.entries(p.priorities).map(([value, label]) => ({ value, label }));

  const [projects, setProjects] = useState<Project[]>([]);
  const [sowImports, setSowImports] = useState<SowImport[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);

  const [projectId, setProjectId] = useState<number | "">("");
  const [sowImportCode, setSowImportCode] = useState<string>("");

  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [filterActivity, setFilterActivity] = useState<string[]>([]);
  const [filterPath, setFilterPath] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);

  const [assignCollaboratorIds, setAssignCollaboratorIds] = useState<number[]>([]);
  const [assignDeadline, setAssignDeadline] = useState("");
  const [assignPriority, setAssignPriority] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);

  useEffect(() => {
    projectsApi.list({ page_size: "500" }).then((r) => setProjects(r.results));
    planningApi.sowImports.list({ page_size: "100" }).then((r) => setSowImports(r.results));
    collaboratorsApi.list({ page_size: "500" }).then((r) => setCollaborators(r.results));

    const presetProject = searchParams.get("planProject");
    const presetSow = searchParams.get("planSow");
    if (presetProject) setProjectId(Number(presetProject));
    if (presetSow) setSowImportCode(presetSow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPlan() {
    if (!projectId) {
      setPlanError(p.erroProjeto);
      return;
    }
    setPlanError(null);
    setCreateMessage(null);
    setLoadingPlan(true);
    try {
      const data = await planningApi.projectPlan.get(projectId, sowImportCode ? { sowImport: sowImportCode } : {});
      setPlan(data);
      await loadTasks();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setPlanError(axiosErr.response?.data?.detail || p.erroCarregarPlano);
      setPlan(null);
    } finally {
      setLoadingPlan(false);
    }
  }

  async function loadTasks() {
    if (!projectId) return;
    setLoadingTasks(true);
    try {
      const params: Record<string, string> = { project: String(projectId) };
      if (sowImportCode) params.sow_import = sowImportCode;
      const data = await projectTasksApi.list(params);
      setTasks(data.results);
    } finally {
      setLoadingTasks(false);
    }
  }

  useEffect(() => {
    if (projectId && searchParams.get("planProject")) {
      loadPlan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateTasks() {
    if (!projectId) return;
    setCreating(true);
    setCreateMessage(null);
    try {
      const result = await planningApi.projectPlan.createTasks(projectId, sowImportCode ? { sowImport: sowImportCode } : {});
      setCreateMessage(p.tarefasCriadas(result.created_count, result.existing_count));
      await loadPlan();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setCreateMessage(null);
      setPlanError(axiosErr.response?.data?.detail || p.erroCriarTarefas);
    } finally {
      setCreating(false);
    }
  }

  function toggleTask(id: number) {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filteredTasks = tasks.filter((t) => {
    if (filterActivity.length && !filterActivity.includes(t.activity_code ?? "")) return false;
    if (filterPath.length && !filterPath.includes(t.path_code ?? "")) return false;
    if (filterStatus.length && !filterStatus.includes(t.status)) return false;
    return true;
  });

  const distinctActivities = Array.from(new Set(tasks.map((t) => t.activity_code).filter(Boolean))) as string[];
  const distinctPaths = Array.from(new Set(tasks.map((t) => t.path_code).filter(Boolean))) as string[];
  const distinctStatuses = Array.from(new Set(tasks.map((t) => t.status)));

  async function handleAssign() {
    if (!projectId || selectedTaskIds.size === 0 || assignCollaboratorIds.length === 0) {
      setAssignMessage(p.erroAtribuirValidacao);
      return;
    }
    setAssigning(true);
    setAssignMessage(null);
    try {
      const result = await projectsApi.tasksBulk(projectId, {
        action: "update",
        task_ids: Array.from(selectedTaskIds),
        collaborator_ids: assignCollaboratorIds,
        planned_end: assignDeadline ? new Date(assignDeadline).toISOString() : null,
        priority: assignPriority || undefined,
      });
      setAssignMessage(p.tarefasAtribuidas(result.updated ?? selectedTaskIds.size));
      setSelectedTaskIds(new Set());
      await loadTasks();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setAssignMessage(axiosErr.response?.data?.detail || p.erroAtribuir);
    } finally {
      setAssigning(false);
    }
  }

  const selectedProject = projects.find((proj) => proj.id === projectId);

  return (
    <div className="card">
      <div className="toolbar">
        <div>
          <div className="toolbar-title">{p.titulo}</div>
          <div className="toolbar-subtitle">{p.subtitulo}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, marginBottom: 14, alignItems: "flex-end" }}>
        <div className="field-group">
          <span className="field-label">{p.projeto}</span>
          <ProjectCombobox projects={projects} value={projectId} onChange={setProjectId} showAllToggle={false} placeholder={p.selecione} />
        </div>
        <div className="field-group">
          <span className="field-label">{p.importacaoSow}</span>
          <SearchSelect
            options={sowImports.map((s) => ({ value: s.code, label: s.code, sublabel: s.title || p.semTitulo }))}
            value={sowImportCode}
            onChange={(v) => setSowImportCode(String(v))}
            placeholder={p.semSow}
          />
        </div>
        <button className="btn btn-primary" onClick={loadPlan} disabled={!projectId || loadingPlan}>
          {loadingPlan ? p.carregando : p.carregar}
        </button>
      </div>

      {planError && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{planError}</p>}

      {plan && (
        <>
          <div style={{ padding: 12, marginBottom: 14, background: "var(--surface-2, #f7f7f8)", borderRadius: 8, fontSize: 13, lineHeight: 1.8 }}>
            <div>{p.planoProjeto(plan.project.name)}</div>
            <div>{p.scopeItemsProntos(plan.totals.scope_items_ready, plan.totals.scope_items_total, plan.totals.scope_items_pending_resolution)}</div>
            <div>{p.tarefasACriar(plan.totals.project_tasks_to_create)}</div>
            <div>{p.tarefasExistentes(plan.totals.project_tasks_existing)}</div>
            <div>{p.expansaoPaths(plan.totals.paths_involved)}</div>
            {plan.totals.warnings.length > 0 && (
              <div style={{ color: "var(--amber)", marginTop: 4 }}>
                {plan.totals.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleCreateTasks}
                disabled={creating || plan.totals.project_tasks_to_create === 0}
              >
                {creating ? p.criando : p.criarTarefas}
              </button>
            </div>
          </div>

          {createMessage && (
            <div style={{ marginBottom: 14, fontSize: 13 }}>
              <p style={{ color: "var(--green)" }}>✓ {createMessage}</p>
              <div style={{ display: "flex", gap: 8 }}>
                {selectedProject && (
                  <Link className="btn btn-outline btn-sm" to={`/projetos/${selectedProject.id}`}>
                    {p.abrirTarefas}
                  </Link>
                )}
                <button className="btn btn-outline btn-sm" onClick={() => document.getElementById("plan-assign-section")?.scrollIntoView({ behavior: "smooth" })}>
                  {p.atribuirEquipe}
                </button>
              </div>
            </div>
          )}

          <div className="table-wrap" style={{ marginBottom: 20 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{p.itemEscopo}</th>
                  <th>{p.statusRegra}</th>
                  <th>{p.template}</th>
                  <th>{p.revisao}</th>
                  <th>{p.tarefasGeradas}</th>
                  <th>{p.tarefasProjetoExistentes}</th>
                </tr>
              </thead>
              <tbody>
                {plan.scope_items.map((si) => (
                  <tr key={si.id}>
                    <td title={si.raw_text}>{si.code}</td>
                    <td>{si.rule_resolution_status}</td>
                    <td>{si.resolved_template_code || "—"}</td>
                    <td>{si.requires_review ? p.exigeRevisao : "—"}</td>
                    <td>{si.generated_tasks_count}</td>
                    <td>{si.project_tasks_existing_count}</td>
                  </tr>
                ))}
                {plan.scope_items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="table-empty">{p.nenhumItem}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div id="plan-assign-section">
            <div className="toolbar-title" style={{ fontSize: 15, marginBottom: 8 }}>
              {p.tarefasDoProjeto(sowImportCode)}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <MultiSelectFilter
                label={p.atividade}
                options={distinctActivities.map((a) => ({ value: a, label: a }))}
                selected={filterActivity}
                onChange={setFilterActivity}
                allLabel={p.todasAtividades}
              />
              <MultiSelectFilter
                label={p.path}
                options={distinctPaths.map((pp) => ({ value: pp, label: pp }))}
                selected={filterPath}
                onChange={setFilterPath}
                allLabel={p.todosPaths}
              />
              <MultiSelectFilter
                label={p.status}
                options={distinctStatuses.map((s) => ({ value: s, label: s }))}
                selected={filterStatus}
                onChange={setFilterStatus}
                allLabel={p.todosStatus}
              />
            </div>

            {loadingTasks && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{p.carregandoTarefas}</p>}

            {!loadingTasks && (
              <div className="table-wrap" style={{ marginBottom: 14 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>{p.tarefa}</th>
                      <th>{p.atividade}</th>
                      <th>{p.path}</th>
                      <th>{p.qtd}</th>
                      <th>{p.status}</th>
                      <th>{p.responsaveis}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTasks.map((t) => (
                      <tr key={t.id}>
                        <td><input type="checkbox" checked={selectedTaskIds.has(t.id)} onChange={() => toggleTask(t.id)} /></td>
                        <td>{t.task_name || t.custom_name}</td>
                        <td>{t.activity_code || "—"}</td>
                        <td>{t.path_code || "—"}</td>
                        <td>{t.quantity_planned ?? "—"} {t.unit}</td>
                        <td>{t.status_display}</td>
                        <td>{t.collaborators.map((c) => c.name).join(", ") || "—"}</td>
                      </tr>
                    ))}
                    {filteredTasks.length === 0 && (
                      <tr>
                        <td colSpan={7} className="table-empty">{p.nenhumaTarefa}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 10, alignItems: "flex-end" }}>
              <div className="field-group">
                <span className="field-label">{p.tecnicos}</span>
                <SearchMultiSelect
                  options={collaborators.map((c) => ({ value: c.id, label: c.name }))}
                  value={assignCollaboratorIds}
                  onChange={(next) => setAssignCollaboratorIds(next.map(Number))}
                />
              </div>
              <div className="field-group">
                <span className="field-label">{p.prazo}</span>
                <DateInput value={assignDeadline} onChange={setAssignDeadline} />
              </div>
              <div className="field-group">
                <span className="field-label">{p.prioridade}</span>
                <SearchSelect
                  options={priorityOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
                  value={assignPriority}
                  onChange={(v) => setAssignPriority(String(v))}
                  placeholder={p.naoAlterar}
                />
              </div>
              <button className="btn btn-primary btn-sm" onClick={handleAssign} disabled={assigning}>
                <Icon name="person_add" style={{ fontSize: 14 }} />
                {assigning ? p.atribuindo : p.confirmarAtribuicao(selectedTaskIds.size)}
              </button>
            </div>
            {assignMessage && <p style={{ fontSize: 13, marginTop: 8 }}>{assignMessage}</p>}
          </div>
        </>
      )}
    </div>
  );
}
