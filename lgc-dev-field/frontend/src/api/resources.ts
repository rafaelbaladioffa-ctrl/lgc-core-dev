import { apiClient } from "./client";
import type {
  Activity,
  AuditLogEntry,
  CableAlias,
  CableFamily,
  CableSpec,
  CertificationType,
  Category,
  ClientFull,
  Collaborator,
  CollaboratorFull,
  CollaboratorHours,
  Company,
  DailyUpdate,
  DeviceType,
  JobTitle,
  Location,
  Me,
  MasterDataSite,
  Network,
  Notification,
  OperationsBoard,
  IndicatorsTrends,
  TrendBreakdown,
  TrendDimension,
  TrendProduction,
  BlockTimes,
  ManagementGroup,
  ManagementReport,
  OperationsReports,
  OperationsTimeline,
  Paginated,
  Path,
  Project,
  ProjectAttachment,
  ProjectDailyUpdate,
  ProjectOccurrence,
  ProjectPlan,
  ProjectPlanCreateResult,
  ProjectsPerformanceData,
  ProjectTask,
  ProjectTaskBulkPayload,
  ProjectTaskCreatePayload,
  ProjectType,
  ConsultimerProjectType,
  RackPosition,
  ResponsibleFull,
  SitesPanelData,
  TechnicalPerformanceData,
  TechnicianPresence,
  UserOption,
  Region,
  SiteFull,
  SiteMapData,
  GeneratedTask,
  GeneratedTaskDependency,
  AiStatus,
  AiTestResult,
  ScopeItem,
  ScopeItemGenerateTasksResult,
  ScopeItemResolutionResult,
  SowApproveItemResult,
  SowApproveSelectedResult,
  SowImport,
  SowParsedItem,
  SowRejectSelectedResult,
  TaskFull,
  TaskTemplate,
  TaskTemplateRule,
  TaskTemplateRuleSimulateRequest,
  TaskTemplateRuleSimulateResult,
  TaskTemplateStep,
  TechnicianAbsence,
  Workstream,
  BotBroadcastRule,
  BotBroadcastRuleOptions,
  BotGroup,
  BotSubscriber,
  BotMessageTemplate,
  CableWizardOptions,
  CableWizardPreview,
  CableWizardRequest,
  CableWizardResult,
} from "./types";

function crud<T extends { id: number }>(basePath: string) {
  return {
    list: (params?: Record<string, string>) =>
      apiClient.get<Paginated<T>>(`${basePath}/`, { params }).then((r) => r.data),
    get: (id: number) => apiClient.get<T>(`${basePath}/${id}/`).then((r) => r.data),
    create: (payload: Partial<T>) => apiClient.post<T>(`${basePath}/`, payload).then((r) => r.data),
    update: (id: number, payload: Partial<T>) => apiClient.patch<T>(`${basePath}/${id}/`, payload).then((r) => r.data),
    remove: (id: number) => apiClient.delete(`${basePath}/${id}/`),
    exportCsv: () => apiClient.get<Blob>(`${basePath}/export-csv/`, { responseType: "blob" }).then((r) => r.data),
    importCsv: (file: File) => {
      const form = new FormData();
      form.append("csv_file", file);
      return apiClient
        .post<{ created: number; errors: string[] }>(`${basePath}/import-csv/`, form, {
          headers: { "Content-Type": "multipart/form-data" },
        })
        .then((r) => r.data);
    },
  };
}

export const registryApi = {
  companies: crud<Company>("/registry/companies"),
  categories: crud<Category>("/registry/categories"),
  projectTypes: crud<ProjectType>("/registry/project-types"),
  consultimerProjectTypes: crud<ConsultimerProjectType>("/registry/consultimer-project-types"),
  jobTitles: crud<JobTitle>("/registry/job-titles"),
  sites: crud<SiteFull>("/registry/sites"),
  clients: crud<ClientFull>("/registry/clients"),
  responsibles: crud<ResponsibleFull>("/registry/responsibles"),
  collaborators: crud<CollaboratorFull>("/registry/collaborators"),
  tasks: crud<TaskFull>("/registry/tasks"),
};

export const cableWizardApi = {
  options: () => apiClient.get<CableWizardOptions>("/master-data/cable-wizard/options/").then((r) => r.data),
  preview: (payload: CableWizardRequest) =>
    apiClient.post<CableWizardPreview>("/master-data/cable-wizard/preview/", payload).then((r) => r.data),
  create: (payload: CableWizardRequest) =>
    apiClient.post<CableWizardResult>("/master-data/cable-wizard/", payload).then((r) => r.data),
};

export const masterDataApi = {
  cableFamilies: crud<CableFamily>("/master-data/cable-families"),
  cableAliases: crud<CableAlias>("/master-data/cable-aliases"),
  cableSpecs: crud<CableSpec>("/master-data/cable-specs"),
  certificationTypes: crud<CertificationType>("/master-data/certification-types"),
  activities: crud<Activity>("/master-data/activities"),
  networks: crud<Network>("/master-data/networks"),
  workstreams: crud<Workstream>("/master-data/workstreams"),
  paths: crud<Path>("/master-data/paths"),
  sites: crud<MasterDataSite>("/master-data/sites"),
  locations: crud<Location>("/master-data/locations"),
  deviceTypes: crud<DeviceType>("/master-data/device-types"),
  taskTemplates: crud<TaskTemplate>("/master-data/task-templates"),
  taskTemplateSteps: crud<TaskTemplateStep>("/master-data/task-template-steps"),
  taskTemplateRules: crud<TaskTemplateRule>("/master-data/task-template-rules"),
  scopeItems: {
    ...crud<ScopeItem>("/master-data/scope-items"),
    resolveTemplate: (id: number) =>
      apiClient
        .post<ScopeItemResolutionResult>(`/master-data/scope-items/${id}/resolve-template/`)
        .then((r) => r.data),
    resolveAll: (sourceReference?: string) =>
      apiClient
        .post<{ total: number; resolved: number; no_match: number; conflict: number }>(
          "/master-data/scope-items/resolve-all/",
          {},
          { params: sourceReference ? { source_reference: sourceReference } : undefined }
        )
        .then((r) => r.data),
    generateTasks: (id: number) =>
      apiClient
        .post<ScopeItemGenerateTasksResult>(`/master-data/scope-items/${id}/generate-tasks/`)
        .then((r) => r.data),
    generateTasksBulk: (sourceReference?: string) =>
      apiClient
        .post<{
          scope_items_processed: number;
          tasks_created: number;
          tasks_existing: number;
          dependencies_created: number;
          dependencies_existing: number;
          errors: { scope_item_code: string; detail: string }[];
        }>("/master-data/scope-items/generate-tasks-bulk/", sourceReference ? { source_reference: sourceReference } : {})
        .then((r) => r.data),
  },
  generatedTasks: crud<GeneratedTask>("/master-data/generated-tasks"),
  // Só leitura no backend (GeneratedTaskDependencyViewSet é
  // ReadOnlyModelViewSet) — usado para as seções Predecessoras/
  // Sucessoras de uma Tarefa Gerada.
  generatedTaskDependencies: {
    list: (params?: Record<string, string>) =>
      apiClient
        .get<Paginated<GeneratedTaskDependency>>("/master-data/generated-task-dependencies/", { params })
        .then((r) => r.data),
  },
};

export const planningApi = {
  sowImports: {
    ...crud<SowImport>("/planning/sow-imports"),
    // create() do crud<> genérico já lida com JSON; upload de arquivo
    // precisa de multipart (o backend aceita os dois, ver
    // SowImportViewSet.parser_classes).
    createWithFile: (payload: { title: string; source_type: string; source_text?: string; source_file?: File }) => {
      const form = new FormData();
      form.append("title", payload.title);
      form.append("source_type", payload.source_type);
      if (payload.source_text) form.append("source_text", payload.source_text);
      if (payload.source_file) form.append("source_file", payload.source_file);
      return apiClient
        .post<SowImport>("/planning/sow-imports/", form, { headers: { "Content-Type": "multipart/form-data" } })
        .then((r) => r.data);
    },
    items: (id: number) =>
      apiClient.get<SowParsedItem[]>(`/planning/sow-imports/${id}/items/`).then((r) => r.data),
    process: (id: number) => apiClient.post<SowImport>(`/planning/sow-imports/${id}/process/`).then((r) => r.data),
    reprocess: (id: number) => apiClient.post<SowImport>(`/planning/sow-imports/${id}/reprocess/`).then((r) => r.data),
    approveSelected: (id: number, itemIds: number[]) =>
      apiClient
        .post<SowApproveSelectedResult>(`/planning/sow-imports/${id}/approve-selected/`, { item_ids: itemIds })
        .then((r) => r.data),
    rejectSelected: (id: number, itemIds: number[]) =>
      apiClient
        .post<SowRejectSelectedResult>(`/planning/sow-imports/${id}/reject-selected/`, { item_ids: itemIds })
        .then((r) => r.data),
    finalize: (id: number) => apiClient.post<SowImport>(`/planning/sow-imports/${id}/finalize/`).then((r) => r.data),
    summary: (id: number) =>
      apiClient
        .get<{
          total_items_detected: number;
          total_items_approved: number;
          total_items_rejected: number;
          scope_items_created: number;
          templates_resolved: number;
          items_awaiting_resolution: number;
          tasks_generated: number;
        }>(`/planning/sow-imports/${id}/summary/`)
        .then((r) => r.data),
  },
  sowParsedItems: {
    ...crud<SowParsedItem>("/planning/sow-parsed-items"),
    approve: (id: number) =>
      apiClient.post<SowApproveItemResult>(`/planning/sow-parsed-items/${id}/approve/`).then((r) => r.data),
    reject: (id: number) =>
      apiClient.post<SowParsedItem>(`/planning/sow-parsed-items/${id}/reject/`).then((r) => r.data),
    reprocess: (id: number) =>
      apiClient.post<SowParsedItem>(`/planning/sow-parsed-items/${id}/reprocess/`).then((r) => r.data),
  },
  ai: {
    // Só reporta configuração (env vars) — nunca chama o provider.
    status: () => apiClient.get<AiStatus>("/planning/ai/status/").then((r) => r.data),
    // Executa 1 chamada mínima REAL ao provider configurado — usar com
    // moderação (plano gratuito). Resolve mesmo quando a IA falha (503
    // vira um AiTestResult com success:false, nunca uma exceção não
    // tratada) para a tela poder mostrar o motivo.
    test: () =>
      apiClient
        .post<AiTestResult>("/planning/ai/test/")
        .then((r) => r.data)
        .catch((err) => (err.response?.data as AiTestResult) || { success: false, detail: "Falha ao testar a IA." }),
  },
  // Planejamento > Plano do Projeto — consolida uma SOW (ou ScopeItems
  // avulsos) dentro de um Projeto e cria ProjectTask a partir das
  // GeneratedTask já resolvidas (ver ProjectPlanView/
  // ProjectPlanCreateTasksView e projects.services.
  // create_project_tasks_from_generated_tasks). Nunca chamado
  // automaticamente — sempre por ação explícita do usuário.
  projectPlan: {
    get: (projectId: number, opts: { sowImport?: string; scopeItemIds?: number[] }) =>
      apiClient
        .get<ProjectPlan>("/planning/project-plan/", {
          params: {
            project: String(projectId),
            ...(opts.sowImport ? { sow_import: opts.sowImport } : {}),
            ...(opts.scopeItemIds?.length ? { scope_item_ids: opts.scopeItemIds.join(",") } : {}),
          },
        })
        .then((r) => r.data),
    createTasks: (projectId: number, opts: { sowImport?: string; scopeItemIds?: number[] }) =>
      apiClient
        .post<ProjectPlanCreateResult>("/planning/project-plan/create-tasks/", {
          project: projectId,
          ...(opts.sowImport ? { sow_import: opts.sowImport } : {}),
          ...(opts.scopeItemIds?.length ? { scope_item_ids: opts.scopeItemIds } : {}),
        })
        .then((r) => r.data),
  },
};

export const taskRuleSimulatorApi = {
  simulate: (payload: TaskTemplateRuleSimulateRequest) =>
    apiClient
      .post<TaskTemplateRuleSimulateResult>("/master-data/task-template-rules/simulate/", payload)
      .then((r) => r.data),
};

export const auditLogApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<Paginated<AuditLogEntry>>("/audit-logs/", { params }).then((r) => r.data),
};

export const regionsApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<Paginated<Region>>("/regions/", { params: { page_size: "200", ...params } }).then((r) => r.data),
};

export const sitesMapApi = {
  mapData: () => apiClient.get<SiteMapData>("/registry/sites/map-data/").then((r) => r.data),
  regeocode: (id: number) => apiClient.post<SiteFull>(`/registry/sites/${id}/regeocode/`).then((r) => r.data),
  regeocodeBulk: (ids?: number[]) =>
    apiClient
      .post<{ updated: number; failed: number; skipped_manual: number }>("/registry/sites/regeocode-bulk/", ids ? { ids } : {})
      .then((r) => r.data),
};

export const technicianAbsencesApi = {
  list: (collaboratorId?: number) =>
    apiClient
      .get<Paginated<TechnicianAbsence>>("/technician-absences/", {
        params: collaboratorId ? { collaborator: String(collaboratorId) } : undefined,
      })
      .then((r) => r.data),
  create: (payload: { collaborator: number; date_from: string; date_to: string; reason?: string }) =>
    apiClient.post<TechnicianAbsence>("/technician-absences/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<Pick<TechnicianAbsence, "date_from" | "date_to" | "reason">>) =>
    apiClient.patch<TechnicianAbsence>(`/technician-absences/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => apiClient.delete(`/technician-absences/${id}/`),
};

export const bulkCreateApi = {
  projectTypes: (names: string[], extra: Record<string, unknown>) =>
    apiClient.post<{ created: number }>("/registry/project-types/bulk-create/", { names, ...extra }).then((r) => r.data),
  tasks: (names: string[], extra: Record<string, unknown>) =>
    apiClient.post<{ created: number }>("/registry/tasks/bulk-create/", { names, ...extra }).then((r) => r.data),
};

export interface Client {
  id: number;
  name: string;
  tax_id: string;
  email: string;
  phone: string;
}

export interface Site {
  id: number;
  name: string;
  code: string;
  city: string;
  state: string;
}

export const meApi = {
  get: () => apiClient.get<Me>("/me/").then((r) => r.data),
  changePassword: (old_password: string, new_password: string) =>
    apiClient.post<{ detail: string }>("/me/change-password/", { old_password, new_password }).then((r) => r.data),
};

export const passwordResetApi = {
  request: (email: string) =>
    apiClient.post<{ detail: string }>("/password-reset/request/", { email }).then((r) => r.data),
  confirm: (uid: string, token: string, new_password: string) =>
    apiClient.post<{ detail: string }>("/password-reset/confirm/", { uid, token, new_password }).then((r) => r.data),
};

export interface GlobalSearchResult {
  projects: { id: number; code: string; name: string; po: string; client: string; site: string }[];
  sites: { id: number; code: string; name: string; client: string; city: string }[];
  tasks: {
    id: number;
    task_name: string;
    project_id: number;
    project_name: string;
    project_code: string;
    status: string;
    status_display: string;
  }[];
}

export const searchApi = {
  search: (q: string) => apiClient.get<GlobalSearchResult>("/search/", { params: { q } }).then((r) => r.data),
};

export const projectsApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<Paginated<Project>>("/projects/", { params: { page_size: "500", ...params } }).then((r) => r.data),
  get: (id: number) => apiClient.get<Project>(`/projects/${id}/`).then((r) => r.data),
  create: (payload: Partial<Project>) => apiClient.post<Project>("/projects/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<Project>) =>
    apiClient.patch<Project>(`/projects/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => apiClient.delete(`/projects/${id}/`),
  tasks: (id: number) => apiClient.get<ProjectTask[]>(`/projects/${id}/tasks/`).then((r) => r.data),
  rackPositions: (id: number) => apiClient.get<RackPosition[]>(`/projects/${id}/rack-positions/`).then((r) => r.data),
  rackPositionsBulk: (id: number, text: string) =>
    apiClient
      .post<{ created: number; skipped: number }>(`/projects/${id}/rack-positions/bulk/`, { text })
      .then((r) => r.data),
  importTasks: (id: number) =>
    apiClient.post<{ created: number }>(`/projects/${id}/import-tasks/`).then((r) => r.data),
  tasksBulk: (id: number, payload: ProjectTaskBulkPayload) =>
    apiClient
      .post<{ updated?: number; created?: number; deleted?: number }>(`/projects/${id}/tasks/bulk/`, payload)
      .then((r) => r.data),
  createTasks: (id: number, payload: ProjectTaskCreatePayload) =>
    apiClient
      .post<{ created: number; skipped: number; tasks: ProjectTask[] }>(`/projects/${id}/tasks/create/`, payload)
      .then((r) => r.data),
  createCustomTasks: (id: number, names: string[]) =>
    apiClient
      .post<{ created: number; tasks: ProjectTask[] }>(`/projects/${id}/tasks/create-custom/`, { names })
      .then((r) => r.data),
  hoursByCollaborator: (id: number) =>
    apiClient.get<CollaboratorHours[]>(`/projects/${id}/hours-by-collaborator/`).then((r) => r.data),
};

export const rackPositionsApi = {
  list: (projectId: number) =>
    apiClient.get<Paginated<RackPosition>>("/rack-positions/", { params: { project: String(projectId) } }).then((r) => r.data),
  create: (payload: Partial<RackPosition>) =>
    apiClient.post<RackPosition>("/rack-positions/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<RackPosition>) =>
    apiClient.patch<RackPosition>(`/rack-positions/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => apiClient.delete(`/rack-positions/${id}/`),
};

export const projectTasksApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<Paginated<ProjectTask>>("/project-tasks/", { params: { page_size: "500", ...params } }).then((r) => r.data),
  create: (payload: Partial<ProjectTask>) => apiClient.post<ProjectTask>("/project-tasks/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<ProjectTask>) =>
    apiClient.patch<ProjectTask>(`/project-tasks/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => apiClient.delete(`/project-tasks/${id}/`),
};

export const notificationsApi = {
  list: () => apiClient.get<Paginated<Notification>>("/notifications/").then((r) => r.data),
  unreadCount: () => apiClient.get<{ count: number }>("/notifications/unread_count/").then((r) => r.data),
  markRead: (id: number) => apiClient.post<Notification>(`/notifications/${id}/mark-read/`).then((r) => r.data),
  markAllRead: () => apiClient.post("/notifications/mark-all-read/"),
};

export const projectOccurrencesApi = {
  list: (projectId: number) =>
    apiClient.get<Paginated<ProjectOccurrence>>("/project-occurrences/", { params: { project: String(projectId) } }).then((r) => r.data),
  create: (payload: Partial<ProjectOccurrence>) =>
    apiClient.post<ProjectOccurrence>("/project-occurrences/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<ProjectOccurrence>) =>
    apiClient.patch<ProjectOccurrence>(`/project-occurrences/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => apiClient.delete(`/project-occurrences/${id}/`),
};

export const projectAttachmentsApi = {
  list: (projectId: number) =>
    apiClient.get<Paginated<ProjectAttachment>>("/project-attachments/", { params: { project: String(projectId) } }).then((r) => r.data),
  upload: (projectId: number, file: File, description: string) => {
    const form = new FormData();
    form.append("project", String(projectId));
    form.append("file", file);
    if (description) form.append("description", description);
    return apiClient
      .post<ProjectAttachment>("/project-attachments/", form, { headers: { "Content-Type": "multipart/form-data" } })
      .then((r) => r.data);
  },
  remove: (id: number) => apiClient.delete(`/project-attachments/${id}/`),
  downloadUrl: (id: number) => `/project-attachments/${id}/download/`,
};

export const dashboardApi = {
  projects: (params?: Record<string, string>) =>
    apiClient.get<ProjectsPerformanceData>("/dashboard/projects/", { params }).then((r) => r.data),
  technical: (params?: Record<string, string>) =>
    apiClient.get<TechnicalPerformanceData>("/dashboard/technical/", { params }).then((r) => r.data),
  sites: (params?: Record<string, string>) =>
    apiClient.get<SitesPanelData>("/dashboard/sites/", { params }).then((r) => r.data),
};

export const clientsApi = {
  list: () => apiClient.get<Paginated<Client>>("/clients/", { params: { page_size: "500" } }).then((r) => r.data),
};

export const sitesApi = {
  list: () => apiClient.get<Paginated<Site>>("/sites/", { params: { page_size: "500" } }).then((r) => r.data),
};

export const collaboratorsApi = {
  list: (params?: Record<string, string>) =>
    // page_size alto: a API pagina de 25 em 25 e há mais técnicos que isso.
    apiClient.get<Paginated<Collaborator>>("/collaborators/", { params: { page_size: "500", ...params } }).then((r) => r.data),
};

export const dailyUpdatesApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<Paginated<DailyUpdate>>("/daily-updates/", { params }).then((r) => r.data),
  get: (id: number) => apiClient.get<DailyUpdate>(`/daily-updates/${id}/`).then((r) => r.data),
  create: (payload: Partial<DailyUpdate>) =>
    apiClient.post<DailyUpdate>("/daily-updates/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<DailyUpdate>) =>
    apiClient.put<DailyUpdate>(`/daily-updates/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => apiClient.delete(`/daily-updates/${id}/`),
  sendEmail: (id: number, language?: string) =>
    apiClient
      .post<{ sent: string[]; skipped: string[] }>(`/daily-updates/${id}/send-email/`, { language })
      .then((r) => r.data),
  pdfPath: (id: number) => `/daily-updates/${id}/pdf/`,
  consolidatedPdfPath: (date: string) => `/daily-updates/pdf-consolidado/?date=${date}`,
};

export const projectUpdatesApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<Paginated<ProjectDailyUpdate>>("/project-updates/", { params }).then((r) => r.data),
  get: (id: number) => apiClient.get<ProjectDailyUpdate>(`/project-updates/${id}/`).then((r) => r.data),
  create: (payload: { project: number; date: string; summary?: string }) =>
    apiClient.post<ProjectDailyUpdate>("/project-updates/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<ProjectDailyUpdate>) =>
    apiClient.patch<ProjectDailyUpdate>(`/project-updates/${id}/`, payload).then((r) => r.data),
  sendEmail: (id: number, payload?: { user_ids?: number[]; emails?: string[]; language?: string }) =>
    apiClient
      .post<{ sent: string[]; skipped: string[]; detail?: string }>(`/project-updates/${id}/send-email/`, payload || {})
      .then((r) => r.data),
  sendWeekly: (payload: {
    project_ids: number[];
    start: string;
    end: string;
    user_ids?: number[];
    emails?: string[];
    language?: string;
  }) =>
    apiClient
      .post<{ sent: string[]; skipped: string[]; projects: number }>("/project-updates/send-weekly/", payload)
      .then((r) => r.data),
  pdfPath: (id: number) => `/project-updates/${id}/pdf/`,
};

export const usersApi = {
  options: () => apiClient.get<UserOption[]>("/user-options/").then((r) => r.data),
};

export const myTasksApi = {
  // page_size alto: a tela mostra a lista inteira do técnico (filtrada em
  // abas por status no cliente), não um browse paginado — sem isso, tarefas
  // recém-despachadas sem planned_start caem nas últimas posições da
  // ordenação e ficam invisíveis por estarem numa "página 2" nunca pedida.
  list: () => apiClient.get<Paginated<ProjectTask>>("/my-tasks/", { params: { page_size: "500" } }).then((r) => r.data),
  update: (id: number, payload: Partial<ProjectTask>) =>
    apiClient.patch<ProjectTask>(`/my-tasks/${id}/`, payload).then((r) => r.data),
};

/** Apontamento por bloco do técnico (os intervalos são o único momento em que ele tem o celular). */
export const workBlockApi = {
  suggestion: () => apiClient.get<{ start: string; end: string }>("/my-tasks/block/suggestion/").then((r) => r.data),
  register: (payload: { start: string; end: string; tasks: { task_id: number; complete: boolean }[] }) =>
    apiClient.post("/my-tasks/block/", payload).then((r) => r.data),
};

export const presenceApi = {
  me: () => apiClient.get<TechnicianPresence>("/technician-presence/me/").then((r) => r.data),
  setStatus: (status: string) =>
    apiClient.post<TechnicianPresence>("/technician-presence/set-status/", { status }).then((r) => r.data),
};

export const operationsApi = {
  board: (siteId: number | string, date?: string) =>
    apiClient.get<OperationsBoard>("/operations/board/", { params: { site: String(siteId), ...(date ? { date } : {}) } }).then((r) => r.data),
  dispatch: (taskId: number, collaboratorIds: number[]) =>
    apiClient
      .post<ProjectTask>(`/project-tasks/${taskId}/dispatch/`, { collaborator_ids: collaboratorIds })
      .then((r) => r.data),
  dispatchBulk: (taskIds: number[], collaboratorIds: number[]) =>
    apiClient
      .post<{ dispatched: number; task_ids: number[] }>("/project-tasks/dispatch-bulk/", { task_ids: taskIds, collaborator_ids: collaboratorIds })
      .then((r) => r.data),
  undispatch: (taskId: number, collaboratorIds?: number[]) =>
    apiClient
      .post<ProjectTask>(`/project-tasks/${taskId}/undispatch/`, { collaborator_ids: collaboratorIds || [] })
      .then((r) => r.data),
  returnToPool: (taskId: number, collaboratorIds?: number[]) =>
    apiClient
      .post<ProjectTask>(`/project-tasks/${taskId}/return-to-pool/`, { collaborator_ids: collaboratorIds || [] })
      .then((r) => r.data),
  timeline: (siteId: number | string, date?: string) =>
    apiClient
      .get<OperationsTimeline>("/operations/timeline/", { params: { site: String(siteId), ...(date ? { date } : {}) } })
      .then((r) => r.data),
  reports: (siteId: number | string, dateFrom?: string, dateTo?: string) =>
    apiClient
      .get<OperationsReports>("/operations/reports/", {
        params: { site: String(siteId), ...(dateFrom ? { date_from: dateFrom } : {}), ...(dateTo ? { date_to: dateTo } : {}) },
      })
      .then((r) => r.data),
  blockTimes: (siteId: number | string, dateFrom: string, dateTo: string) =>
    apiClient
      .get<BlockTimes>("/operations/reports/block-times/", {
        params: { site: String(siteId), date_from: dateFrom, date_to: dateTo },
      })
      .then((r) => r.data),
  managementReport: (siteId: number | string, dateFrom: string, dateTo: string, group?: ManagementGroup) =>
    apiClient
      .get<ManagementReport>("/operations/reports/management/", {
        params: { site: String(siteId), date_from: dateFrom, date_to: dateTo, ...(group ? { group } : {}) },
      })
      .then((r) => r.data),
};

export const indicatorsApi = {
  trends: (params: { dateFrom: string; dateTo: string; group?: ManagementGroup; site?: string; client?: string; region?: string }) =>
    apiClient
      .get<IndicatorsTrends>("/indicators/trends/", {
        params: {
          date_from: params.dateFrom,
          date_to: params.dateTo,
          ...(params.group ? { group: params.group } : {}),
          ...(params.site ? { site: params.site } : {}),
          ...(params.client ? { client: params.client } : {}),
          ...(params.region ? { region: params.region } : {}),
        },
      })
      .then((r) => r.data),
};

export interface TrendQuery {
  dateFrom: string;
  dateTo: string;
  group?: ManagementGroup;
  site?: string;
  client?: string;
  region?: string;
}

function trendParams(q: TrendQuery) {
  return {
    date_from: q.dateFrom,
    date_to: q.dateTo,
    ...(q.group ? { group: q.group } : {}),
    ...(q.site ? { site: q.site } : {}),
    ...(q.client ? { client: q.client } : {}),
    ...(q.region ? { region: q.region } : {}),
  };
}

export const indicatorsExtraApi = {
  breakdown: (q: TrendQuery, dimension: TrendDimension) =>
    apiClient
      .get<TrendBreakdown>("/indicators/trends/breakdown/", { params: { ...trendParams(q), dimension } })
      .then((r) => r.data),
  production: (q: TrendQuery) =>
    apiClient.get<TrendProduction>("/indicators/trends/production/", { params: trendParams(q) }).then((r) => r.data),
};

export const botMessagesApi = {
  list: () => apiClient.get<BotMessageTemplate[]>("/bot/message-templates/").then((r) => r.data),
  update: (payload: BotMessageTemplate) =>
    apiClient.patch<BotMessageTemplate>("/bot/message-templates/", payload).then((r) => r.data),
  preview: (payload: BotMessageTemplate) =>
    apiClient.post<{ preview: string }>("/bot/message-templates/preview/", payload).then((r) => r.data),
  testMenu: (to: string) =>
    apiClient.post<{ detail: string }>("/bot/message-templates/test-menu/", { to }, { timeout: 70000 }).then((r) => r.data),
};

export const botSubscribersApi = {
  list: () => apiClient.get<BotSubscriber[]>("/bot/subscribers/").then((r) => r.data),
  create: (payload: BotSubscriber) => apiClient.post<BotSubscriber>("/bot/subscribers/", payload).then((r) => r.data),
  update: (id: number, payload: BotSubscriber) => apiClient.put<BotSubscriber>(`/bot/subscribers/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => apiClient.delete(`/bot/subscribers/${id}/`),
  groups: () => apiClient.get<BotGroup[]>("/bot/subscribers/groups/").then((r) => r.data),
};

export const botRulesApi = {
  list: () => apiClient.get<BotBroadcastRule[]>("/bot/broadcast-rules/").then((r) => r.data),
  options: () => apiClient.get<BotBroadcastRuleOptions>("/bot/broadcast-rules/options/").then((r) => r.data),
  create: (payload: BotBroadcastRule) => apiClient.post<BotBroadcastRule>("/bot/broadcast-rules/", payload).then((r) => r.data),
  update: (id: number, payload: BotBroadcastRule) =>
    apiClient.put<BotBroadcastRule>(`/bot/broadcast-rules/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => apiClient.delete(`/bot/broadcast-rules/${id}/`),
  test: (rule: BotBroadcastRule, to: string) =>
    apiClient.post<{ detail: string }>("/bot/broadcast-rules/test/", { to, rule }, { timeout: 130000 }).then((r) => r.data),
};

export interface AdjustmentTask {
  task_id: number;
  name: string;
  project_name: string;
  status: string;
  assignment_start: string | null;
  assignment_end: string | null;
  adjusted: boolean;
}

/** Ajustes administrativos da timeline (somente superusuário). */
export const adjustmentsApi = {
  tasks: (collaboratorId: number, date: string) =>
    apiClient
      .get<AdjustmentTask[]>("/operations/adjustments/tasks/", { params: { collaborator: collaboratorId, date } })
      .then((r) => r.data),
  execution: (payload: {
    collaborator_id: number;
    task_id: number;
    start: string;
    end: string;
    pauses: { start: string; end: string }[];
    reason: string;
  }) => apiClient.post("/operations/adjustments/execution/", payload).then((r) => r.data),
  statusEvents: (collaboratorId: number, date: string) =>
    apiClient
      .get<{ status: string; changed_at: string; adjusted: boolean }[]>("/operations/adjustments/status-events/", {
        params: { collaborator: collaboratorId, date },
      })
      .then((r) => r.data),
  saveStatusEvents: (payload: {
    collaborator_id: number;
    date: string;
    events: { status: string; changed_at: string }[];
    /** Horários originais dos registros excluídos: a barra some (não é o status anterior que se estende). */
    deleted?: string[];
    reason: string;
  }) => apiClient.post("/operations/adjustments/status-events/", payload).then((r) => r.data),
  removeExecution: (payload: { collaborator_id: number; task_id: number; reason: string }) =>
    apiClient.post("/operations/adjustments/execution/remove/", payload).then((r) => r.data),
  statusWindow: (payload: { collaborator_id: number; start: string; end: string; status: string; reason: string }) =>
    apiClient.post("/operations/adjustments/status-window/", payload).then((r) => r.data),
};
