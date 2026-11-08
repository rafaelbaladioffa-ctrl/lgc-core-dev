import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { projectAttachmentsApi, projectOccurrencesApi, projectsApi, projectTasksApi, rackPositionsApi, registryApi } from "../api/resources";
import type { CollaboratorFull, CollaboratorHours, Project, ProjectAttachment, ProjectOccurrence, ProjectTask, RackPosition } from "../api/types";
import ProjectFormModal from "../components/projects/ProjectFormModal";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import ProjectOccurrenceFormModal from "../components/projects/ProjectOccurrenceFormModal";
import ProjectTaskFormModal from "../components/projects/ProjectTaskFormModal";
import RackPositionBulkModal from "../components/projects/RackPositionBulkModal";
import RackPositionFormModal from "../components/projects/RackPositionFormModal";
import TasksBulkUpdatePanel from "../components/projects/TasksBulkUpdatePanel";
import TasksCatalogAddModal from "../components/projects/TasksCatalogAddModal";
import BulkNamesModal from "../components/ui/BulkNamesModal";
import FileInput from "../components/ui/FileInput";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import StatusBadge from "../components/ui/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { useI18n, usePageText } from "../i18n";
import { downloadAuthenticatedFile } from "../utils/downloadFile";
import { PERMS, hasAnyPerm, hasPerm } from "../utils/permissions";

type DetailTab = "overview" | "tasks" | "hours" | "occurrences" | "attachments";

type TaskSortColumn = "task_name" | "status" | "technicians";

const SEVERITY_TONE: Record<string, { bg: string; color: string }> = {
  low: { bg: "var(--bg)", color: "var(--text-muted)" },
  medium: { bg: "var(--blue-soft)", color: "var(--blue)" },
  high: { bg: "var(--amber-soft)", color: "var(--amber)" },
  critical: { bg: "var(--red-soft)", color: "var(--red)" },
};

const TEXT = {
  "pt-BR": {
    loading: "Carregando...",
    notFound: "Projeto não encontrado.",
    backToProjects: "Voltar para Projetos",
    projectOptions: "Opções do Projeto",
    editProject: "Editar Projeto",
    closeProject: "Encerrar Projeto",
    confirmCloseProject: (name: string) => `Encerrar o projeto "${name}"? Esta ação marcará o projeto como encerrado.`,
    tasksProgress: (n: number, total: number) => `${n} de ${total} tarefas`,
    rackPositions: "Rack Positions",
    importBulk: "Importar em massa",
    add: "Adicionar",
    thRackPosition: "Rack Position",
    thDH: "DH",
    thLinks: "Links",
    thUTP: "UTP",
    thActions: "Ações",
    noRackPositions: "Nenhuma Rack Position cadastrada ainda.",
    importing: "Importando...",
    importFromProjectType: "Importar do Tipo de Projeto",
    addFromCatalog: "Adicionar do Catálogo",
    addCustom: "Adicionar Avulsas",
    newTask: "Nova Tarefa",
    searchPlaceholder: "Buscar por nome da tarefa...",
    searchLabel: "Buscar",
    statusLabel: "Status",
    statusAll: "Todos",
    groupBy: "Agrupar por",
    groupModePackage: "Pacote (atividade + material)",
    groupModeCable: "Cabo (workflow)",
    groupModeActivity: "Atividade (todos os materiais)",
    groupAllMaterials: "Todos os materiais",
    groupModeNone: "Sem agrupamento",
    packageSteps: (done: number, total: number) => `${done}/${total} etapas`,
    packageTasks: (n: number) => `${n} ${n === 1 ? "tarefa" : "tarefas"}`,
    packageProgress: (done: number, total: number) => `${done}/${total} concluídas`,
    packageNoGroup: "Sem grupo",
    packageNoActivity: "Sem atividade do catálogo",
    packageToggleSelect: "Selecionar todas as tarefas do pacote",
    taskStatusOptions: [
      { value: "not_started", label: "Não Iniciada" },
      { value: "in_progress", label: "Em Andamento" },
      { value: "paused", label: "Pausada" },
      { value: "completed", label: "Concluída" },
      { value: "canceled", label: "Cancelada" },
    ],
    thTask: "Tarefa",
    thPath: "Path",
    thQty: "Qtd.",
    thStatus: "Status",
    thTechnicians: "Técnicos",
    noTasksEmpty: "Nenhuma tarefa cadastrada.",
    noTasksFiltered: "Nenhuma tarefa encontrada com esse filtro.",
    scopeItemTitle: (code: string) => `Item de Escopo: ${code}`,
    importSuccess: (n: number) => `${n} Tarefa(s) do Tipo de Projeto adicionada(s) com sucesso.`,
    importNone: "Nenhuma nova Tarefa foi adicionada. Verifique os vínculos do Tipo de Projeto ou as tarefas já existentes.",
    importError: "Não foi possível importar as tarefas.",
    confirmDeleteRack: (pos: string) => `Excluir o Rack Position "${pos}"?`,
    confirmDeleteTask: (name: string) => `Excluir a tarefa "${name}" do projeto?`,
    confirmDeleteOccurrence: (title: string) => `Excluir a ocorrência "${title}"?`,
    confirmDeleteAttachment: (name: string) => `Excluir o anexo "${name}"?`,
    hoursByTech: "Por Técnico",
    hoursByTask: "Por Tarefa",
    thTechnician: "Técnico",
    thHours: "Horas Trabalhadas",
    noHours: "Nenhuma hora registrada ainda.",
    occurrences: "Ocorrências",
    newOccurrence: "Nova Ocorrência",
    thTitle: "Título",
    thResponsible: "Responsável",
    thSeverity: "Criticidade",
    thDate: "Data",
    noOccurrences: "Nenhuma ocorrência registrada.",
    attachFile: "Anexar arquivo",
    fileLabel: "Arquivo",
    descriptionLabel: "Descrição (opcional)",
    descriptionPlaceholder: "Ex: Planta baixa atualizada",
    uploading: "Enviando...",
    send: "Enviar",
    thFile: "Arquivo",
    thDescription: "Descrição",
    thSize: "Tamanho",
    thUploadedBy: "Enviado por",
    noAttachments: "Nenhum arquivo anexado.",
    sections: "Seções",
    tabLabels: { overview: "Visão geral", tasks: "Tarefas", hours: "Horas trabalhadas", occurrences: "Ocorrências", attachments: "Anexos" },
    pendingBadge: (n: number) => `${n} pendente${n > 1 ? "s" : ""}`,
    doneBadge: (done: number, total: number) => `${done}/${total}`,
    responsible: "Responsáveis",
    client: "Cliente",
    cstr: "CSTR",
    schedule: "Cronograma",
    start: "Início",
    deadline: "Prazo",
    end: "Término",
    metaClient: "Cliente",
    metaSite: "Site",
    metaCategory: "Categoria",
    bulkTitle: "Adicionar Tarefas Avulsas",
    bulkHelp: "Um nome de tarefa por linha. Essas tarefas não vêm do catálogo — ficam exclusivas deste projeto.",
    progressLabel: "Progresso geral",
    pendingTask: "Tarefa pendente",
    pendingTasks: "Tarefas pendentes",
    hoursWorked: "Horas trabalhadas",
    historicalHours: "históricas (planilha)",
    occurrencesLabel: "Ocorrências",
    timeline: "Linha do tempo",
    timelineStart: "Início: ",
    timelineDeadline: "Prazo: ",
    today: "Hoje",
    durationPrefix: "Duração: ",
    durationDays: (n: number) => `${n} dias`,
    daysOverdue: (n: number) => `${n} dias em atraso`,
    deadlineToday: "Prazo hoje",
    daysLeft: (n: number) => `${n} dias restantes`,
    statusDist: "Distribuição de status",
    concluded: "concl.",
    donutLabels: [
      { color: "#3B6D11", label: "Concluída" },
      { color: "#185FA5", label: "Em andamento" },
      { color: "#BA7517", label: "Não iniciada" },
      { color: "#A32D2D", label: "Cancelada" },
    ],
    activityProgress: "Progresso por tipo de atividade",
    noTasksOverview: "Nenhuma tarefa cadastrada.",
    top6: "* exibindo top 6 grupos",
    pendingHighlight: "Pendências em destaque",
    allDone: "Todas as tarefas concluídas!",
    morePending: (n: number) => `+ ${n} pendentes · `,
    seeAllTasks: "ver todas as tarefas →",
    description: "Descrição",
  },
  "en-US": {
    loading: "Loading...",
    notFound: "Project not found.",
    backToProjects: "Back to Projects",
    projectOptions: "Project Options",
    editProject: "Edit Project",
    closeProject: "Close Project",
    confirmCloseProject: (name: string) => `Close project "${name}"? This action will mark the project as closed.`,
    tasksProgress: (n: number, total: number) => `${n} of ${total} tasks`,
    rackPositions: "Rack Positions",
    importBulk: "Bulk import",
    add: "Add",
    thRackPosition: "Rack Position",
    thDH: "DH",
    thLinks: "Links",
    thUTP: "UTP",
    thActions: "Actions",
    noRackPositions: "No Rack Positions registered yet.",
    importing: "Importing...",
    importFromProjectType: "Import from Project Type",
    addFromCatalog: "Add from Catalog",
    addCustom: "Add Custom Tasks",
    newTask: "New Task",
    searchPlaceholder: "Search by task name...",
    searchLabel: "Search",
    statusLabel: "Status",
    statusAll: "All",
    groupBy: "Group by",
    groupModePackage: "Package (activity + material)",
    groupModeCable: "Cable (workflow)",
    groupModeActivity: "Activity (all materials)",
    groupAllMaterials: "All materials",
    groupModeNone: "No grouping",
    packageSteps: (done: number, total: number) => `${done}/${total} steps`,
    packageTasks: (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`,
    packageProgress: (done: number, total: number) => `${done}/${total} completed`,
    packageNoGroup: "No group",
    packageNoActivity: "No catalog activity",
    packageToggleSelect: "Select all tasks in the package",
    taskStatusOptions: [
      { value: "not_started", label: "Not Started" },
      { value: "in_progress", label: "In Progress" },
      { value: "paused", label: "Paused" },
      { value: "completed", label: "Completed" },
      { value: "canceled", label: "Canceled" },
    ],
    thTask: "Task",
    thPath: "Path",
    thQty: "Qty.",
    thStatus: "Status",
    thTechnicians: "Technicians",
    noTasksEmpty: "No tasks registered.",
    noTasksFiltered: "No tasks found with this filter.",
    scopeItemTitle: (code: string) => `Scope Item: ${code}`,
    importSuccess: (n: number) => `${n} Task(s) from Project Type added successfully.`,
    importNone: "No new Tasks were added. Check Project Type links or existing tasks.",
    importError: "Could not import tasks.",
    confirmDeleteRack: (pos: string) => `Delete Rack Position "${pos}"?`,
    confirmDeleteTask: (name: string) => `Delete task "${name}" from project?`,
    confirmDeleteOccurrence: (title: string) => `Delete occurrence "${title}"?`,
    confirmDeleteAttachment: (name: string) => `Delete attachment "${name}"?`,
    hoursByTech: "By Technician",
    hoursByTask: "By Task",
    thTechnician: "Technician",
    thHours: "Hours Worked",
    noHours: "No hours registered yet.",
    occurrences: "Occurrences",
    newOccurrence: "New Occurrence",
    thTitle: "Title",
    thResponsible: "Responsible",
    thSeverity: "Severity",
    thDate: "Date",
    noOccurrences: "No occurrences registered.",
    attachFile: "Attach file",
    fileLabel: "File",
    descriptionLabel: "Description (optional)",
    descriptionPlaceholder: "E.g.: Updated floor plan",
    uploading: "Uploading...",
    send: "Send",
    thFile: "File",
    thDescription: "Description",
    thSize: "Size",
    thUploadedBy: "Uploaded by",
    noAttachments: "No files attached.",
    sections: "Sections",
    tabLabels: { overview: "Overview", tasks: "Tasks", hours: "Hours worked", occurrences: "Occurrences", attachments: "Attachments" },
    pendingBadge: (n: number) => `${n} pending`,
    doneBadge: (done: number, total: number) => `${done}/${total}`,
    responsible: "Responsible",
    client: "Client",
    cstr: "CSTR",
    schedule: "Schedule",
    start: "Start",
    deadline: "Deadline",
    end: "End",
    metaClient: "Client",
    metaSite: "Site",
    metaCategory: "Category",
    bulkTitle: "Add Custom Tasks",
    bulkHelp: "One task name per line. These tasks are not from the catalog — they are exclusive to this project.",
    progressLabel: "Overall progress",
    pendingTask: "Pending task",
    pendingTasks: "Pending tasks",
    hoursWorked: "Hours worked",
    historicalHours: "historical (spreadsheet)",
    occurrencesLabel: "Occurrences",
    timeline: "Timeline",
    timelineStart: "Start: ",
    timelineDeadline: "Deadline: ",
    today: "Today",
    durationPrefix: "Duration: ",
    durationDays: (n: number) => `${n} days`,
    daysOverdue: (n: number) => `${n} days overdue`,
    deadlineToday: "Deadline today",
    daysLeft: (n: number) => `${n} days remaining`,
    statusDist: "Status distribution",
    concluded: "compl.",
    donutLabels: [
      { color: "#3B6D11", label: "Completed" },
      { color: "#185FA5", label: "In progress" },
      { color: "#BA7517", label: "Not started" },
      { color: "#A32D2D", label: "Canceled" },
    ],
    activityProgress: "Progress by activity type",
    noTasksOverview: "No tasks registered.",
    top6: "* showing top 6 groups",
    pendingHighlight: "Featured pending items",
    allDone: "All tasks completed!",
    morePending: (n: number) => `+ ${n} pending · `,
    seeAllTasks: "see all tasks →",
    description: "Description",
  },
  "es-ES": {
    loading: "Cargando...",
    notFound: "Proyecto no encontrado.",
    backToProjects: "Volver a Proyectos",
    projectOptions: "Opciones del Proyecto",
    editProject: "Editar Proyecto",
    closeProject: "Cerrar Proyecto",
    confirmCloseProject: (name: string) => `¿Cerrar el proyecto "${name}"? Esta acción marcará el proyecto como cerrado.`,
    tasksProgress: (n: number, total: number) => `${n} de ${total} tareas`,
    rackPositions: "Rack Positions",
    importBulk: "Importar en masa",
    add: "Agregar",
    thRackPosition: "Rack Position",
    thDH: "DH",
    thLinks: "Links",
    thUTP: "UTP",
    thActions: "Acciones",
    noRackPositions: "Ninguna Rack Position registrada todavía.",
    importing: "Importando...",
    importFromProjectType: "Importar del Tipo de Proyecto",
    addFromCatalog: "Agregar del Catálogo",
    addCustom: "Agregar Tareas Sueltas",
    newTask: "Nueva Tarea",
    searchPlaceholder: "Buscar por nombre de tarea...",
    searchLabel: "Buscar",
    statusLabel: "Estado",
    statusAll: "Todos",
    groupBy: "Agrupar por",
    groupModePackage: "Paquete (actividad + material)",
    groupModeCable: "Cable (workflow)",
    groupModeActivity: "Actividad (todos los materiales)",
    groupAllMaterials: "Todos los materiales",
    groupModeNone: "Sin agrupación",
    packageSteps: (done: number, total: number) => `${done}/${total} etapas`,
    packageTasks: (n: number) => `${n} ${n === 1 ? "tarea" : "tareas"}`,
    packageProgress: (done: number, total: number) => `${done}/${total} concluidas`,
    packageNoGroup: "Sin grupo",
    packageNoActivity: "Sin actividad del catálogo",
    packageToggleSelect: "Seleccionar todas las tareas del paquete",
    taskStatusOptions: [
      { value: "not_started", label: "No Iniciada" },
      { value: "in_progress", label: "En Curso" },
      { value: "paused", label: "Pausada" },
      { value: "completed", label: "Completada" },
      { value: "canceled", label: "Cancelada" },
    ],
    thTask: "Tarea",
    thPath: "Path",
    thQty: "Cant.",
    thStatus: "Estado",
    thTechnicians: "Técnicos",
    noTasksEmpty: "Ninguna tarea registrada.",
    noTasksFiltered: "Ninguna tarea encontrada con este filtro.",
    scopeItemTitle: (code: string) => `Ítem de Alcance: ${code}`,
    importSuccess: (n: number) => `${n} Tarea(s) del Tipo de Proyecto agregada(s) con éxito.`,
    importNone: "No se agregó ninguna Tarea nueva. Verifique los vínculos del Tipo de Proyecto o las tareas ya existentes.",
    importError: "No fue posible importar las tareas.",
    confirmDeleteRack: (pos: string) => `¿Eliminar el Rack Position "${pos}"?`,
    confirmDeleteTask: (name: string) => `¿Eliminar la tarea "${name}" del proyecto?`,
    confirmDeleteOccurrence: (title: string) => `¿Eliminar la ocurrencia "${title}"?`,
    confirmDeleteAttachment: (name: string) => `¿Eliminar el archivo adjunto "${name}"?`,
    hoursByTech: "Por Técnico",
    hoursByTask: "Por Tarea",
    thTechnician: "Técnico",
    thHours: "Horas Trabajadas",
    noHours: "Ninguna hora registrada todavía.",
    occurrences: "Ocurrencias",
    newOccurrence: "Nueva Ocurrencia",
    thTitle: "Título",
    thResponsible: "Responsable",
    thSeverity: "Criticidad",
    thDate: "Fecha",
    noOccurrences: "Ninguna ocurrencia registrada.",
    attachFile: "Adjuntar archivo",
    fileLabel: "Archivo",
    descriptionLabel: "Descripción (opcional)",
    descriptionPlaceholder: "Ej: Plano actualizado",
    uploading: "Enviando...",
    send: "Enviar",
    thFile: "Archivo",
    thDescription: "Descripción",
    thSize: "Tamaño",
    thUploadedBy: "Subido por",
    noAttachments: "Ningún archivo adjunto.",
    sections: "Secciones",
    tabLabels: { overview: "Visión general", tasks: "Tareas", hours: "Horas trabajadas", occurrences: "Ocurrencias", attachments: "Adjuntos" },
    pendingBadge: (n: number) => `${n} pendiente${n > 1 ? "s" : ""}`,
    doneBadge: (done: number, total: number) => `${done}/${total}`,
    responsible: "Responsables",
    client: "Cliente",
    cstr: "CSTR",
    schedule: "Cronograma",
    start: "Inicio",
    deadline: "Plazo",
    end: "Término",
    metaClient: "Cliente",
    metaSite: "Site",
    metaCategory: "Categoría",
    bulkTitle: "Agregar Tareas Sueltas",
    bulkHelp: "Un nombre de tarea por línea. Estas tareas no vienen del catálogo — son exclusivas de este proyecto.",
    progressLabel: "Progreso general",
    pendingTask: "Tarea pendiente",
    pendingTasks: "Tareas pendientes",
    hoursWorked: "Horas trabajadas",
    historicalHours: "históricas (planilla)",
    occurrencesLabel: "Ocurrencias",
    timeline: "Línea de tiempo",
    timelineStart: "Inicio: ",
    timelineDeadline: "Plazo: ",
    today: "Hoy",
    durationPrefix: "Duración: ",
    durationDays: (n: number) => `${n} días`,
    daysOverdue: (n: number) => `${n} días de atraso`,
    deadlineToday: "Plazo hoy",
    daysLeft: (n: number) => `${n} días restantes`,
    statusDist: "Distribución de estado",
    concluded: "compl.",
    donutLabels: [
      { color: "#3B6D11", label: "Completada" },
      { color: "#185FA5", label: "En curso" },
      { color: "#BA7517", label: "No iniciada" },
      { color: "#A32D2D", label: "Cancelada" },
    ],
    activityProgress: "Progreso por tipo de actividad",
    noTasksOverview: "Ninguna tarea registrada.",
    top6: "* mostrando top 6 grupos",
    pendingHighlight: "Pendientes destacadas",
    allDone: "¡Todas las tareas completadas!",
    morePending: (n: number) => `+ ${n} pendientes · `,
    seeAllTasks: "ver todas las tareas →",
    description: "Descripción",
  },
};

type PD = typeof TEXT["pt-BR"];

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const projectId = Number(id);
  const p = usePageText(TEXT);
  const { locale } = useI18n();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [rackPositions, setRackPositions] = useState<RackPosition[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [tasksOpen, setTasksOpen] = useState(true);
  const [descriptionOpen, setDescriptionOpen] = useState(false);

  const [rackFormOpen, setRackFormOpen] = useState(false);
  const [rackBulkOpen, setRackBulkOpen] = useState(false);
  const [editingRack, setEditingRack] = useState<RackPosition | null>(null);

  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskCatalogOpen, setTaskCatalogOpen] = useState(false);
  const [customTasksOpen, setCustomTasksOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [importingTasks, setImportingTasks] = useState(false);
  const [taskSearch, setTaskSearch] = useState("");
  const [taskStatusFilter, setTaskStatusFilter] = useState<string[]>([]);
  const [taskSortColumn, setTaskSortColumn] = useState<TaskSortColumn | null>(null);
  const [taskSortDirection, setTaskSortDirection] = useState<"asc" | "desc">("asc");
  // Pacotes de trabalho: atividade + grupo de material, na ordem do fluxo (mesma regra do pool e do bloco).
  const [groupMode, setGroupMode] = useState<"package" | "activity" | "cable" | "none">("package");
  const [collapsedPackages, setCollapsedPackages] = useState<Set<string>>(new Set());

  const [hours, setHours] = useState<CollaboratorHours[]>([]);
  const [hoursLoading, setHoursLoading] = useState(false);

  const [occurrences, setOccurrences] = useState<ProjectOccurrence[]>([]);
  const [occurrencesLoading, setOccurrencesLoading] = useState(false);
  const [occurrenceFormOpen, setOccurrenceFormOpen] = useState(false);
  const [editingOccurrence, setEditingOccurrence] = useState<ProjectOccurrence | null>(null);

  const [attachments, setAttachments] = useState<ProjectAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentDescription, setAttachmentDescription] = useState("");
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [projectMenuOpen]);

  const handleCloseProject = useCallback(async () => {
    if (!project) return;
    if (!confirm(p.confirmCloseProject(project.name))) return;
    setProjectMenuOpen(false);
    await projectsApi.update(project.id, { status: "closed" } as never);
    reload();
  }, [project, p]);

  const canAddRack = hasPerm(user, PERMS.addRackPosition);
  const canChangeRack = hasPerm(user, PERMS.changeRackPosition);
  const canDeleteRack = hasPerm(user, PERMS.deleteRackPosition);
  const canAddTask = hasPerm(user, PERMS.addProjectTask);
  const canChangeTask = hasAnyPerm(user, [PERMS.changeProjectTask, PERMS.manageProjectTasks]);
  const canDeleteTask = hasPerm(user, PERMS.deleteProjectTask);
  const canAddOccurrence = hasPerm(user, PERMS.addProjectOccurrence);
  const canChangeOccurrence = hasPerm(user, PERMS.changeProjectOccurrence);
  const canDeleteOccurrence = hasPerm(user, PERMS.deleteProjectOccurrence);
  const canAddAttachment = hasPerm(user, PERMS.addProjectAttachment);
  const canDeleteAttachment = hasPerm(user, PERMS.deleteProjectAttachment);

  const mountedRef = useRef(true);

  function reload() {
    if (!projectId) return;
    setLoading(true);
    Promise.all([projectsApi.get(projectId), projectsApi.tasks(projectId)])
      .then(([projectData, taskData]) => {
        if (!mountedRef.current) return;
        setProject(projectData);
        setTasks(taskData);
        if (projectData.has_rack_positions) {
          rackPositionsApi.list(projectId).then((r) => {
            if (mountedRef.current) setRackPositions(r.results);
          });
        } else {
          setRackPositions([]);
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }

  function reloadHours() {
    if (!projectId) return;
    setHoursLoading(true);
    projectsApi
      .hoursByCollaborator(projectId)
      .then((data) => {
        if (mountedRef.current) setHours(data);
      })
      .finally(() => {
        if (mountedRef.current) setHoursLoading(false);
      });
  }

  function reloadOccurrences() {
    if (!projectId) return;
    setOccurrencesLoading(true);
    projectOccurrencesApi
      .list(projectId)
      .then((data) => {
        if (mountedRef.current) setOccurrences(data.results);
      })
      .finally(() => {
        if (mountedRef.current) setOccurrencesLoading(false);
      });
  }

  function reloadAttachments() {
    if (!projectId) return;
    setAttachmentsLoading(true);
    projectAttachmentsApi
      .list(projectId)
      .then((data) => {
        if (mountedRef.current) setAttachments(data.results);
      })
      .finally(() => {
        if (mountedRef.current) setAttachmentsLoading(false);
      });
  }

  useEffect(() => {
    mountedRef.current = true;
    reload();
    registryApi.collaborators.list({ page_size: "500" } as never).then((r) => {
      if (mountedRef.current) setCollaborators(r.results);
    });
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);


  function closeRackModals() {
    setRackFormOpen(false);
    setRackBulkOpen(false);
    setEditingRack(null);
  }

  function handleRackSaved() {
    closeRackModals();
    reload();
  }

  async function handleDeleteRack(rp: RackPosition) {
    if (!confirm(p.confirmDeleteRack(rp.position))) return;
    await rackPositionsApi.remove(rp.id);
    reload();
  }

  function closeTaskModals() {
    setTaskFormOpen(false);
    setTaskCatalogOpen(false);
    setCustomTasksOpen(false);
    setEditingTask(null);
  }

  function handleTaskSaved() {
    closeTaskModals();
    reload();
  }

  async function handleDeleteTask(task: ProjectTask) {
    if (!confirm(p.confirmDeleteTask(task.task_name))) return;
    await projectTasksApi.remove(task.id);
    setSelectedTaskIds((prev) => prev.filter((id) => id !== task.id));
    reload();
  }

  function closeOccurrenceModal() {
    setOccurrenceFormOpen(false);
    setEditingOccurrence(null);
  }

  function handleOccurrenceSaved() {
    closeOccurrenceModal();
    reloadOccurrences();
  }

  async function handleDeleteOccurrence(occurrence: ProjectOccurrence) {
    if (!confirm(p.confirmDeleteOccurrence(occurrence.title))) return;
    await projectOccurrencesApi.remove(occurrence.id);
    reloadOccurrences();
  }

  async function handleUploadAttachment() {
    if (!attachmentFile || !projectId) return;
    setUploadingAttachment(true);
    try {
      await projectAttachmentsApi.upload(projectId, attachmentFile, attachmentDescription);
      setAttachmentFile(null);
      setAttachmentDescription("");
      const fileInput = document.getElementById("attachment-file-input") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
      reloadAttachments();
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function handleDeleteAttachment(attachment: ProjectAttachment) {
    if (!confirm(p.confirmDeleteAttachment(attachment.file_name))) return;
    await projectAttachmentsApi.remove(attachment.id);
    reloadAttachments();
  }

  function handleDownloadAttachment(attachment: ProjectAttachment) {
    downloadAuthenticatedFile(projectAttachmentsApi.downloadUrl(attachment.id), attachment.file_name);
  }

  function formatFileSize(bytes: number | null) {
    if (bytes === null) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleImportFromProjectType() {
    if (!project) return;
    setImportingTasks(true);
    try {
      const result = await projectsApi.importTasks(project.id);
      if (result.created) {
        alert(p.importSuccess(result.created));
      } else {
        alert(p.importNone);
      }
      reload();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      alert(axiosErr.response?.data?.detail || p.importError);
    } finally {
      setImportingTasks(false);
    }
  }

  function toggleTaskSelection(taskId: number) {
    setSelectedTaskIds((prev) => (prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]));
  }

  function toggleSelectAll() {
    setSelectedTaskIds((prev) => (prev.length === filteredTasks.length ? [] : filteredTasks.map((t) => t.id)));
  }

  function toggleTaskSort(column: TaskSortColumn) {
    if (taskSortColumn === column) {
      setTaskSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setTaskSortColumn(column);
      setTaskSortDirection("asc");
    }
  }

  const filteredTasks = useMemo(() => {
    const query = taskSearch.trim().toLowerCase();
    let result = tasks.filter((t) => {
      if (taskStatusFilter.length && !taskStatusFilter.includes(t.status)) return false;
      if (query && !t.task_name.toLowerCase().includes(query)) return false;
      return true;
    });
    if (taskSortColumn) {
      const dir = taskSortDirection === "asc" ? 1 : -1;
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (taskSortColumn === "task_name") cmp = a.task_name.localeCompare(b.task_name);
        else if (taskSortColumn === "status") cmp = a.status_display.localeCompare(b.status_display);
        else if (taskSortColumn === "technicians") {
          const nameA = a.collaborators[0]?.name || "";
          const nameB = b.collaborators[0]?.name || "";
          cmp = nameA.localeCompare(nameB);
        }
        return cmp * dir;
      });
    }
    return result;
  }, [tasks, taskSearch, taskStatusFilter, taskSortColumn, taskSortDirection]);

  const taskPackages = useMemo(() => {
    type TaskGroup = { key: string; title: string; subtitle: string; step: number; order: number; tasks: ProjectTask[] };
    const byKey = new Map<string, TaskGroup>();
    // "Separar materiais 72F OS2 ... 45m" → "72F OS2 ... 45m": o cabo (família + metragem) sem o nome da etapa.
    const cableLabel = (t: ProjectTask) =>
      t.activity_name && t.task_name.startsWith(t.activity_name) ? t.task_name.slice(t.activity_name.length).trim() : t.task_name;
    filteredTasks.forEach((task, index) => {
      const key =
        groupMode === "cable"
          ? `item|${task.scope_item_code ?? `task-${task.id}`}`
          : groupMode === "activity"
            ? `${task.activity_code ?? ""}|*`
            : `${task.activity_code ?? ""}|${task.work_group ?? ""}`;
      let group = byKey.get(key);
      if (!group) {
        group =
          groupMode === "cable"
            ? { key, title: cableLabel(task), subtitle: task.work_group_label ?? "", step: 0, order: index, tasks: [] }
            : { key, title: task.activity_name ?? "", subtitle: groupMode === "activity" ? p.groupAllMaterials : (task.work_group_label ?? ""), step: task.step_order ?? 9999, order: index, tasks: [] };
        byKey.set(key, group);
      }
      group.tasks.push(task);
    });
    const groups = Array.from(byKey.values());
    if (groupMode === "cable") {
      // Cabos na ordem da lista; etapas de cada cabo na ordem do fluxo.
      for (const g of groups) g.tasks.sort((a, b) => (a.step_order ?? 9999) - (b.step_order ?? 9999));
      return groups.sort((a, b) => a.order - b.order);
    }
    return groups.sort((a, b) => a.step - b.step || a.title.localeCompare(b.title) || a.subtitle.localeCompare(b.subtitle));
  }, [filteredTasks, groupMode]);
  // Com ordenação por coluna ativa, a lista volta a ser plana (a ordenação do usuário prevalece).
  const showPackages = groupMode !== "none" && taskSortColumn === null;

  const renderTaskRow = (task: ProjectTask) => (
                        <tr key={task.id}>
      {(canChangeTask || canDeleteTask) && (
        <td>
          <input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={() => toggleTaskSelection(task.id)} />
        </td>
      )}
      <td title={task.scope_item_code ? p.scopeItemTitle(task.scope_item_code) : undefined}>{task.task_name}</td>
      <td>{task.path_code || "—"}</td>
      <td>{task.quantity_planned ? `${task.quantity_planned} ${task.unit}`.trim() : "—"}</td>
      {project?.has_rack_positions && <td>{task.rack_position_labels.join(", ") || "—"}</td>}
      <td><StatusBadge status={task.status} label={task.status_display} /></td>
      <td>{task.collaborators.map((c) => c.name).join(", ") || "—"}</td>
      {(canChangeTask || canDeleteTask) && (
        <td>
          <div style={{ display: "flex", gap: 8 }}>
            {canChangeTask && (
              <button className="btn btn-outline btn-sm" onClick={() => { setEditingTask(task); setTaskFormOpen(true); }}>
                <Icon name="edit" style={{ fontSize: 14 }} />
              </button>
            )}
            {canDeleteTask && (
              <button className="btn btn-outline btn-sm" onClick={() => handleDeleteTask(task)} style={{ color: "var(--red)" }}>
                <Icon name="delete" style={{ fontSize: 14 }} />
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  );

  function togglePackageSelection(ids: number[]) {
    setSelectedTaskIds((prev) => (ids.every((id) => prev.includes(id)) ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]));
  }

  function togglePackageCollapsed(key: string) {
    setCollapsedPackages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function sortIndicator(column: TaskSortColumn) {
    if (taskSortColumn !== column) return null;
    return <Icon name={taskSortDirection === "asc" ? "arrow_upward" : "arrow_downward"} style={{ fontSize: 14, verticalAlign: "middle", marginLeft: 4 }} />;
  }

  if (loading) return <p style={{ color: "var(--text-muted)" }}>{p.loading}</p>;
  if (!project) return <p style={{ color: "var(--text-muted)" }}>{p.notFound}</p>;

  const pendingTasks = tasks.filter((t) => t.status !== "completed" && t.status !== "canceled");

  function handleNavClick(tab: DetailTab) {
    setActiveTab(tab);
    if (tab === "hours" && hours.length === 0 && !hoursLoading) reloadHours();
    if (tab === "occurrences" && occurrences.length === 0 && !occurrencesLoading) reloadOccurrences();
    if (tab === "attachments" && attachments.length === 0 && !attachmentsLoading) reloadAttachments();
  }

  return (
    <div>
      {/* ── cabeçalho do projeto — estilo D ── */}
      <div className="card" style={{ padding: 0, marginBottom: 16, overflow: "visible" }}>
        {/* faixa laranja no topo */}
        <div style={{ height: 3, background: "var(--orange)", borderRadius: "8px 8px 0 0" }} />

        <div style={{ padding: "14px 20px" }}>
          <Link
            to="/projetos"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-muted)", textDecoration: "none", fontSize: 12, marginBottom: 10 }}
          >
            <Icon name="arrow_back" style={{ fontSize: 15 }} />
            {p.backToProjects}
          </Link>

          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
            {/* lado esquerdo: código + título + grid de campos */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--orange)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>
                {project.code}
              </div>
              <h1 style={{ fontSize: 19, fontWeight: 800, color: "var(--text)", margin: "0 0 12px", lineHeight: 1.2 }}>{project.name}</h1>

              {/* grid de metadados */}
              <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
                {project.po && (
                  <div style={{ paddingRight: 16, borderRight: "1px solid var(--border)", marginRight: 16 }}>
                    <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)", marginBottom: 1 }}>PO</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{project.po}</div>
                  </div>
                )}
                {project.client_name && (
                  <div style={{ paddingRight: 16, borderRight: "1px solid var(--border)", marginRight: 16 }}>
                    <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)", marginBottom: 1 }}>{p.metaClient}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{project.client_name}</div>
                  </div>
                )}
                {project.site_name && (
                  <div style={{ paddingRight: 16, borderRight: project.category_name ? "1px solid var(--border)" : "none", marginRight: project.category_name ? 16 : 0 }}>
                    <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)", marginBottom: 1 }}>{p.metaSite}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{project.site_name}</div>
                  </div>
                )}
                {project.category_name && (
                  <div>
                    <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)", marginBottom: 1 }}>{p.metaCategory}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{project.category_name}</div>
                  </div>
                )}
              </div>
            </div>

            {/* lado direito: status + progresso + menu */}
            <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
              <StatusBadge status={project.status} label={project.status_display} />
              <div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "var(--orange)", lineHeight: 1 }}>{project.progress_percent}%</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{p.tasksProgress(project.completed_tasks, project.total_tasks)}</div>
              </div>
              {/* dropdown de opções do projeto */}
              <div ref={projectMenuRef} style={{ position: "relative" }}>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setProjectMenuOpen((v) => !v)}
                >
                  <Icon name="settings" style={{ fontSize: 15 }} />
                  {p.projectOptions}
                  <Icon name={projectMenuOpen ? "expand_less" : "expand_more"} style={{ fontSize: 15 }} />
                </button>
                {projectMenuOpen && (
                  <div style={{
                    position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 100,
                    background: "var(--white)", border: "1px solid var(--border)",
                    borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.15)",
                    minWidth: 180, overflow: "hidden",
                  }}>
                    <button
                      onClick={() => { setEditingProject(true); setProjectMenuOpen(false); }}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--text)", textAlign: "left" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                    >
                      <Icon name="edit" style={{ fontSize: 15, color: "var(--text-muted)" }} />
                      {p.editProject}
                    </button>
                    <div style={{ height: 1, background: "var(--border)" }} />
                    <button
                      onClick={handleCloseProject}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--danger)", textAlign: "left" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                    >
                      <Icon name="do_not_disturb_on" style={{ fontSize: 15, color: "var(--danger)" }} />
                      {p.closeProject}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── layout principal: conteúdo + sidebar de navegação ── */}
      <div className="project-detail-layout" style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>

        {/* área de conteúdo */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* ── VISÃO GERAL ── */}
          {activeTab === "overview" && (
            <OverviewSection
              project={project}
              tasks={tasks}
              pendingTasks={pendingTasks}
              occurrencesCount={occurrences.length}
              descriptionOpen={descriptionOpen}
              setDescriptionOpen={setDescriptionOpen}
              onGoToTasks={() => handleNavClick("tasks")}
              p={p}
              locale={locale}
            />
          )}

          {/* ── TAREFAS ── */}
          {activeTab === "tasks" && (
            <>
              {project.has_rack_positions && (
                <>
                  <div className="section-header-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", margin: 0 }}>{p.rackPositions}</h2>
                    <div className="section-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {canAddRack && (
                        <>
                          <button className="btn btn-outline btn-sm" onClick={() => setRackBulkOpen(true)}>
                            <Icon name="playlist_add" style={{ fontSize: 15 }} />
                            {p.importBulk}
                          </button>
                          <button className="btn btn-primary btn-sm" onClick={() => setRackFormOpen(true)}>
                            <Icon name="add" style={{ fontSize: 15 }} />
                            {p.add}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="card" style={{ marginBottom: 20 }}>
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>{p.thRackPosition}</th>
                            <th>{p.thDH}</th>
                            <th>{p.thLinks}</th>
                            <th>{p.thUTP}</th>
                            {(canChangeRack || canDeleteRack) && <th>{p.thActions}</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {rackPositions.map((rp) => (
                            <tr key={rp.id}>
                              <td>{rp.position}</td>
                              <td>{rp.dh || "—"}</td>
                              <td>{rp.links}</td>
                              <td>{rp.utp}</td>
                              {(canChangeRack || canDeleteRack) && (
                                <td>
                                  <div style={{ display: "flex", gap: 8 }}>
                                    {canChangeRack && (
                                      <button className="btn btn-outline btn-sm" onClick={() => { setEditingRack(rp); setRackFormOpen(true); }}>
                                        <Icon name="edit" style={{ fontSize: 14 }} />
                                      </button>
                                    )}
                                    {canDeleteRack && (
                                      <button className="btn btn-outline btn-sm" onClick={() => handleDeleteRack(rp)} style={{ color: "var(--red)" }}>
                                        <Icon name="delete" style={{ fontSize: 14 }} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                          {rackPositions.length === 0 && (
                            <tr><td colSpan={5}><div className="table-empty">{p.noRackPositions}</div></td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              <div className="section-header-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", margin: 0 }}>
                  {p.tabLabels.tasks} <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" }}>({project.completed_tasks} / {project.total_tasks})</span>
                </h2>
                {canAddTask && (
                  <div className="section-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {project.project_type && (
                      <button className="btn btn-outline btn-sm" onClick={handleImportFromProjectType} disabled={importingTasks}>
                        <Icon name="library_add" style={{ fontSize: 15 }} />
                        {importingTasks ? p.importing : p.importFromProjectType}
                      </button>
                    )}
                    <button className="btn btn-outline btn-sm" onClick={() => setTaskCatalogOpen(true)}>
                      <Icon name="playlist_add" style={{ fontSize: 15 }} />
                      {p.addFromCatalog}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => setCustomTasksOpen(true)}>
                      <Icon name="edit_note" style={{ fontSize: 15 }} />
                      {p.addCustom}
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={() => setTaskFormOpen(true)}>
                      <Icon name="add" style={{ fontSize: 15 }} />
                      {p.newTask}
                    </button>
                  </div>
                )}
              </div>

              {selectedTaskIds.length > 0 && (canChangeTask || canDeleteTask) && (
                <TasksBulkUpdatePanel
                  project={project}
                  selectedIds={selectedTaskIds}
                  collaborators={collaborators}
                  rackPositions={rackPositions}
                  onClear={() => setSelectedTaskIds([])}
                  onApplied={() => { setSelectedTaskIds([]); reload(); }}
                />
              )}

              <div className="filter-row" style={{ marginBottom: 12 }}>
                <div className="field-group" style={{ width: 220 }}>
                  <span className="field-label">{p.searchLabel}</span>
                  <div className="search-input-wrap">
                    <Icon name="search" />
                    <input className="input" placeholder={p.searchPlaceholder} value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} />
                  </div>
                </div>
                <MultiSelectFilter
                  label={p.statusLabel}
                  options={p.taskStatusOptions.map((o) => ({ value: o.value, label: o.label }))}
                  selected={taskStatusFilter}
                  onChange={setTaskStatusFilter}
                  allLabel={p.statusAll}
                />
                <div className="field-group" style={{ width: 220 }}>
                  <span className="field-label">{p.groupBy}</span>
                  <select className="select" value={groupMode} onChange={(e) => setGroupMode(e.target.value as "package" | "activity" | "cable" | "none")}>
                    <option value="package">{p.groupModePackage}</option>
                    <option value="activity">{p.groupModeActivity}</option>
                    <option value="cable">{p.groupModeCable}</option>
                    <option value="none">{p.groupModeNone}</option>
                  </select>
                </div>
              </div>

              <div className="card">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        {(canChangeTask || canDeleteTask) && (
                          <th style={{ width: 32 }}>
                            <input type="checkbox" checked={filteredTasks.length > 0 && selectedTaskIds.length === filteredTasks.length} onChange={toggleSelectAll} />
                          </th>
                        )}
                        <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleTaskSort("task_name")}>
                          {p.thTask}{sortIndicator("task_name")}
                        </th>
                        <th>{p.thPath}</th>
                        <th>{p.thQty}</th>
                        {project.has_rack_positions && <th>{p.thRackPosition}</th>}
                        <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleTaskSort("status")}>
                          {p.thStatus}{sortIndicator("status")}
                        </th>
                        <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleTaskSort("technicians")}>
                          {p.thTechnicians}{sortIndicator("technicians")}
                        </th>
                        {(canChangeTask || canDeleteTask) && <th>{p.thActions}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {showPackages
                        ? taskPackages.map((pkg) => {
                            const ids = pkg.tasks.map((t) => t.id);
                            const done = pkg.tasks.filter((t) => t.status === "completed").length;
                            const collapsed = collapsedPackages.has(pkg.key);
                            const colCount = project.has_rack_positions ? 8 : 7;
                            return (
                              <Fragment key={pkg.key}>
                                <tr className="ops-pool-package">
                                  <td colSpan={colCount}>
                                    <div className="ops-pool-package-bar" style={{ paddingLeft: 12, cursor: "pointer" }} onClick={() => togglePackageCollapsed(pkg.key)}>
                                      {(canChangeTask || canDeleteTask) && (
                                        <input
                                          type="checkbox"
                                          title={p.packageToggleSelect}
                                          checked={ids.every((id) => selectedTaskIds.includes(id))}
                                          onClick={(e) => e.stopPropagation()}
                                          onChange={() => togglePackageSelection(ids)}
                                        />
                                      )}
                                      <Icon name={collapsed ? "chevron_right" : "expand_more"} style={{ fontSize: 18 }} />
                                      <span className="ops-pool-package-name">{pkg.title || p.packageNoActivity}</span>
                                      <span className="ops-pool-package-group" style={{ ["--pool-accent" as string]: "var(--orange)" }}>{pkg.subtitle || p.packageNoGroup}</span>
                                      <span className="ops-pool-package-meta">
                                        {groupMode === "cable"
                                          ? p.packageSteps(done, pkg.tasks.length)
                                          : `${p.packageTasks(pkg.tasks.length)} · ${p.packageProgress(done, pkg.tasks.length)}`}
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                                {!collapsed && pkg.tasks.map((task) => renderTaskRow(task))}
                              </Fragment>
                            );
                          })
                        : filteredTasks.map((task) => renderTaskRow(task))}
                      {filteredTasks.length === 0 && (
                        <tr>
                          <td colSpan={project.has_rack_positions ? 8 : 7}>
                            <div className="table-empty">
                              {tasks.length === 0 ? p.noTasksEmpty : p.noTasksFiltered}
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ── HORAS ── */}
          {activeTab === "hours" && (
            <div className="panel-field-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <h2 style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", margin: "0 0 10px" }}>{p.hoursByTech}</h2>
                <div className="card">
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>{p.thTechnician}</th><th>{p.thHours}</th></tr></thead>
                      <tbody>
                        {hours.map((item) => (
                          <tr key={item.collaborator_id}>
                            <td>{item.collaborator_name}</td>
                            <td>{item.hours}h</td>
                          </tr>
                        ))}
                        {!hoursLoading && hours.length === 0 && (
                          <tr><td colSpan={2}><div className="table-empty">{p.noHours}</div></td></tr>
                        )}
                        {hoursLoading && (
                          <tr><td colSpan={2}><div className="table-empty">{p.loading}</div></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div>
                <h2 style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", margin: "0 0 10px" }}>{p.hoursByTask}</h2>
                <div className="card">
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>{p.thTask}</th><th>{p.thHours}</th></tr></thead>
                      <tbody>
                        {tasks.map((task) => (
                          <tr key={task.id}>
                            <td>{task.task_name}</td>
                            <td>{task.worked_hours}h</td>
                          </tr>
                        ))}
                        {tasks.length === 0 && (
                          <tr><td colSpan={2}><div className="table-empty">{p.noTasksEmpty}</div></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── OCORRÊNCIAS ── */}
          {activeTab === "occurrences" && (
            <>
              <div className="section-header-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", margin: 0 }}>{p.occurrences}</h2>
                {canAddOccurrence && (
                  <button className="btn btn-primary btn-sm" onClick={() => setOccurrenceFormOpen(true)}>
                    <Icon name="add" style={{ fontSize: 15 }} />
                    {p.newOccurrence}
                  </button>
                )}
              </div>
              <div className="card">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{p.thTitle}</th>
                        <th>{p.thResponsible}</th>
                        <th>{p.thSeverity}</th>
                        <th>{p.thStatus}</th>
                        <th>{p.thDate}</th>
                        {(canChangeOccurrence || canDeleteOccurrence) && <th>{p.thActions}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {occurrences.map((occurrence) => (
                        <tr key={occurrence.id}>
                          <td>{occurrence.title}</td>
                          <td>{occurrence.responsible_name || "—"}</td>
                          <td>
                            <span className="badge" style={SEVERITY_TONE[occurrence.severity]}>{occurrence.severity_display}</span>
                          </td>
                          <td><StatusBadge status={occurrence.status} label={occurrence.status_display} /></td>
                          <td>{new Date(occurrence.occurred_at + "T00:00:00").toLocaleDateString(locale)}</td>
                          {(canChangeOccurrence || canDeleteOccurrence) && (
                            <td>
                              <div style={{ display: "flex", gap: 8 }}>
                                {canChangeOccurrence && (
                                  <button className="btn btn-outline btn-sm" onClick={() => { setEditingOccurrence(occurrence); setOccurrenceFormOpen(true); }}>
                                    <Icon name="edit" style={{ fontSize: 14 }} />
                                  </button>
                                )}
                                {canDeleteOccurrence && (
                                  <button className="btn btn-outline btn-sm" onClick={() => handleDeleteOccurrence(occurrence)} style={{ color: "var(--red)" }}>
                                    <Icon name="delete" style={{ fontSize: 14 }} />
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                      {!occurrencesLoading && occurrences.length === 0 && (
                        <tr><td colSpan={6}><div className="table-empty">{p.noOccurrences}</div></td></tr>
                      )}
                      {occurrencesLoading && (
                        <tr><td colSpan={6}><div className="table-empty">{p.loading}</div></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ── ANEXOS ── */}
          {activeTab === "attachments" && (
            <>
              {canAddAttachment && (
                <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                  <h2 style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", margin: "0 0 12px" }}>{p.attachFile}</h2>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div className="field-group" style={{ flex: "1 1 220px" }}>
                      <span className="field-label">{p.fileLabel}</span>
                      <FileInput value={attachmentFile} onChange={setAttachmentFile} />
                    </div>
                    <div className="field-group" style={{ flex: "1 1 220px" }}>
                      <span className="field-label">{p.descriptionLabel}</span>
                      <input type="text" className="input" value={attachmentDescription} onChange={(e) => setAttachmentDescription(e.target.value)} placeholder={p.descriptionPlaceholder} />
                    </div>
                    <button className="btn btn-primary" onClick={handleUploadAttachment} disabled={!attachmentFile || uploadingAttachment}>
                      <Icon name="upload" style={{ fontSize: 16 }} />
                      {uploadingAttachment ? p.uploading : p.send}
                    </button>
                  </div>
                </div>
              )}
              <div className="card">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{p.thFile}</th>
                        <th>{p.thDescription}</th>
                        <th>{p.thSize}</th>
                        <th>{p.thUploadedBy}</th>
                        <th>{p.thDate}</th>
                        <th>{p.thActions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attachments.map((attachment) => (
                        <tr key={attachment.id}>
                          <td>{attachment.file_name}</td>
                          <td>{attachment.description || "—"}</td>
                          <td>{formatFileSize(attachment.file_size)}</td>
                          <td>{attachment.uploaded_by_name || "—"}</td>
                          <td>{new Date(attachment.created_at).toLocaleDateString(locale)}</td>
                          <td>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button className="btn btn-outline btn-sm" onClick={() => handleDownloadAttachment(attachment)}>
                                <Icon name="download" style={{ fontSize: 14 }} />
                              </button>
                              {canDeleteAttachment && (
                                <button className="btn btn-outline btn-sm" onClick={() => handleDeleteAttachment(attachment)} style={{ color: "var(--red)" }}>
                                  <Icon name="delete" style={{ fontSize: 14 }} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!attachmentsLoading && attachments.length === 0 && (
                        <tr><td colSpan={6}><div className="table-empty">{p.noAttachments}</div></td></tr>
                      )}
                      {attachmentsLoading && (
                        <tr><td colSpan={6}><div className="table-empty">{p.loading}</div></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── sidebar de navegação ── */}
        <div className="project-detail-sidebar" style={{ width: 260, flexShrink: 0 }}>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", fontSize: 10, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid var(--border)" }}>
              {p.sections}
            </div>

            {(["overview", "tasks", "hours", "occurrences", "attachments"] as DetailTab[]).map((tab) => {
              const badges: Record<DetailTab, string | null> = {
                overview: null,
                tasks: pendingTasks.length > 0 ? p.pendingBadge(pendingTasks.length) : p.doneBadge(project.completed_tasks, project.total_tasks),
                hours: `${project.worked_hours}h`,
                occurrences: occurrences.length > 0 ? String(occurrences.length) : null,
                attachments: attachments.length > 0 ? String(attachments.length) : null,
              };
              const icons: Record<DetailTab, string> = {
                overview: "dashboard",
                tasks: "checklist",
                hours: "schedule",
                occurrences: "warning",
                attachments: "attach_file",
              };
              const badgeWarn = tab === "tasks" && pendingTasks.length > 0;
              const isActive = activeTab === tab;

              return (
                <button
                  key={tab}
                  onClick={() => handleNavClick(tab)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "10px 14px",
                    background: isActive ? "var(--primary-soft, rgba(230,90,0,0.08))" : "none",
                    borderLeft: isActive ? "3px solid var(--orange)" : "3px solid transparent",
                    borderTop: "none",
                    borderRight: "none",
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <Icon name={icons[tab]} style={{ fontSize: 15, color: isActive ? "var(--orange)" : "var(--text-faint)" }} />
                    <span style={{ fontSize: 13, fontWeight: isActive ? 700 : 400, color: isActive ? "var(--orange)" : "var(--text)" }}>
                      {p.tabLabels[tab]}
                    </span>
                  </span>
                  {badges[tab] && (
                    <span
                      className="badge"
                      style={{
                        fontSize: 10,
                        padding: "1px 6px",
                        background: badgeWarn ? "var(--warning-soft, #fef3cd)" : "var(--surface-2)",
                        color: badgeWarn ? "var(--warning)" : "var(--text-muted)",
                        flexShrink: 0,
                      }}
                    >
                      {badges[tab]}
                    </span>
                  )}
                </button>
              );
            })}

            {/* bloco de metadados no sidebar */}
            <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                {p.responsible}
              </div>
              <SidebarField label={p.cstr} value={project.responsible_cstr_name || "—"} />
              <SidebarField label={p.client} value={project.responsible_client_name || "—"} />
            </div>

            <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                {p.schedule}
              </div>
              <SidebarField label={p.start} value={formatDate(project.actual_start || project.planned_start, locale)} />
              <SidebarField
                label={p.deadline}
                value={formatDate(project.planned_end, locale)}
                warn={!!project.planned_end && !project.actual_end}
              />
              {project.actual_end && <SidebarField label={p.end} value={formatDate(project.actual_end, locale)} />}
            </div>
          </div>
        </div>
      </div>

      {/* ── modais ── */}
      {editingProject && (
        <ProjectFormModal
          project={project}
          onClose={() => setEditingProject(false)}
          onSaved={() => { setEditingProject(false); reload(); }}
        />
      )}
      {rackFormOpen && <RackPositionFormModal projectId={project.id} rackPosition={editingRack} onClose={closeRackModals} onSaved={handleRackSaved} />}
      {rackBulkOpen && <RackPositionBulkModal projectId={project.id} onClose={closeRackModals} onSaved={handleRackSaved} />}
      {taskFormOpen && (
        <ProjectTaskFormModal
          project={project}
          projectTask={editingTask}
          existingTasks={tasks}
          rackPositions={rackPositions}
          onClose={closeTaskModals}
          onSaved={handleTaskSaved}
        />
      )}
      {taskCatalogOpen && (
        <TasksCatalogAddModal project={project} existingTasks={tasks} rackPositions={rackPositions} onClose={closeTaskModals} onSaved={handleTaskSaved} />
      )}
      {customTasksOpen && (
        <BulkNamesModal
          title={p.bulkTitle}
          helpText={p.bulkHelp}
          extraFields={[]}
          extraValues={{}}
          onSave={(names) => projectsApi.createCustomTasks(project.id, names)}
          onClose={closeTaskModals}
          onSaved={handleTaskSaved}
        />
      )}
      {occurrenceFormOpen && (
        <ProjectOccurrenceFormModal
          projectId={project.id}
          occurrence={editingOccurrence}
          collaborators={collaborators}
          onClose={closeOccurrenceModal}
          onSaved={handleOccurrenceSaved}
        />
      )}
    </div>
  );
}

// ── helpers de agrupamento de tarefas por prefixo ──
function groupTasksByPrefix(tasks: ProjectTask[]) {
  const groups: Record<string, { total: number; completed: number }> = {};
  for (const t of tasks) {
    const prefix = t.task_name.split(" ").slice(0, 2).join(" ");
    if (!groups[prefix]) groups[prefix] = { total: 0, completed: 0 };
    groups[prefix].total++;
    if (t.status === "completed") groups[prefix].completed++;
  }
  return Object.entries(groups)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 6);
}

function OverviewSection({
  project, tasks, pendingTasks, occurrencesCount,
  descriptionOpen, setDescriptionOpen, onGoToTasks, p, locale,
}: {
  project: Project;
  tasks: ProjectTask[];
  pendingTasks: ProjectTask[];
  occurrencesCount: number;
  descriptionOpen: boolean;
  setDescriptionOpen: (v: boolean) => void;
  onGoToTasks: () => void;
  p: PD;
  locale: string;
}) {
  // timeline
  const startStr = project.actual_start || project.planned_start;
  const endStr = project.planned_end;
  const tlPct = (() => {
    if (!startStr || !endStr) return 0;
    const start = new Date(startStr + "T00:00:00").getTime();
    const end = new Date(endStr + "T00:00:00").getTime();
    const now = Date.now();
    if (end <= start) return 0;
    return Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
  })();
  const daysLeft = (() => {
    if (!endStr) return null;
    const diff = new Date(endStr + "T00:00:00").getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  })();
  const daysTotal = (() => {
    if (!startStr || !endStr) return null;
    const diff = new Date(endStr + "T00:00:00").getTime() - new Date(startStr + "T00:00:00").getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  })();

  // contagem por status
  const statusCounts = {
    completed: tasks.filter((t) => t.status === "completed").length,
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    not_started: tasks.filter((t) => t.status === "not_started" || t.status === "paused").length,
    canceled: tasks.filter((t) => t.status === "canceled").length,
  };
  const donutTotal = tasks.length || 1;
  const donutR = 28;
  const donutC = 2 * Math.PI * donutR;
  const completedArc = (statusCounts.completed / donutTotal) * donutC;
  const inProgressArc = (statusCounts.in_progress / donutTotal) * donutC;
  const notStartedArc = ((statusCounts.not_started + statusCounts.canceled) / donutTotal) * donutC;
  const completedOffset = 0;
  const inProgressOffset = completedArc;
  const notStartedOffset = completedArc + inProgressArc;

  const groups = groupTasksByPrefix(tasks);

  const highlightPending = pendingTasks.slice(0, 4);

  const donutCounts = [statusCounts.completed, statusCounts.in_progress, statusCounts.not_started, statusCounts.canceled];

  return (
    <>
      {/* KPIs */}
      <div className="project-stats-4col" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: "var(--orange)" }}>{project.progress_percent}%</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{p.progressLabel}</div>
        </div>
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: pendingTasks.length > 0 ? "var(--warning)" : "var(--success)" }}>
            {pendingTasks.length}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
            {pendingTasks.length === 1 ? p.pendingTask : p.pendingTasks}
          </div>
        </div>
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{project.worked_hours}h</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{p.hoursWorked}</div>
          {project.historical_hours > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              + {project.historical_hours}h {p.historicalHours}
            </div>
          )}
        </div>
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{occurrencesCount}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{p.occurrencesLabel}</div>
        </div>
      </div>

      {/* linha 1: timeline + donut */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* timeline */}
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 16 }}>
            {p.timeline}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginBottom: 22 }}>
            <span>{p.timelineStart}{formatDate(startStr, locale)}</span>
            <span>{p.timelineDeadline}{formatDate(endStr, locale)}</span>
          </div>
          <div style={{ position: "relative", height: 10, background: "var(--surface-2)", borderRadius: 5, border: "0.5px solid var(--border)" }}>
            <div style={{ height: "100%", borderRadius: 5, background: "var(--orange)", width: `${tlPct}%` }} />
            {tlPct > 0 && tlPct < 100 && (
              <div style={{ position: "absolute", top: -8, left: `${tlPct}%`, width: 2, height: 26, background: "var(--orange)", borderRadius: 1 }}>
                <span style={{ position: "absolute", bottom: "100%", left: 5, fontSize: 10, color: "var(--orange)", fontWeight: 700, whiteSpace: "nowrap", marginBottom: 2 }}>
                  {p.today}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
            {daysTotal != null && (
              <span>{p.durationPrefix}<strong style={{ color: "var(--text)" }}>{p.durationDays(daysTotal)}</strong></span>
            )}
            {daysLeft != null && (
              <span style={{ color: daysLeft < 0 ? "var(--danger)" : daysLeft <= 3 ? "var(--warning)" : "var(--text-muted)" }}>
                {daysLeft < 0 ? p.daysOverdue(Math.abs(daysLeft)) : daysLeft === 0 ? p.deadlineToday : p.daysLeft(daysLeft)}
              </span>
            )}
          </div>
        </div>

        {/* donut */}
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 16 }}>
            {p.statusDist}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ position: "relative", width: 90, height: 90, flexShrink: 0 }}>
              <svg width="90" height="90" viewBox="0 0 90 90" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="45" cy="45" r={donutR + 6} fill="none" stroke="var(--border)" strokeWidth="13" />
                {statusCounts.completed > 0 && (
                  <circle cx="45" cy="45" r={donutR + 6} fill="none" stroke="#3B6D11" strokeWidth="13"
                    strokeDasharray={`${completedArc * ((donutR + 6) / donutR)} ${donutC * ((donutR + 6) / donutR) - completedArc * ((donutR + 6) / donutR)}`}
                    strokeDashoffset={-completedOffset * ((donutR + 6) / donutR)} />
                )}
                {statusCounts.in_progress > 0 && (
                  <circle cx="45" cy="45" r={donutR + 6} fill="none" stroke="#185FA5" strokeWidth="13"
                    strokeDasharray={`${inProgressArc * ((donutR + 6) / donutR)} ${donutC * ((donutR + 6) / donutR) - inProgressArc * ((donutR + 6) / donutR)}`}
                    strokeDashoffset={-inProgressOffset * ((donutR + 6) / donutR)} />
                )}
                {(statusCounts.not_started + statusCounts.canceled) > 0 && (
                  <circle cx="45" cy="45" r={donutR + 6} fill="none" stroke="#FAEEDA" strokeWidth="13"
                    strokeDasharray={`${notStartedArc * ((donutR + 6) / donutR)} ${donutC * ((donutR + 6) / donutR) - notStartedArc * ((donutR + 6) / donutR)}`}
                    strokeDashoffset={-notStartedOffset * ((donutR + 6) / donutR)} />
                )}
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "var(--orange)", lineHeight: 1 }}>
                {project.progress_percent}%
                <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400, marginTop: 2 }}>{p.concluded}</span>
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              {p.donutLabels.map(({ color, label }, i) => (
                <div key={color} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, fontSize: 13 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }} />
                    <span style={{ color: "var(--text)" }}>{label}</span>
                  </span>
                  <span style={{ fontWeight: 700, color }}>{donutCounts[i]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* linha 2: progresso por tipo + pendências */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* progresso por tipo */}
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 16 }}>
            {p.activityProgress}
          </div>
          {groups.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{p.noTasksOverview}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {groups.map(([prefix, { total, completed }]) => {
                const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                return (
                  <div key={prefix} style={{ display: "grid", gridTemplateColumns: "140px 1fr 40px", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={prefix}>
                      {prefix}
                    </span>
                    <div style={{ height: 7, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden", border: "0.5px solid var(--border)" }}>
                      <div style={{ height: "100%", borderRadius: 4, background: pct === 100 ? "var(--success)" : pct > 0 ? "var(--warning)" : "var(--orange)", width: `${pct}%` }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, textAlign: "right", color: pct === 100 ? "var(--success)" : "var(--text-muted)" }}>
                      {pct}%
                    </span>
                  </div>
                );
              })}
              {groups.length === 6 && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{p.top6}</div>
              )}
            </div>
          )}
        </div>

        {/* pendências em destaque */}
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 16 }}>
            {p.pendingHighlight}
          </div>
          {highlightPending.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--success)" }}>{p.allDone}</div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {highlightPending.map((task) => (
                  <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "0.5px solid var(--border)" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)", flexShrink: 0, display: "inline-block" }} />
                    <span style={{ flex: 1, fontSize: 13, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.task_name}</span>
                    <StatusBadge status={task.status} label={task.status_display} />
                  </div>
                ))}
              </div>
              {pendingTasks.length > 4 && (
                <div style={{ marginTop: 10, fontSize: 12, textAlign: "right" }}>
                  <span style={{ color: "var(--text-muted)" }}>{p.morePending(pendingTasks.length - 4)}</span>
                  <button
                    onClick={onGoToTasks}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--orange)", fontWeight: 700, fontSize: 12, padding: 0 }}
                  >
                    {p.seeAllTasks}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* descrição colapsável */}
      {project.description && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <button
            onClick={() => setDescriptionOpen(!descriptionOpen)}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
          >
            <Icon name={descriptionOpen ? "expand_less" : "expand_more"} style={{ fontSize: 18, color: "var(--text-faint)" }} />
            <Icon name="description" style={{ fontSize: 15, color: "var(--orange)" }} />
            <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--orange)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{p.description}</span>
          </button>
          {descriptionOpen && (
            <div style={{ padding: "0 16px 16px", fontSize: 13.5, color: "var(--text)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {project.description}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function OverviewPanel({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Icon name={icon} style={{ fontSize: 17, color: "var(--orange)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--orange)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function PanelField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="info-box-label">{label}</div>
      <div className="info-box-value">{value}</div>
    </div>
  );
}

function SidebarField({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: warn ? "var(--warning)" : "var(--text)" }}>{value}</div>
    </div>
  );
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(locale);
}
