import { masterDataApi } from "../../api/resources";
import type {
  Activity,
  CableAlias,
  CableFamily,
  CableSpec,
  CertificationType,
  DeviceType,
  Location,
  GeneratedTask,
  MasterDataSite,
  Network,
  Path,
  ScopeItem,
  TaskTemplate,
  TaskTemplateRule,
  TaskTemplateStep,
  Workstream,
} from "../../api/types";
import { modelPerms, PERMS } from "../../utils/permissions";
import type { EntityConfig, ReferenceData } from "../cadastros/registryConfig";

/** Espelha master_data.models.CableAlias.ALIAS_TYPE_SUGGESTIONS no backend —
 * não é um ENUM rígido (o campo é texto livre), só as opções mostradas no
 * filtro e como sugestão no formulário. */
const ALIAS_TYPE_SUGGESTIONS = ["NAME_VARIATION", "PART_NUMBER", "LEGACY_NAME", "SOW_TERM", "INTERNAL_TERM"];

/** Espelha master_data.models.Activity.CATEGORY_SUGGESTIONS/
 * EXECUTION_TYPE_SUGGESTIONS no backend — não é ENUM rígido, só as opções
 * mostradas no filtro e como sugestão no formulário. */
const ACTIVITY_CATEGORY_SUGGESTIONS = [
  "PREPARATION",
  "INSTALLATION",
  "ORGANIZATION",
  "TERMINATION",
  "CERTIFICATION",
  "QUALITY",
  "DOCUMENTATION",
  "SITE",
  "CLOSURE",
];
const ACTIVITY_EXECUTION_TYPE_SUGGESTIONS = ["MANUAL", "TEST", "DOCUMENTATION", "INSPECTION", "SERVICE"];

/** Espelha master_data.models.Network.DOMAIN_SUGGESTIONS/MEDIUM_SUGGESTIONS
 * no backend — não é ENUM rígido, só as opções mostradas no filtro e como
 * sugestão no formulário. */
const NETWORK_DOMAIN_SUGGESTIONS = ["CORPORATE", "CONSOLE", "MANAGEMENT", "WAP"];
const NETWORK_MEDIUM_SUGGESTIONS = ["FIBER", "COPPER"];

/** Espelha master_data.models.Workstream.CATEGORY_SUGGESTIONS/
 * DEFAULT_MEDIUM_SUGGESTIONS no backend — não é ENUM rígido, só as opções
 * mostradas no filtro e como sugestão no formulário. */
const WORKSTREAM_CATEGORY_SUGGESTIONS = ["CABLING", "HARDWARE", "WIRELESS", "SERVICE", "CLOSURE"];
const WORKSTREAM_DEFAULT_MEDIUM_SUGGESTIONS = ["FIBER", "COPPER", "MIXED", "GENERAL"];

/** Espelha master_data.models.Path.PATH_GROUP_SUGGESTIONS/
 * PATH_TYPE_SUGGESTIONS no backend — não é ENUM rígido, só as opções
 * mostradas no filtro e como sugestão no formulário. */
const PATH_GROUP_SUGGESTIONS = ["REDUNDANT_PATH", "INTERNAL", "CROSS_CONNECTION", "DUCT", "UNSPECIFIED"];
const PATH_TYPE_SUGGESTIONS = ["A", "B", "INTER_RACK", "CROSS_CONNECT", "DIRECT", "UNSPECIFIED"];

/** Espelha master_data.models.Site.SITE_TYPE_SUGGESTIONS no backend — não
 * é ENUM rígido, só as opções mostradas no filtro e como sugestão no
 * formulário. */
const SITE_TYPE_SUGGESTIONS = ["DATACENTER", "OPTDC", "OTHER"];

/** Espelha master_data.models.Location.LOCATION_TYPE_SUGGESTIONS no
 * backend — não é ENUM rígido, só as opções mostradas no filtro e como
 * sugestão no formulário. */
const LOCATION_TYPE_SUGGESTIONS = ["RACK_POSITION", "IDF", "MR", "ROW", "ROOM", "PATCH_POINT", "OTHER"];

/** Espelha master_data.models.DeviceType.CATEGORY_SUGGESTIONS/
 * DEFAULT_MEDIUM_SUGGESTIONS no backend — não é ENUM rígido, só as opções
 * mostradas no filtro e como sugestão no formulário. */
const DEVICE_TYPE_CATEGORY_SUGGESTIONS = ["RACK", "SWITCH", "NETWORK_DEVICE", "PATCHING", "WIRELESS", "INFRASTRUCTURE", "OTHER"];
const DEVICE_TYPE_DEFAULT_MEDIUM_SUGGESTIONS = ["FIBER", "COPPER", "MIXED", "GENERAL"];

/** Espelha master_data.models.TaskTemplate.CATEGORY_SUGGESTIONS/
 * MEDIUM_SUGGESTIONS no backend — não é ENUM rígido, só as opções
 * mostradas no filtro e como sugestão no formulário. */
const TASK_TEMPLATE_CATEGORY_SUGGESTIONS = ["CABLING", "HARDWARE", "WIRELESS", "SERVICE", "CLOSURE"];
const TASK_TEMPLATE_MEDIUM_SUGGESTIONS = ["FIBER", "COPPER", "MIXED", "GENERAL"];

/** Espelha master_data.models.TaskTemplateStep.QUANTITY_SOURCE_SUGGESTIONS
 * no backend — não é ENUM rígido (o seed real usa até um valor fora dessa
 * lista, CONNECTION_COUNT, para CAB-CRIMP), só sugestões no formulário. */
const QUANTITY_SOURCE_SUGGESTIONS = ["SCOPE_ITEM", "CABLE_COUNT", "LINK_COUNT", "METERAGE", "PROJECT", "MANUAL", "NONE"];

function cableFamilyOptions(refs: ReferenceData) {
  return refs.cableFamilies.map((f) => ({ value: f.id, label: `${f.code} — ${f.name}` }));
}

function masterDataSiteOptions(refs: ReferenceData) {
  return refs.masterDataSites.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }));
}

function taskTemplateOptions(refs: ReferenceData) {
  return refs.taskTemplates.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }));
}

function activityOptions(refs: ReferenceData) {
  return refs.activities.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));
}

function cableSpecOptions(refs: ReferenceData) {
  return refs.cableSpecs.map((s) => ({ value: s.id, label: `${s.code} — ${s.part_number || s.name}` }));
}

function networkOptions(refs: ReferenceData) {
  return refs.networks.map((n) => ({ value: n.id, label: `${n.code} — ${n.name}` }));
}

function workstreamOptions(refs: ReferenceData) {
  return refs.workstreams.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }));
}

function pathOptions(refs: ReferenceData) {
  return refs.paths.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }));
}

/** Espelha master_data.models.ScopeItem.ITEM_TYPE_SUGGESTIONS/
 * LENGTH_TYPE_SUGGESTIONS/SOURCE_TYPE_SUGGESTIONS/
 * RULE_RESOLUTION_STATUS_SUGGESTIONS no backend — não é ENUM rígido, só
 * as opções mostradas no filtro e como sugestão no formulário. */
const SCOPE_ITEM_TYPE_SUGGESTIONS = ["CABLE", "HARDWARE", "SERVICE", "OTHER"];
const SCOPE_ITEM_LENGTH_TYPE_SUGGESTIONS = ["EXACT", "MAXIMUM", "MINIMUM", "RANGE", "UNKNOWN"];
const SCOPE_ITEM_SOURCE_TYPE_SUGGESTIONS = ["SOW", "CUTSHEET", "MANUAL", "AI", "IMPORT"];
const SCOPE_ITEM_RULE_RESOLUTION_STATUS_SUGGESTIONS = [
  "NOT_RESOLVED",
  "RESOLVED",
  "NO_MATCH",
  "CONFLICT",
  "REVIEW_REQUIRED",
];
const SCOPE_ITEM_RULE_RESOLUTION_STATUS_LABELS: Record<string, string> = {
  NOT_RESOLVED: "Não resolvido",
  RESOLVED: "Resolvido",
  NO_MATCH: "Sem match",
  CONFLICT: "Conflito",
  REVIEW_REQUIRED: "Exige revisão",
};

/** Cadastros Mestres: catálogo técnico/operacional normalizado (famílias
 * de cabo, futuramente conectores, certificações, dispositivos etc.) —
 * separado dos Cadastros Gerais (empresas, sites, colaboradores...),
 * pensado para alimentar automações futuras (geração de escopo/tarefas
 * por IA a partir de um SOW). Reaproveita o mesmo `EntityConfig` e o
 * mesmo `EntityCrudPanel` dos Cadastros Gerais — só muda o agrupamento
 * por categoria na navegação.
 *
 * Para adicionar um novo cadastro mestre no futuro: criar o model em
 * `backend/master_data`, o serializer/ViewSet em `api/` (mesmo padrão de
 * `CableFamilyViewSet`), registrar a rota em `api/urls.py` sob
 * `master-data/<algo>`, e adicionar um `EntityConfig` aqui, na categoria
 * correta — nenhum componente de tela novo é necessário.
 */

/** Item de navegação de Cadastros Mestres que NÃO é um cadastro CRUD —
 * hoje só o Simulador de Regras (formulário + resultado, sem
 * listagem/edição). `kind: "tool"` é o único discriminador; um
 * `EntityConfig` normal nunca tem esse campo, então `isToolConfig()` (em
 * MasterDataPage.tsx) distingue os dois sem precisar tocar em nenhum
 * `EntityConfig` já existente. */
export interface ToolConfig {
  kind: "tool";
  key: string;
  label: string;
  icon: string;
  perms: { view: string };
}

export type MasterDataNavItem = EntityConfig<any> | ToolConfig;

export interface MasterDataCategory {
  key: string;
  label: string;
  icon: string;
  entities: MasterDataNavItem[];
}

/** "TRUNK" -> "Trunk" — só para exibição; o valor canônico (uppercase)
 * continua sendo o que é salvo e editado no formulário. */
function titleCase(value: string) {
  if (!value) return value;
  return value.charAt(0) + value.slice(1).toLowerCase();
}

/** "LC ↔ LC" quando os dois conectores são iguais, "MPO → LC" quando são
 * diferentes, "—" quando nenhum dos dois está preenchido. */
function connectorsDisplay(a: string, b: string) {
  if (!a && !b) return "—";
  if (a && b) return a === b ? `${a} ↔ ${b}` : `${a} → ${b}`;
  return a || b;
}

/** Opções de filtro derivadas dos valores já cadastrados (ex: part numbers,
 * tipos de fibra, polaridades) — não têm uma lista fixa como alias_type,
 * então em vez de inventar valores, o filtro só oferece o que já existe. */
function distinctOptions(rows: Record<string, unknown>[], key: string) {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = row[key];
    if (typeof value === "string" && value) seen.add(value);
  }
  return Array.from(seen)
    .sort()
    .map((value) => ({ value, label: value }));
}

/** Grupos de trabalho das famílias de cabo (apontamento por bloco) — espelha CableFamily.WORK_GROUP_CHOICES. */
export const CABLE_WORK_GROUPS = [
  { value: "COPPER_CAT6", label: "Cobre CAT6" },
  { value: "FIBER_2F", label: "Fibra 2F" },
  { value: "TRUNK_LC_SMALL", label: "Tronco LC pequeno (8F–18F)" },
  { value: "TRUNK_LC_LARGE", label: "Tronco LC grande (36F–72F)" },
  { value: "TRUNK_MPO", label: "Tronco MPO" },
  { value: "BREAKOUT", label: "Breakout MPO–4×LC" },
  { value: "AOC", label: "AOC 100G" },
];

function cableWorkGroupLabel(value: string | null | undefined) {
  return CABLE_WORK_GROUPS.find((g) => g.value === value)?.label ?? "—";
}

const cableFamilyEntity: EntityConfig<CableFamily> = {
  key: "cable-families",
  label: "Famílias de Cabos",
  icon: "cable",
  singular: "Família de Cabo",
  description: "Catálogo padronizado de famílias de cabo (sem metragem) usado em escopos e tarefas.",
  createLabel: "Nova Família de Cabo",
  perms: modelPerms("master_data", "cablefamily"),
  api: masterDataApi.cableFamilies,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "medium", label: "Meio", render: (row) => (row.medium === "COPPER" ? "Cobre" : "Fibra") },
    { key: "fiber_count", label: "Fibras", render: (row) => (row.fiber_count == null ? "—" : String(row.fiber_count)) },
    { key: "connectors", label: "Conectores", render: (row) => connectorsDisplay(row.connector_a, row.connector_b) },
    { key: "cable_category", label: "Categoria", render: (row) => (row.cable_category ? titleCase(row.cable_category) : "—") },
    { key: "preterminated", label: "Pré-terminado", render: (row) => (row.preterminated ? "Sim" : "Não") },
    { key: "work_group", label: "Grupo de trabalho", render: (row) => cableWorkGroupLabel(row.work_group) },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: FIB-8F-LCLC" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: 8F LC-LC" },
    {
      name: "medium",
      label: "Meio",
      type: "select",
      required: true,
      options: [
        { value: "FIBER", label: "Fibra" },
        { value: "COPPER", label: "Cobre" },
      ],
    },
    { name: "fiber_count", label: "Nº de Fibras", type: "number" },
    { name: "connector_a", label: "Conector A", type: "text" },
    { name: "connector_b", label: "Conector B", type: "text" },
    { name: "cable_category", label: "Categoria do Cabo", type: "text", placeholder: "Ex: TRUNK, PATCH, BREAKOUT" },
    { name: "preterminated", label: "Pré-terminado", type: "checkbox", placeholder: "Sim" },
    {
      name: "work_group",
      label: "Grupo de trabalho",
      type: "select",
      options: [{ value: "", label: "Sem grupo" }, ...CABLE_WORK_GROUPS],
    },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: {
    code: "",
    name: "",
    medium: "FIBER",
    fiber_count: null,
    connector_a: "",
    connector_b: "",
    cable_category: "",
    work_group: "",
    preterminated: false,
    description: "",
    active: true,
  },
  rowLabel: (row) => `${row.code} — ${row.name}`,
  labels: {
    "en-US": { label: "Cable Families", singular: "Cable Family", description: "Standardized catalog of cable families (without metering) used in scopes and tasks.", createLabel: "New Cable Family" },
    "es-ES": { label: "Familias de Cables", singular: "Familia de Cable", description: "Catálogo normalizado de familias de cable (sin metraje) usado en alcances y tareas.", createLabel: "Nueva Familia de Cable" },
  },
};

const cableAliasEntity: EntityConfig<CableAlias> = {
  key: "cable-aliases",
  label: "Aliases de Cabos",
  icon: "alt_route",
  singular: "Alias de Cabo",
  description: "Formas alternativas de escrita (SOWs, cutsheets, documentos) que apontam para uma Família de Cabo canônica.",
  createLabel: "Novo Alias de Cabo",
  perms: modelPerms("master_data", "cablealias"),
  api: masterDataApi.cableAliases,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "alias", label: "Alias" },
    { key: "cable_family_name", label: "Família Canônica" },
    { key: "cable_family_code", label: "Código da Família" },
    { key: "alias_type", label: "Tipo", render: (row) => row.alias_type || "—" },
  ],
  filters: [
    { key: "cable_family", label: "Todas as Famílias", options: cableFamilyOptions },
    { key: "alias_type", label: "Todos os Tipos", options: () => ALIAS_TYPE_SUGGESTIONS.map((t) => ({ value: t, label: t })) },
  ],
  fields: (refs) => [
    { name: "cable_family", label: "Família de Cabo", type: "select", required: true, span: 2, options: cableFamilyOptions(refs) },
    { name: "alias", label: "Alias", type: "text", required: true, span: 2, placeholder: "Ex: 8F LC Trunk Fiber" },
    {
      name: "alias_type",
      label: "Tipo do Alias",
      type: "text",
      placeholder: "Ex: NAME_VARIATION, PART_NUMBER, LEGACY_NAME, SOW_TERM, INTERNAL_TERM",
    },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativo" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
  ],
  emptyValues: { cable_family: null, alias: "", alias_type: "", description: "", active: true },
  rowLabel: (row) => `${row.alias} → ${row.cable_family_code}`,
  labels: {
    "en-US": { label: "Cable Aliases", singular: "Cable Alias", description: "Alternative spellings (SOWs, cutsheets, documents) pointing to a canonical Cable Family.", createLabel: "New Cable Alias" },
    "es-ES": { label: "Alias de Cables", singular: "Alias de Cable", description: "Formas alternativas de escritura que apuntan a una Familia de Cable canónica.", createLabel: "Nuevo Alias de Cable" },
  },
};

const cableSpecEntity: EntityConfig<CableSpec> = {
  key: "cable-specs",
  label: "Especificações de Cabos",
  icon: "settings_ethernet",
  singular: "Especificação de Cabo",
  description: "Fabricante, part number e características físicas concretas de uma Família de Cabo canônica.",
  createLabel: "Nova Especificação de Cabo",
  perms: modelPerms("master_data", "cablespec"),
  api: masterDataApi.cableSpecs,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "cable_family_code", label: "Família" },
    { key: "part_number", label: "Part Number", render: (row) => row.part_number || "—" },
    { key: "fiber_type", label: "Tipo de Fibra", render: (row) => row.fiber_type || "—" },
    { key: "jacket_color", label: "Cor", render: (row) => (row.jacket_color ? titleCase(row.jacket_color) : "—") },
    { key: "polarity", label: "Polaridade", render: (row) => row.polarity || "—" },
    { key: "connectors", label: "Conectores", render: (row) => connectorsDisplay(row.connector_a, row.connector_b) },
    { key: "fiber_count", label: "Fibras", render: (row) => (row.fiber_count == null ? "—" : String(row.fiber_count)) },
  ],
  filters: [
    { key: "cable_family", label: "Todas as Famílias", options: cableFamilyOptions },
    { key: "part_number", label: "Todos os Part Numbers", options: (_refs, rows) => distinctOptions(rows, "part_number") },
    { key: "fiber_type", label: "Todos os Tipos de Fibra", options: (_refs, rows) => distinctOptions(rows, "fiber_type") },
    { key: "polarity", label: "Todas as Polaridades", options: (_refs, rows) => distinctOptions(rows, "polarity") },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: (refs) => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: SPEC-72F-MPOB-0072X6P64" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: 72F OS2 Yellow MPO/MPO MPO-B" },
    { name: "cable_family", label: "Família de Cabo", type: "select", required: true, span: 2, options: cableFamilyOptions(refs) },
    { name: "manufacturer", label: "Fabricante", type: "text" },
    { name: "part_number", label: "Part Number", type: "text" },
    { name: "fiber_type", label: "Tipo de Fibra", type: "text", placeholder: "Ex: OS2, OM3, OM4" },
    { name: "jacket_color", label: "Cor da Capa", type: "text", placeholder: "Ex: YELLOW" },
    { name: "polarity", label: "Polaridade", type: "text", placeholder: "Ex: A, B" },
    { name: "connector_a", label: "Conector A", type: "text" },
    { name: "connector_b", label: "Conector B", type: "text" },
    { name: "fiber_count", label: "Nº de Fibras", type: "number" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: {
    code: "",
    name: "",
    cable_family: null,
    manufacturer: "",
    part_number: "",
    fiber_type: "",
    jacket_color: "",
    polarity: "",
    connector_a: "",
    connector_b: "",
    fiber_count: null,
    description: "",
    active: true,
  },
  rowLabel: (row) => `${row.code} — ${row.name}`,
  labels: {
    "en-US": { label: "Cable Specs", singular: "Cable Spec", description: "Manufacturer, part number and physical characteristics of a canonical Cable Family.", createLabel: "New Cable Spec" },
    "es-ES": { label: "Especificaciones de Cables", singular: "Especificación de Cable", description: "Fabricante, número de parte y características físicas de una Familia de Cable canónica.", createLabel: "Nueva Especificación de Cable" },
  },
};

const certificationTypeEntity: EntityConfig<CertificationType> = {
  key: "certification-types",
  label: "Tipos de Certificação",
  icon: "verified",
  singular: "Tipo de Certificação",
  description: "Métodos de certificação/validação usados na operação (OTDR, cobre, QA/QC etc.).",
  createLabel: "Novo Tipo de Certificação",
  perms: modelPerms("master_data", "certificationtype"),
  api: masterDataApi.certificationTypes,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    {
      key: "medium",
      label: "Meio",
      render: (row) => (row.medium === "FIBER" ? "Fibra" : row.medium === "COPPER" ? "Cobre" : row.medium === "GENERAL" ? "Geral" : "—"),
    },
    { key: "method", label: "Método" },
    { key: "requires_report", label: "Exige Relatório", render: (row) => (row.requires_report ? "Sim" : "Não") },
    { key: "requires_attachment", label: "Exige Anexo", render: (row) => (row.requires_attachment ? "Sim" : "Não") },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: CERT-OTDR" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: Certificação OTDR" },
    {
      name: "medium",
      label: "Meio",
      type: "select",
      options: [
        { value: "FIBER", label: "Fibra" },
        { value: "COPPER", label: "Cobre" },
        { value: "GENERAL", label: "Geral" },
      ],
    },
    { name: "method", label: "Método", type: "text", required: true, placeholder: "Ex: OTDR, COPPER_CERTIFIER, QA_QC" },
    { name: "requires_report", label: "Exige Relatório", type: "checkbox", placeholder: "Sim" },
    { name: "requires_attachment", label: "Exige Anexo", type: "checkbox", placeholder: "Sim" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
  ],
  emptyValues: {
    code: "",
    name: "",
    medium: "",
    method: "",
    requires_report: false,
    requires_attachment: false,
    description: "",
    active: true,
  },
  rowLabel: (row) => `${row.code} — ${row.name}`,
  labels: {
    "en-US": { label: "Certification Types", singular: "Certification Type", description: "Certification/validation methods used in operations (OTDR, copper, QA/QC, etc.).", createLabel: "New Certification Type" },
    "es-ES": { label: "Tipos de Certificación", singular: "Tipo de Certificación", description: "Métodos de certificación/validación usados en la operación (OTDR, cobre, QA/QC, etc.).", createLabel: "Nuevo Tipo de Certificación" },
  },
};

const activityEntity: EntityConfig<Activity> = {
  key: "activities",
  label: "Atividades",
  icon: "checklist",
  singular: "Atividade",
  description: "Catálogo canônico de ações operacionais padronizadas executadas nos projetos.",
  createLabel: "Nova Atividade",
  perms: modelPerms("master_data", "activity"),
  api: masterDataApi.activities,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "category", label: "Categoria" },
    { key: "execution_type", label: "Tipo de Execução", render: (row) => row.execution_type || "—" },
    { key: "default_unit", label: "Unidade Padrão", render: (row) => row.default_unit || "—" },
    { key: "measurable", label: "Mensurável", render: (row) => (row.measurable ? "Sim" : "Não") },
    { key: "requires_evidence", label: "Exige Evidência", render: (row) => (row.requires_evidence ? "Sim" : "Não") },
  ],
  filters: [
    {
      key: "category",
      label: "Todas as Categorias",
      options: () => ACTIVITY_CATEGORY_SUGGESTIONS.map((c) => ({ value: c, label: c })),
    },
    {
      key: "execution_type",
      label: "Todos os Tipos de Execução",
      options: () => ACTIVITY_EXECUTION_TYPE_SUGGESTIONS.map((t) => ({ value: t, label: t })),
    },
    {
      key: "measurable",
      label: "Todas (Mensurável)",
      options: () => [
        { value: "true", label: "Mensurável" },
        { value: "false", label: "Não mensurável" },
      ],
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: CAB-RUN" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: Lançar cabeamento" },
    { name: "category", label: "Categoria", type: "text", required: true, placeholder: "Ex: PREPARATION, INSTALLATION, CERTIFICATION" },
    { name: "execution_type", label: "Tipo de Execução", type: "text", placeholder: "Ex: MANUAL, TEST, INSPECTION" },
    { name: "default_unit", label: "Unidade Padrão", type: "text", placeholder: "Ex: CABLE, METER, UNIT, HOUR, PROJECT" },
    { name: "measurable", label: "Mensurável", type: "checkbox", placeholder: "Sim" },
    { name: "requires_quantity", label: "Exige Quantidade", type: "checkbox", placeholder: "Sim" },
    { name: "requires_evidence", label: "Exige Evidência", type: "checkbox", placeholder: "Sim" },
    { name: "requires_certification", label: "Exige Certificação", type: "checkbox", placeholder: "Sim" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: {
    code: "",
    name: "",
    category: "",
    execution_type: "",
    default_unit: "",
    measurable: false,
    requires_quantity: false,
    requires_evidence: false,
    requires_certification: false,
    description: "",
    active: true,
  },
  rowLabel: (row) => `${row.code} — ${row.name}`,
  labels: {
    "en-US": { label: "Activities", singular: "Activity", description: "Canonical catalog of standardized operational actions performed in projects.", createLabel: "New Activity" },
    "es-ES": { label: "Actividades", singular: "Actividad", description: "Catálogo canónico de acciones operativas estandarizadas ejecutadas en los proyectos.", createLabel: "Nueva Actividad" },
  },
};

const networkEntity: EntityConfig<Network> = {
  key: "networks",
  label: "Redes",
  icon: "hub",
  singular: "Rede",
  description: "Função lógica/operacional da conexão (não o tipo físico do cabo, não a frente de execução do projeto).",
  createLabel: "Nova Rede",
  perms: modelPerms("master_data", "network"),
  api: masterDataApi.networks,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "domain", label: "Domínio" },
    { key: "medium", label: "Meio" },
  ],
  filters: [
    {
      key: "domain",
      label: "Todos os Domínios",
      options: () => NETWORK_DOMAIN_SUGGESTIONS.map((d) => ({ value: d, label: d })),
    },
    {
      key: "medium",
      label: "Todos os Meios",
      options: () => NETWORK_MEDIUM_SUGGESTIONS.map((m) => ({ value: m, label: m })),
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: MN_FIBER" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: Management Network Fiber" },
    { name: "domain", label: "Domínio", type: "text", required: true, placeholder: "Ex: CORPORATE, CONSOLE, MANAGEMENT, WAP" },
    { name: "medium", label: "Meio", type: "text", required: true, placeholder: "Ex: FIBER, COPPER" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: { code: "", name: "", domain: "", medium: "", description: "", active: true },
  rowLabel: (row) => `${row.code} — ${row.name}`,
  labels: {
    "en-US": { label: "Networks", singular: "Network", description: "Logical/operational function of the connection (not the physical cable type, not the project execution front).", createLabel: "New Network" },
    "es-ES": { label: "Redes", singular: "Red", description: "Función lógica/operacional de la conexión (no el tipo físico del cable, no el frente de ejecución del proyecto).", createLabel: "Nueva Red" },
  },
};

const workstreamEntity: EntityConfig<Workstream> = {
  key: "workstreams",
  label: "Workstreams",
  icon: "route",
  singular: "Workstream",
  description: "Frente operacional de execução — como o escopo é agrupado para planejamento, tarefas e acompanhamento.",
  createLabel: "Novo Workstream",
  perms: modelPerms("master_data", "workstream"),
  api: masterDataApi.workstreams,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "category", label: "Categoria" },
    { key: "default_medium", label: "Meio Padrão", render: (row) => row.default_medium || "—" },
  ],
  filters: [
    {
      key: "category",
      label: "Todas as Categorias",
      options: () => WORKSTREAM_CATEGORY_SUGGESTIONS.map((c) => ({ value: c, label: c })),
    },
    {
      key: "default_medium",
      label: "Todos os Meios Padrão",
      options: () => WORKSTREAM_DEFAULT_MEDIUM_SUGGESTIONS.map((m) => ({ value: m, label: m })),
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: WS-MGMT-FIBER" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: Management Fibers" },
    { name: "category", label: "Categoria", type: "text", required: true, placeholder: "Ex: CABLING, HARDWARE, WIRELESS, SERVICE, CLOSURE" },
    { name: "default_medium", label: "Meio Padrão", type: "text", placeholder: "Ex: FIBER, COPPER, MIXED, GENERAL" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: { code: "", name: "", category: "", default_medium: "", description: "", active: true },
  rowLabel: (row) => `${row.code} — ${row.name}`,
  labels: {
    "en-US": { label: "Workstreams", singular: "Workstream", description: "Operational execution front — how the scope is grouped for planning, tasks and tracking.", createLabel: "New Workstream" },
    "es-ES": { label: "Workstreams", singular: "Workstream", description: "Frente operacional de ejecución — cómo el alcance se agrupa para planificación, tareas y seguimiento.", createLabel: "Nuevo Workstream" },
  },
};

const pathEntity: EntityConfig<Path> = {
  key: "paths",
  label: "Rotas / Caminhos",
  icon: "alt_route",
  singular: "Rota/Caminho",
  description: "Tipo lógico/operacional de caminho usado na execução de cabeamento (ex: Path A, Path B, Cross Connection).",
  createLabel: "Nova Rota/Caminho",
  perms: modelPerms("master_data", "path"),
  api: masterDataApi.paths,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "path_group", label: "Grupo" },
    { key: "path_type", label: "Tipo" },
  ],
  filters: [
    {
      key: "path_group",
      label: "Todos os Grupos",
      options: () => PATH_GROUP_SUGGESTIONS.map((g) => ({ value: g, label: g })),
    },
    {
      key: "path_type",
      label: "Todos os Tipos",
      options: () => PATH_TYPE_SUGGESTIONS.map((t) => ({ value: t, label: t })),
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: PATH-A" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: Path A" },
    { name: "path_group", label: "Grupo", type: "text", required: true, placeholder: "Ex: REDUNDANT_PATH, INTERNAL, CROSS_CONNECTION, DUCT" },
    { name: "path_type", label: "Tipo", type: "text", required: true, placeholder: "Ex: A, B, INTER_RACK, CROSS_CONNECT, DIRECT" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: { code: "", name: "", path_group: "", path_type: "", description: "", active: true },
  rowLabel: (row) => `${row.code} — ${row.name}`,
  labels: {
    "en-US": { label: "Paths", singular: "Path", description: "Logical/operational path type used in cabling execution (e.g. Path A, Path B, Cross Connection).", createLabel: "New Path" },
    "es-ES": { label: "Rutas / Caminos", singular: "Ruta/Camino", description: "Tipo lógico/operacional de camino usado en la ejecución del cableado (ej: Path A, Path B, Cross Connection).", createLabel: "Nueva Ruta/Camino" },
  },
};

const masterDataSiteEntity: EntityConfig<MasterDataSite> = {
  key: "master-data-sites",
  label: "Sites",
  icon: "domain",
  singular: "Site",
  description: "Catálogo canônico de sites/datacenters — o nível mais alto da topologia física (ex: GRU65).",
  createLabel: "Novo Site",
  perms: modelPerms("master_data", "site"),
  api: masterDataApi.sites,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "city", label: "Cidade", render: (row) => row.city || "—" },
    { key: "state", label: "Estado", render: (row) => row.state || "—" },
    { key: "country", label: "País", render: (row) => row.country || "—" },
    { key: "site_type", label: "Tipo", render: (row) => row.site_type || "—" },
  ],
  filters: [
    {
      key: "country",
      label: "Todos os Países",
      options: (_refs, rows) => distinctOptions(rows, "country"),
    },
    {
      key: "state",
      label: "Todos os Estados",
      options: (_refs, rows) => distinctOptions(rows, "state"),
    },
    {
      key: "site_type",
      label: "Todos os Tipos",
      options: () => SITE_TYPE_SUGGESTIONS.map((t) => ({ value: t, label: t })),
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: GRU65" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: GRU65" },
    { name: "city", label: "Cidade", type: "text" },
    { name: "state", label: "Estado", type: "text" },
    { name: "country", label: "País", type: "text", placeholder: "Ex: BRAZIL" },
    { name: "site_type", label: "Tipo de Site", type: "text", placeholder: "Ex: DATACENTER, OPTDC, OTHER" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
  ],
  emptyValues: { code: "", name: "", city: "", state: "", country: "", site_type: "", description: "", active: true },
  rowLabel: (row) => `${row.code} — ${row.name}`,
  labels: {
    "en-US": { label: "Sites", singular: "Site", description: "Canonical catalog of sites/datacenters — the highest level of physical topology (e.g. GRU65).", createLabel: "New Site" },
    "es-ES": { label: "Sites", singular: "Site", description: "Catálogo canónico de sites/datacenters — el nivel más alto de la topología física (ej: GRU65).", createLabel: "Nuevo Site" },
  },
};

const locationEntity: EntityConfig<Location> = {
  key: "locations",
  label: "Localizações",
  icon: "my_location",
  singular: "Localização",
  description: "Localização física dentro de um Site (ex: GRU65.01-01-010-55) — só ONDE algo está, não o quê.",
  createLabel: "Nova Localização",
  perms: modelPerms("master_data", "location"),
  api: masterDataApi.locations,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "canonical_address", label: "Endereço" },
    { key: "site_code", label: "Site" },
    { key: "location_type", label: "Tipo", render: (row) => row.location_type || "—" },
    { key: "area", label: "Área", render: (row) => row.area || "—" },
    { key: "room", label: "Room", render: (row) => row.room || "—" },
    { key: "row", label: "Row", render: (row) => row.row || "—" },
    { key: "position", label: "Posição", render: (row) => row.position || "—" },
  ],
  filters: [
    {
      key: "site",
      label: "Todos os Sites",
      options: masterDataSiteOptions,
    },
    {
      key: "location_type",
      label: "Todos os Tipos",
      options: () => LOCATION_TYPE_SUGGESTIONS.map((t) => ({ value: t, label: t })),
    },
    {
      key: "room",
      label: "Todos os Rooms",
      options: (_refs, rows) => distinctOptions(rows, "room"),
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: (refs) => [
    { name: "site", label: "Site", type: "select", required: true, span: 2, options: masterDataSiteOptions(refs) },
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: LOC-GRU65-000001" },
    {
      name: "canonical_address",
      label: "Endereço Canônico",
      type: "text",
      required: true,
      span: 2,
      placeholder: "Ex: GRU65.01-01-010-55",
    },
    { name: "location_type", label: "Tipo de Localização", type: "text", placeholder: "Ex: RACK_POSITION, IDF, MR, ROW, ROOM, PATCH_POINT" },
    { name: "area", label: "Área", type: "text", placeholder: "Ex: ROOM1, MR, IDF" },
    { name: "room", label: "Room", type: "text", placeholder: "Ex: 01-01" },
    { name: "row", label: "Row", type: "text", placeholder: "Ex: 010" },
    { name: "rack", label: "Rack", type: "text" },
    { name: "position", label: "Posição", type: "text", placeholder: "Ex: 55" },
    { name: "ru", label: "RU", type: "text", placeholder: "Ex: RU45" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: {
    site: null,
    code: "",
    canonical_address: "",
    area: "",
    room: "",
    row: "",
    rack: "",
    position: "",
    ru: "",
    location_type: "",
    description: "",
    active: true,
  },
  rowLabel: (row) => `${row.code} — ${row.canonical_address}`,
  labels: {
    "en-US": { label: "Locations", singular: "Location", description: "Physical location inside a Site (e.g. GRU65.01-01-010-55) — only WHERE something is, not what.", createLabel: "New Location" },
    "es-ES": { label: "Ubicaciones", singular: "Ubicación", description: "Ubicación física dentro de un Site (ej: GRU65.01-01-010-55) — solo DÓNDE está algo, no qué es.", createLabel: "Nueva Ubicación" },
  },
};

const deviceTypeEntity: EntityConfig<DeviceType> = {
  key: "device-types",
  label: "Tipos de Dispositivos",
  icon: "router",
  singular: "Tipo de Dispositivo",
  description: "Catálogo canônico dos tipos de dispositivo/equipamento (ex: EUCLID_SPINE, MGMT_SWITCH) — não a instância física.",
  createLabel: "Novo Tipo de Dispositivo",
  perms: modelPerms("master_data", "devicetype"),
  api: masterDataApi.deviceTypes,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "category", label: "Categoria" },
    { key: "default_medium", label: "Meio Padrão", render: (row) => row.default_medium || "—" },
  ],
  filters: [
    {
      key: "category",
      label: "Todas as Categorias",
      options: () => DEVICE_TYPE_CATEGORY_SUGGESTIONS.map((c) => ({ value: c, label: c })),
    },
    {
      key: "default_medium",
      label: "Todos os Meios Padrão",
      options: () => DEVICE_TYPE_DEFAULT_MEDIUM_SUGGESTIONS.map((m) => ({ value: m, label: m })),
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: EUCLID_SPINE" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: Euclid Spine" },
    {
      name: "category",
      label: "Categoria",
      type: "text",
      required: true,
      placeholder: "Ex: RACK, SWITCH, NETWORK_DEVICE, PATCHING, WIRELESS, INFRASTRUCTURE",
    },
    { name: "default_medium", label: "Meio Padrão", type: "text", placeholder: "Ex: FIBER, COPPER, MIXED, GENERAL" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
  ],
  emptyValues: { code: "", name: "", category: "", default_medium: "", description: "", active: true },
  rowLabel: (row) => `${row.code} — ${row.name}`,
  labels: {
    "en-US": { label: "Device Types", singular: "Device Type", description: "Canonical catalog of device/equipment types (e.g. EUCLID_SPINE, MGMT_SWITCH) — not the physical instance.", createLabel: "New Device Type" },
    "es-ES": { label: "Tipos de Dispositivos", singular: "Tipo de Dispositivo", description: "Catálogo canónico de tipos de dispositivo/equipo (ej: EUCLID_SPINE, MGMT_SWITCH) — no la instancia física.", createLabel: "Nuevo Tipo de Dispositivo" },
  },
};

const taskTemplateEntity: EntityConfig<TaskTemplate> = {
  key: "task-templates",
  label: "Templates de Tarefas",
  icon: "assignment",
  singular: "Template de Tarefa",
  description: "Cabeçalho/classificação de uma receita de execução padronizada para um tipo de escopo (ex: Fibra Robust).",
  createLabel: "Novo Template de Tarefa",
  perms: modelPerms("master_data", "tasktemplate"),
  api: masterDataApi.taskTemplates,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "category", label: "Categoria" },
    { key: "medium", label: "Meio", render: (row) => row.medium || "—" },
  ],
  filters: [
    {
      key: "category",
      label: "Todas as Categorias",
      options: () => TASK_TEMPLATE_CATEGORY_SUGGESTIONS.map((c) => ({ value: c, label: c })),
    },
    {
      key: "medium",
      label: "Todos os Meios",
      options: () => TASK_TEMPLATE_MEDIUM_SUGGESTIONS.map((m) => ({ value: m, label: m })),
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: TPL-FIBER-ROBUST" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: Fibra Robust" },
    { name: "category", label: "Categoria", type: "text", required: true, placeholder: "Ex: CABLING, HARDWARE, WIRELESS, SERVICE, CLOSURE" },
    { name: "medium", label: "Meio", type: "text", placeholder: "Ex: FIBER, COPPER, MIXED, GENERAL" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
  ],
  emptyValues: { code: "", name: "", category: "", medium: "", description: "", active: true },
  rowLabel: (row) => `${row.code} — ${row.name}`,
  labels: {
    "en-US": { label: "Task Templates", singular: "Task Template", description: "Header/classification of a standardized execution recipe for a scope type (e.g. Fiber Robust).", createLabel: "New Task Template" },
    "es-ES": { label: "Plantillas de Tareas", singular: "Plantilla de Tarea", description: "Encabezado/clasificación de una receta de ejecución estandarizada para un tipo de alcance (ej: Fiber Robust).", createLabel: "Nueva Plantilla de Tarea" },
  },
};

const taskTemplateStepEntity: EntityConfig<TaskTemplateStep> = {
  key: "task-template-steps",
  label: "Etapas dos Templates",
  icon: "list_alt",
  singular: "Etapa de Template",
  description: "Uma atividade, em uma ordem, dentro da receita de um Template de Tarefa.",
  createLabel: "Nova Etapa de Template",
  perms: modelPerms("master_data", "tasktemplatestep"),
  api: masterDataApi.taskTemplateSteps,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "task_template_code", label: "Template" },
    { key: "step_order", label: "Ordem" },
    { key: "activity_code", label: "Atividade" },
    { key: "effective_name", label: "Nome da Etapa" },
    { key: "required", label: "Obrigatória", render: (row) => (row.required ? "Sim" : "Não") },
    { key: "repeatable", label: "Repetível", render: (row) => (row.repeatable ? "Sim" : "Não") },
    { key: "quantity_source", label: "Origem da Quantidade", render: (row) => row.quantity_source || "—" },
    { key: "unit_override", label: "Unidade", render: (row) => row.unit_override || "—" },
  ],
  filters: [
    {
      key: "task_template",
      label: "Todos os Templates",
      options: taskTemplateOptions,
    },
    {
      key: "activity",
      label: "Todas as Atividades",
      options: activityOptions,
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: (refs) => [
    { name: "task_template", label: "Template", type: "select", required: true, span: 2, options: taskTemplateOptions(refs) },
    { name: "activity", label: "Atividade", type: "select", required: true, span: 2, options: activityOptions(refs) },
    { name: "step_order", label: "Ordem", type: "number", required: true, placeholder: "Ex: 10, 20, 30..." },
    { name: "name_override", label: "Nome Personalizado", type: "text", placeholder: "Ex: Lançar fibra Route A/B" },
    { name: "required", label: "Obrigatória", type: "checkbox", placeholder: "Sim" },
    { name: "repeatable", label: "Repetível", type: "checkbox", placeholder: "Sim" },
    {
      name: "quantity_source",
      label: "Origem da Quantidade",
      type: "text",
      placeholder: `Ex: ${QUANTITY_SOURCE_SUGGESTIONS.join(", ")}`,
    },
    { name: "unit_override", label: "Unidade Sobrescrita", type: "text", placeholder: "Ex: METER" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: {
    task_template: null,
    activity: null,
    step_order: null,
    name_override: "",
    required: true,
    repeatable: false,
    quantity_source: "",
    unit_override: "",
    description: "",
    active: true,
  },
  rowLabel: (row) => `${row.task_template_code} #${row.step_order} — ${row.effective_name}`,
  labels: {
    "en-US": { label: "Template Steps", singular: "Template Step", description: "An activity, in an order, within a Task Template recipe.", createLabel: "New Template Step" },
    "es-ES": { label: "Pasos de Plantilla", singular: "Paso de Plantilla", description: "Una actividad, en un orden, dentro de la receta de una Plantilla de Tarea.", createLabel: "Nuevo Paso de Plantilla" },
  },
};

const taskTemplateRuleEntity: EntityConfig<TaskTemplateRule> = {
  key: "task-template-rules",
  label: "Regras de Templates",
  icon: "rule",
  singular: "Regra de Template",
  description: "Determina qual Template de Tarefa deve ser usado para um item de escopo — base do futuro motor de geração automática de tarefas.",
  createLabel: "Nova Regra de Template",
  perms: modelPerms("master_data", "tasktemplaterule"),
  api: masterDataApi.taskTemplateRules,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "task_template_code", label: "Template" },
    { key: "cable_family_code", label: "Família de Cabo", render: (row) => row.cable_family_code || "—" },
    { key: "cable_spec_code", label: "Especificação", render: (row) => row.cable_spec_code || "—" },
    { key: "network_code", label: "Rede", render: (row) => row.network_code || "—" },
    { key: "workstream_code", label: "Workstream", render: (row) => row.workstream_code || "—" },
    { key: "medium", label: "Meio", render: (row) => row.medium || "—" },
    {
      key: "preterminated",
      label: "Pré-terminado",
      render: (row) => (row.preterminated === true ? "Sim" : row.preterminated === false ? "Não" : "—"),
    },
    { key: "priority", label: "Prioridade" },
    { key: "specificity_score", label: "Especificidade" },
  ],
  filters: [
    { key: "task_template", label: "Todos os Templates", options: taskTemplateOptions },
    { key: "cable_family", label: "Todas as Famílias", options: cableFamilyOptions },
    { key: "network", label: "Todas as Redes", options: networkOptions },
    { key: "workstream", label: "Todos os Workstreams", options: workstreamOptions },
    { key: "medium", label: "Todos os Meios", options: (_refs, rows) => distinctOptions(rows, "medium") },
    {
      key: "preterminated",
      label: "Todos (Pré-terminado)",
      options: () => [
        { value: "true", label: "Sim" },
        { value: "false", label: "Não" },
      ],
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: (refs) => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: RULE-FIB-8F-LCLC" },
    {
      name: "name",
      label: "Nome",
      type: "text",
      required: true,
      span: 2,
      placeholder: "Ex: 8F LC-LC → Template Fiber Preterminated",
    },
    { name: "task_template", label: "Template", type: "select", required: true, span: 2, options: taskTemplateOptions(refs) },
    { name: "cable_family", label: "Família de Cabo", type: "select", options: cableFamilyOptions(refs) },
    { name: "cable_spec", label: "Especificação de Cabo", type: "select", options: cableSpecOptions(refs) },
    { name: "network", label: "Rede", type: "select", options: networkOptions(refs) },
    { name: "workstream", label: "Workstream", type: "select", options: workstreamOptions(refs) },
    { name: "medium", label: "Meio", type: "text", placeholder: "Ex: FIBER, COPPER, MIXED" },
    {
      name: "preterminated",
      label: "Pré-terminado",
      type: "select",
      placeholder: "Não considerar",
      options: [
        { value: "true", label: "Sim" },
        { value: "false", label: "Não" },
      ],
    },
    { name: "priority", label: "Prioridade", type: "number", required: true, placeholder: "Ex: 10, 100, 500" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: {
    code: "",
    name: "",
    task_template: null,
    cable_family: null,
    cable_spec: null,
    network: null,
    workstream: null,
    medium: "",
    preterminated: null,
    priority: 100,
    description: "",
    active: true,
  },
  rowLabel: (row) => `${row.code} — ${row.name}`,
  labels: {
    "en-US": { label: "Template Rules", singular: "Template Rule", description: "Determines which Task Template to use for a scope item — the base for the future automatic task generation engine.", createLabel: "New Template Rule" },
    "es-ES": { label: "Reglas de Plantilla", singular: "Regla de Plantilla", description: "Determina qué Plantilla de Tarea usar para un ítem de alcance — base del futuro motor de generación automática.", createLabel: "Nueva Regla de Plantilla" },
  },
};

/** Espelha ScopeItemCrudSerializer.get_operational_status no backend —
 * status derivado (não persistido) que resume onde o item está no fluxo
 * SOW -> ScopeItem -> resolução -> Tarefas Geradas. */
const SCOPE_ITEM_OPERATIONAL_STATUS_LABELS: Record<string, string> = {
  AWAITING_RESOLUTION: "Aguardando resolução",
  READY_TO_GENERATE: "Pronto para gerar",
  TASKS_GENERATED: "Tarefas geradas",
  REQUIRES_REVIEW: "Exige revisão",
  NO_MATCH: "Sem match",
};

const scopeItemEntity: EntityConfig<ScopeItem> = {
  key: "scope-items",
  label: "Itens de Escopo",
  icon: "inventory_2",
  singular: "Item de Escopo",
  description:
    "Item técnico extraído de um SOW/cutsheet/escopo — o que o escopo pede, base para a resolução automática do Template de Tarefa correto.",
  createLabel: "Novo Item de Escopo",
  perms: modelPerms("master_data", "scopeitem"),
  api: masterDataApi.scopeItems,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "item_type", label: "Tipo" },
    { key: "cable_family_code", label: "Família de Cabo", render: (row) => row.cable_family_code || "—" },
    { key: "cable_spec_code", label: "Spec", render: (row) => row.cable_spec_code || "—" },
    { key: "network_code", label: "Rede", render: (row) => row.network_code || "—" },
    { key: "workstream_code", label: "Workstream", render: (row) => row.workstream_code || "—" },
    { key: "path_code", label: "Rota", render: (row) => row.path_code || "—" },
    { key: "quantity", label: "Quantidade" },
    { key: "length_m", label: "Metragem", render: (row) => (row.length_m ? `${row.length_m}m` : "—") },
    { key: "medium", label: "Meio", render: (row) => row.medium || "—" },
    {
      key: "preterminated",
      label: "Pré-terminado",
      render: (row) => (row.preterminated === true ? "Sim" : row.preterminated === false ? "Não" : "—"),
    },
    {
      key: "rule_resolution_status",
      label: "Status da Regra",
      render: (row) => SCOPE_ITEM_RULE_RESOLUTION_STATUS_LABELS[row.rule_resolution_status] || row.rule_resolution_status,
    },
    { key: "resolved_template_code", label: "Template Resolvido", render: (row) => row.resolved_template_code || "—" },
    { key: "requires_review", label: "Revisão", render: (row) => (row.requires_review ? "Sim" : "Não") },
    { key: "source_type", label: "Origem", render: (row) => row.source_type || "—" },
    { key: "source_reference", label: "Referência da Origem", render: (row) => row.source_reference || "—" },
    {
      key: "operational_status",
      label: "Status Operacional",
      render: (row) => SCOPE_ITEM_OPERATIONAL_STATUS_LABELS[row.operational_status] || row.operational_status,
    },
  ],
  filters: [
    { key: "item_type", label: "Todos os Tipos", options: () => SCOPE_ITEM_TYPE_SUGGESTIONS.map((t) => ({ value: t, label: t })) },
    { key: "cable_family", label: "Todas as Famílias", options: cableFamilyOptions },
    { key: "network", label: "Todas as Redes", options: networkOptions },
    { key: "workstream", label: "Todos os Workstreams", options: workstreamOptions },
    { key: "path", label: "Todas as Rotas", options: pathOptions },
    { key: "medium", label: "Todos os Meios", options: (_refs, rows) => distinctOptions(rows, "medium") },
    { key: "source_reference", label: "Todas as Importações SOW", options: (_refs, rows) => distinctOptions(rows, "source_reference") },
    {
      key: "operational_status",
      label: "Todos os Status Operacionais",
      options: () =>
        Object.entries(SCOPE_ITEM_OPERATIONAL_STATUS_LABELS).map(([value, label]) => ({ value, label })),
    },
    {
      key: "rule_resolution_status",
      label: "Todos os Status de Regra",
      options: () =>
        SCOPE_ITEM_RULE_RESOLUTION_STATUS_SUGGESTIONS.map((s) => ({
          value: s,
          label: SCOPE_ITEM_RULE_RESOLUTION_STATUS_LABELS[s] || s,
        })),
    },
    {
      key: "requires_review",
      label: "Todos (Exige Revisão)",
      options: () => [
        { value: "true", label: "Sim" },
        { value: "false", label: "Não" },
      ],
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: (refs) => [
    { name: "item_type", label: "Tipo", type: "text", required: true, placeholder: "Ex: CABLE, HARDWARE, SERVICE, OTHER" },
    { name: "name", label: "Nome", type: "text", span: 2, placeholder: "Ex: 72F MPO-B — 50m — QTY 2 (opcional)" },
    { name: "cable_family", label: "Família de Cabo", type: "select", options: cableFamilyOptions(refs) },
    { name: "cable_spec", label: "Especificação de Cabo", type: "select", options: cableSpecOptions(refs) },
    { name: "network", label: "Rede", type: "select", options: networkOptions(refs) },
    { name: "workstream", label: "Workstream", type: "select", options: workstreamOptions(refs) },
    { name: "path", label: "Rota/Caminho", type: "select", options: pathOptions(refs) },
    {
      name: "expansion_mode",
      label: "Modo de Expansão",
      type: "select",
      options: [
        { value: "NONE", label: "Nenhum" },
        { value: "PATH", label: "Por Rota / Path" },
        { value: "MANUAL", label: "Manual" },
      ],
    },
    {
      name: "paths",
      label: "Rotas / Paths",
      type: "multiselect",
      span: 2,
      options: pathOptions(refs),
      visibleIf: (v) => v.expansion_mode === "PATH",
    },
    { name: "quantity", label: "Quantidade", type: "number", required: true },
    { name: "unit", label: "Unidade", type: "text", placeholder: "Ex: CABLE, LINK, UNIT, HOUR" },
    { name: "length_type", label: "Tipo de Metragem", type: "text", placeholder: "Ex: EXACT, MAXIMUM, MINIMUM, RANGE, UNKNOWN" },
    { name: "length_m", label: "Metragem (m)", type: "number", placeholder: "Ex: 50, 2.5" },
    { name: "medium", label: "Meio", type: "text", placeholder: "Ex: FIBER, COPPER" },
    {
      name: "preterminated",
      label: "Pré-terminado",
      type: "select",
      placeholder: "Não informado",
      options: [
        { value: "true", label: "Sim" },
        { value: "false", label: "Não" },
      ],
    },
    { name: "color", label: "Cor", type: "text", placeholder: "Ex: GREEN, ORANGE, YELLOW" },
    { name: "fiber_count", label: "Nº de Fibras", type: "number" },
    { name: "raw_text", label: "Texto Original", type: "textarea", required: true, span: 2 },
    { name: "source_type", label: "Tipo de Fonte", type: "text", placeholder: "Ex: SOW, CUTSHEET, MANUAL, AI, IMPORT" },
    { name: "source_reference", label: "Referência da Fonte", type: "text", placeholder: "Ex: documento, página, seção" },
    { name: "confidence_score", label: "Confiança (0 a 1)", type: "number", placeholder: "Ex: 0.97" },
    { name: "requires_review", label: "Exige Revisão", type: "checkbox", placeholder: "Sim" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
  ],
  emptyValues: {
    item_type: "CABLE",
    name: "",
    cable_family: null,
    cable_spec: null,
    network: null,
    workstream: null,
    path: null,
    expansion_mode: "NONE",
    paths: [],
    quantity: 1,
    unit: "",
    length_type: "",
    length_m: null,
    medium: "",
    preterminated: null,
    color: "",
    fiber_count: null,
    raw_text: "",
    source_type: "",
    source_reference: "",
    confidence_score: null,
    requires_review: false,
    description: "",
    active: true,
  },
  rowLabel: (row) => (row.name ? `${row.code} — ${row.name}` : row.code),
  labels: {
    "en-US": { label: "Scope Items", singular: "Scope Item", description: "Technical item extracted from a SOW/cutsheet/scope — what the scope requests, base for automatic Task Template resolution.", createLabel: "New Scope Item" },
    "es-ES": { label: "Ítems de Alcance", singular: "Ítem de Alcance", description: "Ítem técnico extraído de un SOW/cutsheet/alcance — lo que el alcance solicita, base para la resolución automática de Plantillas.", createLabel: "Nuevo Ítem de Alcance" },
  },
};

/** Espelha master_data.models.GeneratedTask.STATUS_SUGGESTIONS/
 * GENERATION_SOURCE_SUGGESTIONS no backend — não é ENUM rígido, só as
 * opções mostradas no filtro e como sugestão no formulário. */
const GENERATED_TASK_STATUS_SUGGESTIONS = [
  "PENDING",
  "READY",
  "IN_PROGRESS",
  "BLOCKED",
  "WAITING_QAQC",
  "COMPLETED",
  "CANCELLED",
];
const GENERATED_TASK_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendente",
  READY: "Pronta",
  IN_PROGRESS: "Em andamento",
  BLOCKED: "Bloqueada",
  WAITING_QAQC: "Aguardando QA/QC",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
};
const GENERATED_TASK_GENERATION_SOURCE_SUGGESTIONS = ["TEMPLATE", "MANUAL", "AI", "IMPORT"];

const generatedTaskEntity: EntityConfig<GeneratedTask> = {
  key: "generated-tasks",
  label: "Tarefas Geradas",
  icon: "checklist_rtl",
  singular: "Tarefa Gerada",
  description:
    "Tarefa operacional concreta gerada a partir de um Item de Escopo resolvido — o que a equipe precisa executar.",
  createLabel: "Nova Tarefa Gerada",
  perms: modelPerms("master_data", "generatedtask"),
  api: masterDataApi.generatedTasks,
  statusField: "active",
  disableHardDelete: true,
  // Só criada via "Gerar Tarefas" (Itens de Escopo resolvidos) — nunca
  // manualmente nem por CSV (bloqueado também no backend).
  disableCreate: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "scope_item_code", label: "Item de Escopo" },
    { key: "step_order", label: "Ordem" },
    { key: "activity_code", label: "Atividade" },
    { key: "name", label: "Tarefa" },
    { key: "path_code", label: "Path", render: (row) => row.path_code || "—" },
    { key: "expansion_key", label: "Expansion Key" },
    { key: "quantity", label: "Quantidade", render: (row) => (row.quantity == null ? "—" : String(row.quantity)) },
    { key: "unit", label: "Unidade", render: (row) => row.unit || "—" },
    { key: "task_template_code", label: "Template" },
    {
      key: "status",
      label: "Status",
      render: (row) => GENERATED_TASK_STATUS_LABELS[row.status] || row.status,
    },
    { key: "generation_source", label: "Origem" },
    {
      key: "scope_item_source_reference",
      label: "Importação SOW",
      render: (row) => row.scope_item_source_reference || "—",
    },
  ],
  filters: [
    { key: "scope_item_code", label: "Todos os Itens de Escopo", options: (_refs, rows) => distinctOptions(rows, "scope_item_code") },
    { key: "task_template_code", label: "Todos os Templates", options: (_refs, rows) => distinctOptions(rows, "task_template_code") },
    { key: "activity_code", label: "Todas as Atividades", options: (_refs, rows) => distinctOptions(rows, "activity_code") },
    { key: "path_code", label: "Todos os Paths", options: (_refs, rows) => distinctOptions(rows, "path_code") },
    {
      key: "scope_item_source_reference",
      label: "Todas as Importações SOW",
      options: (_refs, rows) => distinctOptions(rows, "scope_item_source_reference"),
    },
    {
      key: "status",
      label: "Todos os Status",
      options: () => GENERATED_TASK_STATUS_SUGGESTIONS.map((s) => ({ value: s, label: GENERATED_TASK_STATUS_LABELS[s] || s })),
    },
    {
      key: "generation_source",
      label: "Todas as Origens",
      options: () => GENERATED_TASK_GENERATION_SOURCE_SUGGESTIONS.map((s) => ({ value: s, label: s })),
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: () => [
    { name: "name", label: "Tarefa", type: "text", required: true, span: 2 },
    { name: "quantity", label: "Quantidade", type: "number" },
    { name: "unit", label: "Unidade", type: "text" },
    {
      name: "status",
      label: "Status",
      type: "text",
      placeholder: `Ex: ${GENERATED_TASK_STATUS_SUGGESTIONS.join(", ")}`,
    },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: {
    name: "",
    quantity: null,
    unit: "",
    status: "PENDING",
    description: "",
    active: true,
  },
  rowLabel: (row) => `${row.code} — ${row.name}`,
  labels: {
    "en-US": { label: "Generated Tasks", singular: "Generated Task", description: "Concrete operational task generated from a resolved Scope Item — what the team needs to execute.", createLabel: "New Generated Task" },
    "es-ES": { label: "Tareas Generadas", singular: "Tarea Generada", description: "Tarea operacional concreta generada a partir de un Ítem de Alcance resuelto — lo que el equipo debe ejecutar.", createLabel: "Nueva Tarea Generada" },
  },
};

const taskRuleSimulatorTool: ToolConfig = {
  kind: "tool",
  key: "task-rule-simulator",
  label: "Simulador de Regras",
  icon: "science",
  // Mesma permissão de visualização de Regras de Templates — o
  // simulador só executa a mesma action `simulate` do
  // TaskTemplateRuleViewSet, que já exige essa permissão no backend.
  perms: { view: PERMS.viewTaskTemplateRule },
};

const sowImportTool: ToolConfig = {
  kind: "tool",
  key: "sow-import",
  label: "Importar SOW",
  icon: "upload_file",
  perms: { view: PERMS.viewSowImport },
};

const cableWizardTool: ToolConfig = {
  kind: "tool",
  key: "cable-wizard",
  label: "Cadastro Guiado de Cabos",
  icon: "cable",
  // Grava família, aliases e especificações: exige a mesma permissão de leitura
  // do cadastro de Famílias de Cabo (as permissões de escrita são checadas no backend).
  perms: { view: modelPerms("master_data", "cablefamily").view },
};

const sowWizardTool: ToolConfig = {
  kind: "tool",
  key: "sow-wizard",
  label: "Fluxo Guiado",
  icon: "play_circle",
  perms: { view: PERMS.viewSowImport },
};

const projectPlanTool: ToolConfig = {
  kind: "tool",
  key: "project-plan",
  label: "Plano do Projeto",
  icon: "checklist",
  // Fecha o loop SOW -> ScopeItem -> GeneratedTask -> ProjectTask: lê os
  // mesmos dados de Itens de Escopo/Tarefas Geradas, por isso reaproveita
  // a mesma permissão de leitura do restante desta categoria.
  perms: { view: PERMS.viewGeneratedTask },
};

export const MASTER_DATA_CATEGORIES: MasterDataCategory[] = [
  {
    key: "engenharia",
    label: "Engenharia",
    icon: "cable",
    entities: [cableWizardTool, cableFamilyEntity, cableAliasEntity, cableSpecEntity, certificationTypeEntity],
  },
  {
    key: "operacao",
    label: "Operação",
    icon: "engineering",
    entities: [
      activityEntity,
      networkEntity,
      workstreamEntity,
      pathEntity,
      taskTemplateEntity,
      taskTemplateStepEntity,
      taskTemplateRuleEntity,
      taskRuleSimulatorTool,
    ],
  },
  {
    key: "infraestrutura",
    label: "Infraestrutura",
    icon: "lan",
    entities: [masterDataSiteEntity, locationEntity, deviceTypeEntity],
  },
  {
    key: "planejamento",
    label: "Planejamento",
    icon: "insights",
    entities: [sowWizardTool, scopeItemEntity, generatedTaskEntity, sowImportTool, projectPlanTool],
  },
];
