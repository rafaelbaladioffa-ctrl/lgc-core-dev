import { bulkCreateApi, registryApi } from "../../api/resources";
import type {
  Activity,
  CableFamily,
  CableSpec,
  Category,
  ClientFull,
  CollaboratorFull,
  Company,
  ConsultimerProjectType,
  JobTitle,
  MasterDataSite,
  Network,
  Paginated,
  Path,
  ProjectType,
  Region,
  ResponsibleFull,
  SiteFull,
  TaskFull,
  TaskTemplate,
  Workstream,
} from "../../api/types";
import type { FieldConfig, FieldOption, FormValues } from "../../components/ui/DynamicForm";
import { modelPerms, type ModelPerms } from "../../utils/permissions";

export interface ColumnConfig<T> {
  key: string;
  label: string;
  render?: (row: T) => string;
}

/** Filtro adicional (além da busca por texto) exibido como um <select> na
 * barra de filtros — ex: filtrar Aliases de Cabo por Família ou por Tipo.
 * Comparação sempre por igualdade de string contra `row[key]`. `options`
 * recebe as referências (ex: lista de Famílias) e as linhas já carregadas
 * da própria entidade — úteis quando as opções são derivadas dos dados
 * (ex: valores distintos de part_number/tipo de fibra já cadastrados, que
 * não têm uma lista fixa em ReferenceData). */
export interface FilterConfig {
  key: string;
  label: string;
  options: (refs: ReferenceData, rows: Record<string, unknown>[]) => FieldOption[];
}

/** Metadados de exibição de uma entidade por locale.
 * Se fornecido, sobrescreve label/singular/description/createLabel no idioma
 * selecionado; o campo raiz continua sendo o fallback em pt-BR. */
export interface EntityLabels {
  label: string;
  singular: string;
  description: string;
  createLabel: string;
}

export interface EntityConfig<T extends { id: number; is_active?: boolean }> {
  key: string;
  label: string;
  icon: string;
  singular: string;
  /** Frase curta para o card do catálogo, ex: "Cadastre e gerencie as empresas." */
  description: string;
  /** Traduções opcionais — sobrescreve label/singular/description/createLabel no locale selecionado. */
  labels?: Record<string, EntityLabels>;
  /** Codenames reais do Django (view/add/change/delete) para este model —
   * a UI só mostra o que o Grupo do usuário realmente permite. */
  perms: ModelPerms;
  api: {
    list: (params?: Record<string, string>) => Promise<Paginated<T>>;
    create: (payload: Partial<T>) => Promise<T>;
    update: (id: number, payload: Partial<T>) => Promise<T>;
    remove: (id: number) => Promise<unknown>;
    exportCsv: () => Promise<Blob>;
    importCsv: (file: File) => Promise<{ created: number; errors: string[] }>;
  };
  columns: ColumnConfig<T>[];
  fields: (refs: ReferenceData) => FieldConfig[];
  emptyValues: Partial<T>;
  rowLabel: (row: T) => string;
  createLabel: string;
  /** Nome do campo booleano "ativo" neste model — quase todo cadastro usa
   * "is_active" (padrão, pode omitir); Famílias de Cabo usa "active". */
  statusField?: string;
  /** Quando true, a ação de lixeira (exclusão física) é substituída por
   * Ativar/Inativar — para cadastros que não podem ser apagados de fato
   * uma vez persistidos (podem já ter sido usados em projetos/escopos). */
  disableHardDelete?: boolean;
  /** Quando true, esconde "Novo <entidade>", "Adicionar Vários" e
   * "Importar CSV" (a criação continua bloqueada no backend mesmo que o
   * usuário tenha permissão de add_<model> — ex: GeneratedTask só é
   * criada pelo service de geração, nunca manualmente). */
  disableCreate?: boolean;
  /** Filtros extras (além da busca por texto) exibidos como <select> na
   * barra de filtros — ex: por Família ou por Tipo de Alias. */
  filters?: FilterConfig[];
  /** Padrão "Adicionar Vários" do Admin: textarea com um nome por linha,
   * cada linha vira um registro separado com os mesmos dados complementares. */
  bulkCreate?: {
    label: string;
    helpText: string;
    extraFields: (refs: ReferenceData) => FieldConfig[];
    extraValues: (refs: ReferenceData) => FormValues;
    api: (names: string[], extra: FormValues) => Promise<{ created: number }>;
  };
}

export interface ReferenceData {
  companies: Company[];
  jobTitles: JobTitle[];
  sites: SiteFull[];
  clients: ClientFull[];
  projectTypes: ProjectType[];
  collaborators: CollaboratorFull[];
  regions: Region[];
  /** Só usado por Cadastros Mestres (ex: seletor de família em Aliases de
   * Cabo) — vazio para quem só usa Cadastros Gerais. */
  cableFamilies: CableFamily[];
  /** Só usado por Cadastros Mestres (ex: seletor de site em Localizações)
   * — vazio para quem só usa Cadastros Gerais. Não confundir com `sites`
   * acima (aquele é o Site do Cliente, Cadastros Gerais). */
  masterDataSites: MasterDataSite[];
  /** Só usado por Cadastros Mestres (seletores de Etapas de Template) —
   * vazio para quem só usa Cadastros Gerais. */
  activities: Activity[];
  taskTemplates: TaskTemplate[];
  /** Só usado por Cadastros Mestres (seletores de Regras de Templates e
   * Itens de Escopo) — vazio para quem só usa Cadastros Gerais. */
  cableSpecs: CableSpec[];
  networks: Network[];
  workstreams: Workstream[];
  paths: Path[];
}

function companyOptions(refs: ReferenceData) {
  return refs.companies.map((c) => ({ value: c.id, label: c.trade_name || c.legal_name }));
}

function clientOptions(refs: ReferenceData) {
  return refs.clients.map((c) => ({ value: c.id, label: c.trade_name || c.legal_name }));
}

/** Retorna os metadados de exibição de uma entidade no locale correto. */
export function entityLabels(entity: EntityConfig<any>, locale: string): EntityLabels {
  return entity.labels?.[locale] ?? {
    label: entity.label,
    singular: entity.singular,
    description: entity.description,
    createLabel: entity.createLabel,
  };
}

/** Cargo de gestão: Supervisor, Coordenador ou Gerente (sem diferenciar acento/caixa). */
function isManagementTitle(c: CollaboratorFull): boolean {
  const title = (c.job_title_name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /supervisor|coordenador|gerente/.test(title);
}

export const ENTITIES: EntityConfig<any>[] = [
  {
    key: "companies",
    label: "Empresas",
    icon: "apartment",
    singular: "Empresa",
    description: "Cadastre e gerencie as empresas.",
    createLabel: "Nova Empresa",
    perms: modelPerms("core", "company"),
    api: registryApi.companies,
    columns: [
      { key: "trade_name", label: "Nome Fantasia" },
      { key: "legal_name", label: "Razão Social" },
      { key: "tax_id", label: "CNPJ/CPF" },
      { key: "email", label: "E-mail" },
    ],
    fields: () => [
      { name: "trade_name", label: "Nome Fantasia", type: "text", required: true },
      { name: "legal_name", label: "Razão Social", type: "text", span: 2 },
      { name: "tax_id", label: "CNPJ/CPF", type: "text" },
      { name: "email", label: "E-mail", type: "email" },
      { name: "phone", label: "Telefone", type: "phone" },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
    ],
    emptyValues: { trade_name: "", legal_name: "", tax_id: "", email: "", phone: "", is_active: true },
    rowLabel: (row: Company) => row.trade_name || row.legal_name,
    labels: {
      "en-US": { label: "Companies", singular: "Company", description: "Register and manage companies.", createLabel: "New Company" },
      "es-ES": { label: "Empresas", singular: "Empresa", description: "Registra y gestiona las empresas.", createLabel: "Nueva Empresa" },
    },
  } as EntityConfig<Company>,
  {
    key: "clients",
    label: "Clientes",
    icon: "handshake",
    singular: "Cliente",
    description: "Cadastre e gerencie os clientes.",
    createLabel: "Novo Cliente",
    perms: modelPerms("core", "client"),
    api: registryApi.clients,
    columns: [
      { key: "number_code", label: "Nº" },
      { key: "trade_name", label: "Nome Fantasia" },
      { key: "company_name", label: "Empresa" },
      { key: "tax_id", label: "CNPJ/CPF" },
      { key: "city", label: "Cidade" },
    ],
    fields: (refs) => [
      { name: "number_code", label: "Nº do Cadastro", type: "text", readOnly: true, placeholder: "Gerado ao salvar" },
      { name: "trade_name", label: "Nome Fantasia", type: "text", required: true },
      { name: "legal_name", label: "Razão Social", type: "text", span: 2 },
      { name: "company", label: "Empresa", type: "select", required: true, options: companyOptions(refs) },
      {
        name: "person_type",
        label: "Tipo de Pessoa",
        type: "select",
        options: [
          { value: "company", label: "Pessoa jurídica" },
          { value: "person", label: "Pessoa física" },
        ],
      },
      { name: "tax_id", label: "CNPJ/CPF", type: "text" },
      { name: "email", label: "E-mail", type: "email" },
      { name: "phone", label: "Telefone", type: "phone" },
      { name: "city", label: "Cidade", type: "text" },
      { name: "state", label: "UF", type: "text" },
      { name: "address", label: "Endereço", type: "text", span: 2 },
      { name: "notes", label: "Observações", type: "textarea", span: 2 },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
    ],
    emptyValues: {
      trade_name: "", legal_name: "", company: null, person_type: "company", tax_id: "",
      email: "", phone: "", city: "", state: "", address: "", notes: "", is_active: true,
    },
    rowLabel: (row: ClientFull) => row.trade_name || row.legal_name,
    labels: {
      "en-US": { label: "Clients", singular: "Client", description: "Register and manage clients.", createLabel: "New Client" },
      "es-ES": { label: "Clientes", singular: "Cliente", description: "Registra y gestiona los clientes.", createLabel: "Nuevo Cliente" },
    },
  } as EntityConfig<ClientFull>,
  {
    key: "sites",
    label: "Sites",
    icon: "location_on",
    singular: "Site",
    description: "Cadastre e gerencie os sites.",
    createLabel: "Novo Site",
    perms: modelPerms("core", "site"),
    api: registryApi.sites,
    columns: [
      { key: "code", label: "Código" },
      { key: "name", label: "Nome" },
      { key: "client_name", label: "Cliente" },
      { key: "city", label: "Cidade" },
      { key: "region_name", label: "Regional" },
    ],
    fields: (refs) => [
      { name: "code", label: "Código", type: "text", required: true },
      { name: "name", label: "Nome", type: "text" },
      { name: "client", label: "Cliente", type: "select", required: true, options: clientOptions(refs) },
      {
        name: "region",
        label: "Regional",
        type: "select",
        options: refs.regions.map((r) => ({ value: r.id, label: `${r.country_display} · ${r.name}` })),
      },
      { name: "city", label: "Cidade", type: "text" },
      { name: "state", label: "UF", type: "text" },
      { name: "address", label: "Endereço", type: "text", span: 2 },
      {
        name: "manual_coordinates",
        label: "Coordenadas Manuais",
        type: "checkbox",
        placeholder: "Informar latitude/longitude manualmente (sem geocodificação automática)",
        span: 2,
      },
      { name: "latitude", label: "Latitude", type: "text" },
      { name: "longitude", label: "Longitude", type: "text" },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
    ],
    emptyValues: {
      code: "", name: "", client: null, region: null, city: "", state: "", address: "",
      manual_coordinates: false, latitude: null, longitude: null, is_active: true,
    },
    rowLabel: (row: SiteFull) => row.code || row.name,
    labels: {
      "en-US": { label: "Sites", singular: "Site", description: "Register and manage sites.", createLabel: "New Site" },
      "es-ES": { label: "Sites", singular: "Site", description: "Registra y gestiona los sites.", createLabel: "Nuevo Site" },
    },
  } as EntityConfig<SiteFull>,
  {
    key: "categories",
    label: "Categorias",
    icon: "sell",
    singular: "Categoria",
    description: "Cadastre e gerencie as categorias.",
    createLabel: "Nova Categoria",
    perms: modelPerms("core", "category"),
    api: registryApi.categories,
    columns: [
      { key: "name", label: "Nome" },
      { key: "description", label: "Descrição" },
    ],
    fields: () => [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "description", label: "Descrição", type: "textarea", span: 2 },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
    ],
    emptyValues: { name: "", description: "", is_active: true },
    rowLabel: (row: Category) => row.name,
    labels: {
      "en-US": { label: "Categories", singular: "Category", description: "Register and manage categories.", createLabel: "New Category" },
      "es-ES": { label: "Categorías", singular: "Categoría", description: "Registra y gestiona las categorías.", createLabel: "Nueva Categoría" },
    },
  } as EntityConfig<Category>,
  {
    key: "project-types",
    label: "Tipos de Projeto",
    icon: "category",
    singular: "Tipo de Projeto",
    description: "Cadastre e gerencie os tipos de projeto.",
    createLabel: "Novo Tipo de Projeto",
    perms: modelPerms("core", "projecttype"),
    api: registryApi.projectTypes,
    columns: [
      { key: "name", label: "Nome" },
      { key: "description", label: "Descrição" },
    ],
    fields: () => [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "description", label: "Descrição", type: "textarea", span: 2 },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
    ],
    emptyValues: { name: "", description: "", is_active: true },
    rowLabel: (row: ProjectType) => row.name,
    bulkCreate: {
      label: "Adicionar Vários",
      helpText: "Cada linha será cadastrada como um Tipo de Projeto separado, usando a mesma descrição.",
      extraFields: () => [
        { name: "description", label: "Descrição", type: "textarea", span: 2 },
        { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
      ],
      extraValues: () => ({ description: "", is_active: true }),
      api: bulkCreateApi.projectTypes,
    },
    labels: {
      "en-US": { label: "Project Types", singular: "Project Type", description: "Register and manage project types.", createLabel: "New Project Type" },
      "es-ES": { label: "Tipos de Proyecto", singular: "Tipo de Proyecto", description: "Registra y gestiona los tipos de proyecto.", createLabel: "Nuevo Tipo de Proyecto" },
    },
  } as EntityConfig<ProjectType>,
  {
    key: "consultimer-project-types",
    label: "Tipos de Projeto Consultimer",
    icon: "assignment",
    singular: "Tipo de Projeto Consultimer",
    description: "Cadastre as modalidades de projeto da Consultimer (ex: Deployment, Fitout).",
    createLabel: "Novo Tipo Consultimer",
    perms: modelPerms("core", "consultimerprojecttype"),
    api: registryApi.consultimerProjectTypes,
    columns: [
      { key: "name", label: "Nome" },
      { key: "code", label: "Sigla" },
      { key: "description", label: "Descrição" },
    ],
    fields: () => [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "code", label: "Sigla", type: "text", required: true },
      { name: "description", label: "Descrição", type: "textarea", span: 2 },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
    ],
    emptyValues: { name: "", code: "", description: "", is_active: true },
    rowLabel: (row: ConsultimerProjectType) => `${row.name} (${row.code})`,
    labels: {
      "en-US": { label: "Consultimer Project Types", singular: "Consultimer Project Type", description: "Register Consultimer project modalities (e.g. Deployment, Fitout).", createLabel: "New Consultimer Type" },
      "es-ES": { label: "Tipos de Proyecto Consultimer", singular: "Tipo de Proyecto Consultimer", description: "Registra las modalidades de proyecto de Consultimer (ej: Deployment, Fitout).", createLabel: "Nuevo Tipo Consultimer" },
    },
  } as EntityConfig<ConsultimerProjectType>,
  {
    key: "job-titles",
    label: "Cargos",
    icon: "badge",
    singular: "Cargo",
    description: "Cadastre e gerencie os cargos.",
    createLabel: "Novo Cargo",
    perms: modelPerms("core", "jobtitle"),
    api: registryApi.jobTitles,
    columns: [
      { key: "name", label: "Nome" },
      { key: "company_name", label: "Empresa" },
    ],
    fields: (refs) => [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "company", label: "Empresa", type: "select", required: true, options: companyOptions(refs) },
      { name: "description", label: "Descrição", type: "textarea", span: 2 },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
    ],
    emptyValues: { name: "", company: null, description: "", is_active: true },
    rowLabel: (row: JobTitle) => row.name,
    labels: {
      "en-US": { label: "Job Titles", singular: "Job Title", description: "Register and manage job titles.", createLabel: "New Job Title" },
      "es-ES": { label: "Cargos", singular: "Cargo", description: "Registra y gestiona los cargos.", createLabel: "Nuevo Cargo" },
    },
  } as EntityConfig<JobTitle>,
  {
    key: "collaborators",
    label: "Técnicos",
    icon: "groups",
    singular: "Técnico",
    description: "Cadastre e gerencie os técnicos.",
    createLabel: "Novo Técnico",
    perms: modelPerms("core", "collaborator"),
    api: registryApi.collaborators,
    columns: [
      { key: "name", label: "Nome" },
      { key: "registration", label: "Matrícula" },
      { key: "job_title_name", label: "Cargo" },
      { key: "company_name", label: "Empresa" },
    ],
    fields: (refs) => [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "company", label: "Empresa", type: "select", required: true, options: companyOptions(refs) },
      { name: "registration", label: "Matrícula", type: "text" },
      { name: "yellow_badge", label: "Yellow Badge", type: "text" },
      { name: "job_title", label: "Cargo", type: "select", options: refs.jobTitles.map((j) => ({ value: j.id, label: j.name })) },
      { name: "email", label: "E-mail", type: "email" },
      { name: "phone", label: "Telefone", type: "phone" },
      {
        name: "manager",
        label: "Gestor",
        type: "select",
        // Só quem tem cargo de gestão (Supervisor, Coordenador ou Gerente).
        options: refs.collaborators.filter(isManagementTitle).map((c) => ({ value: c.id, label: c.name })),
      },
      { name: "sites", label: "Sites", type: "multiselect", span: 2, options: refs.sites.map((s) => ({ value: s.id, label: s.code || s.name })) },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
    ],
    emptyValues: {
      name: "", company: null, registration: "", yellow_badge: "", job_title: null,
      email: "", phone: "", manager: null, sites: [], is_active: true,
    },
    rowLabel: (row: CollaboratorFull) => row.name,
    labels: {
      "en-US": { label: "Technicians", singular: "Technician", description: "Register and manage technicians.", createLabel: "New Technician" },
      "es-ES": { label: "Técnicos", singular: "Técnico", description: "Registra y gestiona los técnicos.", createLabel: "Nuevo Técnico" },
    },
  } as EntityConfig<CollaboratorFull>,
  {
    key: "responsibles",
    label: "Responsáveis",
    icon: "assignment_ind",
    singular: "Responsável",
    description: "Cadastre e gerencie os responsáveis — CSTR ou do Cliente.",
    createLabel: "Novo Responsável",
    perms: modelPerms("core", "responsible"),
    api: registryApi.responsibles,
    columns: [
      { key: "name", label: "Nome" },
      { key: "kind", label: "Tipo", render: (row: ResponsibleFull) => (row.kind === "client" ? "Cliente" : "CSTR") },
      {
        key: "company_name",
        label: "Empresa / Cliente",
        render: (row: ResponsibleFull) => (row.kind === "client" ? row.client_name || "—" : row.company_name || "—"),
      },
      { key: "email", label: "E-mail" },
    ],
    fields: (refs) => [
      {
        name: "kind",
        label: "Tipo",
        type: "select",
        required: true,
        span: 2,
        options: [
          { value: "cstr", label: "CSTR" },
          { value: "client", label: "Cliente" },
        ],
      },
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "email", label: "E-mail", type: "email" },
      { name: "phone", label: "Telefone", type: "phone" },
      {
        name: "company",
        label: "Empresa",
        type: "select",
        options: companyOptions(refs),
        visibleIf: (v) => v.kind !== "client",
      },
      {
        name: "client",
        label: "Cliente",
        type: "select",
        options: refs.clients.map((c) => ({ value: c.id, label: c.trade_name || c.legal_name })),
        visibleIf: (v) => v.kind === "client",
      },
      { name: "job_title", label: "Cargo", type: "text", visibleIf: (v) => v.kind === "client" },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
    ],
    emptyValues: { kind: "cstr", name: "", company: null, client: null, job_title: "", email: "", phone: "", is_active: true },
    rowLabel: (row: ResponsibleFull) => row.name,
    labels: {
      "en-US": { label: "Responsibles", singular: "Responsible", description: "Register and manage responsibles — CSTR or Client.", createLabel: "New Responsible" },
      "es-ES": { label: "Responsables", singular: "Responsable", description: "Registra y gestiona los responsables — CSTR o del Cliente.", createLabel: "Nuevo Responsable" },
    },
  } as EntityConfig<ResponsibleFull>,
  {
    key: "tasks",
    label: "Tarefas",
    icon: "task",
    singular: "Tarefa",
    description: "Cadastre e gerencie as tarefas.",
    createLabel: "Nova Tarefa",
    perms: modelPerms("core", "task"),
    api: registryApi.tasks,
    columns: [
      { key: "code", label: "Código" },
      { key: "name", label: "Nome" },
      { key: "estimated_hours", label: "Horas Estimadas" },
    ],
    fields: (refs) => [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "estimated_hours", label: "Horas Estimadas", type: "number" },
      {
        name: "project_types",
        label: "Tipos de Projeto",
        type: "multiselect",
        span: 2,
        options: refs.projectTypes.map((pt) => ({ value: pt.id, label: pt.name })),
      },
      { name: "description", label: "Descrição", type: "textarea", span: 2 },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
    ],
    emptyValues: { name: "", estimated_hours: null, project_types: [], description: "", is_active: true },
    rowLabel: (row: TaskFull) => row.name || row.code,
    bulkCreate: {
      label: "Adicionar Várias",
      helpText: "Cada linha será cadastrada como uma Tarefa separada, com código automático e os mesmos dados complementares.",
      extraFields: (refs) => [
        { name: "estimated_hours", label: "Horas Estimadas", type: "number" },
        {
          name: "project_types",
          label: "Tipos de Projeto",
          type: "multiselect",
          span: 2,
          options: refs.projectTypes.map((pt) => ({ value: pt.id, label: pt.name })),
        },
        { name: "description", label: "Descrição", type: "textarea", span: 2 },
        { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
      ],
      extraValues: () => ({ estimated_hours: null, project_types: [], description: "", is_active: true }),
      api: bulkCreateApi.tasks,
    },
    labels: {
      "en-US": { label: "Tasks", singular: "Task", description: "Register and manage tasks.", createLabel: "New Task" },
      "es-ES": { label: "Tareas", singular: "Tarea", description: "Registra y gestiona las tareas.", createLabel: "Nueva Tarea" },
    },
  } as EntityConfig<TaskFull>,
];
