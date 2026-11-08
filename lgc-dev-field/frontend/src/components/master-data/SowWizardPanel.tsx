import SearchSelect, { SearchMultiSelect } from "../ui/SearchSelect";
import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ProjectCombobox from "../ui/ProjectCombobox";
import { collaboratorsApi, masterDataApi, planningApi, projectsApi, projectTasksApi } from "../../api/resources";
import type { Collaborator, Project, ProjectTask, SowImport, SowParsedItem } from "../../api/types";
import type { ReferenceData } from "../../pages/cadastros/registryConfig";
import { usePageText } from "../../i18n";
import DateInput from "../ui/DateInput";
import FileInput from "../ui/FileInput";
import Icon from "../ui/Icon";

const PLANNING_STATUSES = ["planning", "not_started"];

const TEXT = {
  "pt-BR": {
    titulo: "Novo Escopo de Projeto",
    subtitulo: "Fluxo guiado: SOW → revisão → geração de tarefas → projeto",
    steps: ["Importar SOW", "Revisar Itens", "Resolver Templates", "Gerar Tarefas", "Enviar ao Projeto"],
    step1Desc: "Cole o texto do SOW ou envie um arquivo. O parser vai propor os Itens de Escopo na próxima etapa para você revisar.",
    tituloOpcional: "Título (opcional)",
    placeholderTitulo: "Ex: GRU65 — Fase 2 — SOW v3",
    tipoOrigem: "Tipo de origem",
    textoSow: "Texto do SOW",
    placeholderTexto: "Uma linha por item, ex:\n2x 72F OS2 Yellow MPO/MPO, MPO-B, 50m\n4x 2F robust fibers up to 60m\n10x CAT6 UTP up to 60m",
    ouEnvieArquivo: "Ou envie um arquivo",
    processando: "Processando…",
    processarSow: "Processar SOW",
    erroTextoOuArquivo: "Cole o texto do SOW ou envie um arquivo.",
    falhaProcessamento: "Falha no processamento",
    erroProcessar: "Não foi possível processar o SOW.",
    aprovados: (n: number) => `${n} aprovado(s)`,
    pendentes: (n: number) => `${n} pendente(s) de revisão`,
    de: "de",
    itensDetectados: "itens detectados",
    selecionarPendentes: "Selecionar pendentes",
    aprovarSelecionados: (n: number) => `Aprovar selecionados (${n})`,
    rejeitarSelecionados: (n: number) => `Rejeitar selecionados (${n})`,
    carregandoItens: "Carregando itens…",
    seq: "Seq.",
    textoOriginal: "Texto Original",
    familia: "Família",
    spec: "Spec",
    rede: "Rede",
    ws: "WS",
    qtd: "Qtd",
    metragem: "Metragem",
    confianca: "Confiança",
    warnings: "Warnings",
    revisao: "Revisão",
    acoes: "Ações",
    tarefa: "Tarefa",
    atividade: "Atividade",
    path: "Path",
    status: "Status",
    responsaveis: "Responsáveis",
    quantidade: "Quantidade",
    metragemmLabel: "Metragem (m)",
    meio: "Meio",
    preTerminado: "Pré-terminado",
    naoInformado: "Não informado",
    sim: "Sim",
    nao: "Não",
    salvar: "Salvar",
    cancelar: "Cancelar",
    voltar: "Voltar",
    finalizarRevisao: "Finalizar revisão e continuar",
    itensPendentes: (n: number) => `${n} item(ns) ainda pendente(s) — aprove ou rejeite todos para continuar.`,
    erroAprovarItens: (n: number) => `${n} item(ns) não puderam ser aprovados.`,
    itensAprovados: (n: number) => `${n} item(ns) aprovado(s).`,
    erroAprovar: "Não foi possível aprovar.",
    erroRejeitar: "Não foi possível rejeitar.",
    erroReprocessar: "Não foi possível reprocessar.",
    erroAprovarBulk: "Erro ao aprovar itens.",
    erroRejeitarBulk: "Erro ao rejeitar itens.",
    importacaoFinalizada: (n: number) => `Importação finalizada. ${n} ScopeItem(ns) criado(s).`,
    erroPendentes: "Ainda há itens pendentes de revisão.",
    step3Desc: "O motor de regras vai identificar qual Template de Tarefa corresponde a cada Item de Escopo. Itens sem match precisarão de revisão manual nos Cadastros Mestres antes de prosseguir.",
    carregandoResumo: "Carregando resumo…",
    scopeItemsCriados: "ScopeItems criados",
    templatesResolvidos: "Templates resolvidos",
    aguardandoResolucao: "Aguardando resolução",
    todosResolvidos: "✓ Todos os templates resolvidos",
    resolvendo: "Resolvendo…",
    resolverTemplates: "Resolver Templates",
    continuarGeracaoTarefas: "Continuar para geração de tarefas",
    resolva1Template: "Resolva ao menos 1 template para continuar.",
    resolucaoMsg: (resolved: number, noMatch: number, conflict: number, total: number) =>
      `Resolução: ${resolved} resolvido(s), ${noMatch} sem match, ${conflict} em conflito (de ${total} pendente(s)).`,
    erroResolverTemplates: "Não foi possível resolver os templates.",
    step4Desc: "Gere as Tarefas Operacionais a partir dos Itens de Escopo com template resolvido. Cada tarefa fica com status Pendente até ser atribuída no próximo passo.",
    tarefasGeradas: "Tarefas já geradas",
    tarefasGeradasMsg: (n: number) => `✓ ${n} tarefa(s) gerada(s)`,
    gerando: "Gerando…",
    gerarTarefas: "Gerar Tarefas",
    continuarEnvioProjeto: "Continuar para envio ao projeto",
    gere1Tarefa: "Gere ao menos 1 tarefa para habilitar o próximo passo.",
    tarefasGeradasDetalhe: (tasks: number, items: number, existing: number) =>
      `${tasks} tarefa(s) gerada(s) para ${items} item(ns) de escopo.${existing > 0 ? ` (${existing} já existiam)` : ""}`,
    erroGerarTarefas: "Não foi possível gerar as tarefas.",
    step5Desc: "Selecione o projeto de destino e crie as tarefas. Depois atribua a equipe técnica responsável.",
    projetoDestino: "Projeto de destino",
    selecioneProjeto: "Selecione o projeto…",
    somentePlanejamento: "Somente projetos em planejamento.",
    buscarProjeto: "Buscar por código, nome, PO, cliente ou site...",
    nenhumProjeto: "Nenhum projeto encontrado.",
    semProjetosPlanejamento: "Nenhum projeto em planejamento disponível.",
    carregando: "Carregando…",
    verificar: "Verificar",
    criando: "Criando…",
    criarTarefasProjeto: "Criar Tarefas no Projeto",
    tarefasCriar: "Tarefas a criar",
    tarefasExistentes: "Tarefas já existentes",
    tarefasCriadasMsg: (created: number, existing: number) =>
      `${created} tarefa(s) criada(s) no projeto (${existing} já existiam).`,
    abrirProjeto: "Abrir projeto",
    atribuirEquipe: "Atribuir Equipe",
    tecnicos: "Técnico(s)",
    prazo: "Prazo",
    prioridade: "Prioridade",
    naoAlterar: "(não alterar)",
    atribuindo: "Atribuindo…",
    atribuir: (n: number) => `Atribuir (${n})`,
    erroCarregarPlano: "Não foi possível carregar o plano.",
    erroAtribuir: "Não foi possível atribuir.",
    erroAtribuirSelecao: "Selecione ao menos uma tarefa e um técnico.",
    atribuicaoMsg: (n: number) => `${n} tarefa(s) atribuída(s).`,
    novaImportacao: "Nova Importação",
    sourceTypes: { TEXT: "Texto colado", PDF: "Arquivo PDF", DOCX: "Arquivo DOCX", IMAGE: "Imagem", OTHER: "Outro arquivo" },
    reviewStatus: { PENDING: "Pendente", APPROVED: "Aprovado", REJECTED: "Rejeitado", NEEDS_REVIEW: "Exige revisão" },
    priorities: { low: "Baixa", medium: "Média", high: "Alta", urgent: "Urgente" },
  },
  "en-US": {
    titulo: "New Project Scope",
    subtitulo: "Guided flow: SOW → review → task generation → project",
    steps: ["Import SOW", "Review Items", "Resolve Templates", "Generate Tasks", "Send to Project"],
    step1Desc: "Paste the SOW text or upload a file. The parser will propose Scope Items in the next step for you to review.",
    tituloOpcional: "Title (optional)",
    placeholderTitulo: "E.g.: GRU65 — Phase 2 — SOW v3",
    tipoOrigem: "Source type",
    textoSow: "SOW Text",
    placeholderTexto: "One item per line, e.g.:\n2x 72F OS2 Yellow MPO/MPO, MPO-B, 50m\n4x 2F robust fibers up to 60m\n10x CAT6 UTP up to 60m",
    ouEnvieArquivo: "Or upload a file",
    processando: "Processing…",
    processarSow: "Process SOW",
    erroTextoOuArquivo: "Paste the SOW text or upload a file.",
    falhaProcessamento: "Processing failed",
    erroProcessar: "Could not process the SOW.",
    aprovados: (n: number) => `${n} approved`,
    pendentes: (n: number) => `${n} pending review`,
    de: "of",
    itensDetectados: "detected items",
    selecionarPendentes: "Select pending",
    aprovarSelecionados: (n: number) => `Approve selected (${n})`,
    rejeitarSelecionados: (n: number) => `Reject selected (${n})`,
    carregandoItens: "Loading items…",
    seq: "Seq.",
    textoOriginal: "Original Text",
    familia: "Family",
    spec: "Spec",
    rede: "Network",
    ws: "WS",
    qtd: "Qty",
    metragem: "Length",
    confianca: "Confidence",
    warnings: "Warnings",
    revisao: "Review",
    acoes: "Actions",
    tarefa: "Task",
    atividade: "Activity",
    path: "Path",
    status: "Status",
    responsaveis: "Assignees",
    quantidade: "Quantity",
    metragemmLabel: "Length (m)",
    meio: "Medium",
    preTerminado: "Preterminated",
    naoInformado: "Not specified",
    sim: "Yes",
    nao: "No",
    salvar: "Save",
    cancelar: "Cancel",
    voltar: "Back",
    finalizarRevisao: "Finalize review and continue",
    itensPendentes: (n: number) => `${n} item(s) still pending — approve or reject all to continue.`,
    erroAprovarItens: (n: number) => `${n} item(s) could not be approved.`,
    itensAprovados: (n: number) => `${n} item(s) approved.`,
    erroAprovar: "Could not approve.",
    erroRejeitar: "Could not reject.",
    erroReprocessar: "Could not reprocess.",
    erroAprovarBulk: "Error approving items.",
    erroRejeitarBulk: "Error rejecting items.",
    importacaoFinalizada: (n: number) => `Import finalized. ${n} ScopeItem(s) created.`,
    erroPendentes: "There are still items pending review.",
    step3Desc: "The rules engine will identify which Task Template matches each Scope Item. Items without a match will need manual review in Master Data before proceeding.",
    carregandoResumo: "Loading summary…",
    scopeItemsCriados: "ScopeItems created",
    templatesResolvidos: "Templates resolved",
    aguardandoResolucao: "Awaiting resolution",
    todosResolvidos: "✓ All templates resolved",
    resolvendo: "Resolving…",
    resolverTemplates: "Resolve Templates",
    continuarGeracaoTarefas: "Continue to task generation",
    resolva1Template: "Resolve at least 1 template to continue.",
    resolucaoMsg: (resolved: number, noMatch: number, conflict: number, total: number) =>
      `Resolution: ${resolved} resolved, ${noMatch} no match, ${conflict} conflict (of ${total} pending).`,
    erroResolverTemplates: "Could not resolve templates.",
    step4Desc: "Generate Operational Tasks from Scope Items with a resolved template. Each task starts as Pending until assigned in the next step.",
    tarefasGeradas: "Tasks generated",
    tarefasGeradasMsg: (n: number) => `✓ ${n} task(s) generated`,
    gerando: "Generating…",
    gerarTarefas: "Generate Tasks",
    continuarEnvioProjeto: "Continue to project assignment",
    gere1Tarefa: "Generate at least 1 task to enable the next step.",
    tarefasGeradasDetalhe: (tasks: number, items: number, existing: number) =>
      `${tasks} task(s) generated for ${items} scope item(s).${existing > 0 ? ` (${existing} already existed)` : ""}`,
    erroGerarTarefas: "Could not generate tasks.",
    step5Desc: "Select the destination project and create the tasks. Then assign the responsible technical team.",
    projetoDestino: "Destination project",
    selecioneProjeto: "Select project…",
    somentePlanejamento: "Only projects in planning.",
    buscarProjeto: "Search by code, name, PO, client or site...",
    nenhumProjeto: "No project found.",
    semProjetosPlanejamento: "No projects in planning available.",
    carregando: "Loading…",
    verificar: "Check",
    criando: "Creating…",
    criarTarefasProjeto: "Create Tasks in Project",
    tarefasCriar: "Tasks to create",
    tarefasExistentes: "Existing tasks",
    tarefasCriadasMsg: (created: number, existing: number) =>
      `${created} task(s) created in the project (${existing} already existed).`,
    abrirProjeto: "Open project",
    atribuirEquipe: "Assign Team",
    tecnicos: "Technician(s)",
    prazo: "Deadline",
    prioridade: "Priority",
    naoAlterar: "(no change)",
    atribuindo: "Assigning…",
    atribuir: (n: number) => `Assign (${n})`,
    erroCarregarPlano: "Could not load the plan.",
    erroAtribuir: "Could not assign.",
    erroAtribuirSelecao: "Select at least one task and one technician.",
    atribuicaoMsg: (n: number) => `${n} task(s) assigned.`,
    novaImportacao: "New Import",
    sourceTypes: { TEXT: "Pasted text", PDF: "PDF file", DOCX: "DOCX file", IMAGE: "Image", OTHER: "Other file" },
    reviewStatus: { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", NEEDS_REVIEW: "Needs review" },
    priorities: { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" },
  },
  "es-ES": {
    titulo: "Nuevo Alcance de Proyecto",
    subtitulo: "Flujo guiado: SOW → revisión → generación de tareas → proyecto",
    steps: ["Importar SOW", "Revisar Ítems", "Resolver Templates", "Generar Tareas", "Enviar al Proyecto"],
    step1Desc: "Pegue el texto del SOW o suba un archivo. El parser propondrá los Ítems de Alcance en el siguiente paso para que los revise.",
    tituloOpcional: "Título (opcional)",
    placeholderTitulo: "Ej.: GRU65 — Fase 2 — SOW v3",
    tipoOrigem: "Tipo de origen",
    textoSow: "Texto del SOW",
    placeholderTexto: "Un ítem por línea, ej.:\n2x 72F OS2 Yellow MPO/MPO, MPO-B, 50m\n4x 2F robust fibers up to 60m\n10x CAT6 UTP up to 60m",
    ouEnvieArquivo: "O suba un archivo",
    processando: "Procesando…",
    processarSow: "Procesar SOW",
    erroTextoOuArquivo: "Pegue el texto del SOW o suba un archivo.",
    falhaProcessamento: "Error de procesamiento",
    erroProcessar: "No se pudo procesar el SOW.",
    aprovados: (n: number) => `${n} aprobado(s)`,
    pendentes: (n: number) => `${n} pendiente(s) de revisión`,
    de: "de",
    itensDetectados: "ítems detectados",
    selecionarPendentes: "Seleccionar pendientes",
    aprovarSelecionados: (n: number) => `Aprobar seleccionados (${n})`,
    rejeitarSelecionados: (n: number) => `Rechazar seleccionados (${n})`,
    carregandoItens: "Cargando ítems…",
    seq: "Seq.",
    textoOriginal: "Texto Original",
    familia: "Familia",
    spec: "Spec",
    rede: "Red",
    ws: "WS",
    qtd: "Cant.",
    metragem: "Metraje",
    confianca: "Confianza",
    warnings: "Avisos",
    revisao: "Revisión",
    acoes: "Acciones",
    tarefa: "Tarea",
    atividade: "Actividad",
    path: "Path",
    status: "Estado",
    responsaveis: "Responsables",
    quantidade: "Cantidad",
    metragemmLabel: "Metraje (m)",
    meio: "Medio",
    preTerminado: "Preterminado",
    naoInformado: "No especificado",
    sim: "Sí",
    nao: "No",
    salvar: "Guardar",
    cancelar: "Cancelar",
    voltar: "Volver",
    finalizarRevisao: "Finalizar revisión y continuar",
    itensPendentes: (n: number) => `${n} ítem(s) aún pendiente(s) — apruebe o rechace todos para continuar.`,
    erroAprovarItens: (n: number) => `${n} ítem(s) no pudieron ser aprobados.`,
    itensAprovados: (n: number) => `${n} ítem(s) aprobado(s).`,
    erroAprovar: "No se pudo aprobar.",
    erroRejeitar: "No se pudo rechazar.",
    erroReprocessar: "No se pudo reprocesar.",
    erroAprovarBulk: "Error al aprobar ítems.",
    erroRejeitarBulk: "Error al rechazar ítems.",
    importacaoFinalizada: (n: number) => `Importación finalizada. ${n} ScopeItem(s) creado(s).`,
    erroPendentes: "Todavía hay ítems pendientes de revisión.",
    step3Desc: "El motor de reglas identificará qué Plantilla de Tarea corresponde a cada Ítem de Alcance. Los ítems sin coincidencia necesitarán revisión manual en Datos Maestros antes de continuar.",
    carregandoResumo: "Cargando resumen…",
    scopeItemsCriados: "ScopeItems creados",
    templatesResolvidos: "Templates resueltos",
    aguardandoResolucao: "En espera de resolución",
    todosResolvidos: "✓ Todos los templates resueltos",
    resolvendo: "Resolviendo…",
    resolverTemplates: "Resolver Templates",
    continuarGeracaoTarefas: "Continuar con generación de tareas",
    resolva1Template: "Resuelva al menos 1 template para continuar.",
    resolucaoMsg: (resolved: number, noMatch: number, conflict: number, total: number) =>
      `Resolución: ${resolved} resuelto(s), ${noMatch} sin match, ${conflict} en conflicto (de ${total} pendiente(s)).`,
    erroResolverTemplates: "No se pudieron resolver los templates.",
    step4Desc: "Genere las Tareas Operacionales a partir de los Ítems de Alcance con template resuelto. Cada tarea queda como Pendiente hasta ser asignada en el siguiente paso.",
    tarefasGeradas: "Tareas generadas",
    tarefasGeradasMsg: (n: number) => `✓ ${n} tarea(s) generada(s)`,
    gerando: "Generando…",
    gerarTarefas: "Generar Tareas",
    continuarEnvioProjeto: "Continuar con asignación al proyecto",
    gere1Tarefa: "Genere al menos 1 tarea para habilitar el siguiente paso.",
    tarefasGeradasDetalhe: (tasks: number, items: number, existing: number) =>
      `${tasks} tarea(s) generada(s) para ${items} ítem(s) de alcance.${existing > 0 ? ` (${existing} ya existían)` : ""}`,
    erroGerarTarefas: "No se pudieron generar las tareas.",
    step5Desc: "Seleccione el proyecto destino y cree las tareas. Luego asigne el equipo técnico responsable.",
    projetoDestino: "Proyecto destino",
    selecioneProjeto: "Seleccione el proyecto…",
    somentePlanejamento: "Solo proyectos en planificación.",
    buscarProjeto: "Buscar por código, nombre, PO, cliente o sitio...",
    nenhumProjeto: "Ningún proyecto encontrado.",
    semProjetosPlanejamento: "Ningún proyecto en planificación disponible.",
    carregando: "Cargando…",
    verificar: "Verificar",
    criando: "Creando…",
    criarTarefasProjeto: "Crear Tareas en el Proyecto",
    tarefasCriar: "Tareas a crear",
    tarefasExistentes: "Tareas existentes",
    tarefasCriadasMsg: (created: number, existing: number) =>
      `${created} tarea(s) creada(s) en el proyecto (${existing} ya existían).`,
    abrirProjeto: "Abrir proyecto",
    atribuirEquipe: "Asignar Equipo",
    tecnicos: "Técnico(s)",
    prazo: "Plazo",
    prioridade: "Prioridad",
    naoAlterar: "(sin cambios)",
    atribuindo: "Asignando…",
    atribuir: (n: number) => `Asignar (${n})`,
    erroCarregarPlano: "No se pudo cargar el plan.",
    erroAtribuir: "No se pudo asignar.",
    erroAtribuirSelecao: "Seleccione al menos una tarea y un técnico.",
    atribuicaoMsg: (n: number) => `${n} tarea(s) asignada(s).`,
    novaImportacao: "Nueva Importación",
    sourceTypes: { TEXT: "Texto pegado", PDF: "Archivo PDF", DOCX: "Archivo DOCX", IMAGE: "Imagen", OTHER: "Otro archivo" },
    reviewStatus: { PENDING: "Pendiente", APPROVED: "Aprobado", REJECTED: "Rechazado", NEEDS_REVIEW: "Requiere revisión" },
    priorities: { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" },
  },
};

interface SowSummary {
  scope_items_created: number;
  templates_resolved: number;
  items_awaiting_resolution: number;
  tasks_generated: number;
}

interface EditForm {
  suggested_cable_family: number | "";
  suggested_cable_spec: number | "";
  suggested_network: number | "";
  suggested_workstream: number | "";
  suggested_paths: number[];
  quantity: number | "";
  unit: string;
  length_type: string;
  length_m: number | "";
  medium: string;
  preterminated: string;
  color: string;
  fiber_count: number | "";
}

function editFormFromItem(item: SowParsedItem): EditForm {
  return {
    suggested_cable_family: item.suggested_cable_family ?? "",
    suggested_cable_spec: item.suggested_cable_spec ?? "",
    suggested_network: item.suggested_network ?? "",
    suggested_workstream: item.suggested_workstream ?? "",
    suggested_paths: item.suggested_paths ?? [],
    quantity: item.quantity ?? "",
    unit: item.unit ?? "",
    length_type: item.length_type ?? "",
    length_m: item.length_m ? Number(item.length_m) : "",
    medium: item.medium ?? "",
    preterminated: item.preterminated === null ? "" : item.preterminated ? "true" : "false",
    color: item.color ?? "",
    fiber_count: item.fiber_count ?? "",
  };
}

function confidenceColor(band: string | null) {
  if (band === "HIGH") return "var(--green)";
  if (band === "MEDIUM") return "var(--amber)";
  if (band === "LOW") return "var(--red)";
  return "var(--text-muted)";
}

function reviewStatusColor(status: string) {
  if (status === "APPROVED") return "var(--green)";
  if (status === "REJECTED") return "var(--red)";
  if (status === "NEEDS_REVIEW") return "var(--amber)";
  return "var(--text-muted)";
}

type P = ReturnType<typeof usePageText<typeof TEXT>>;

function StepBar({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 24, gap: 0 }}>
      {steps.map((label, i) => {
        const n = i + 1;
        return (
          <Fragment key={n}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
              <div
                style={{
                  width: 32, height: 32, borderRadius: "50%", display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700,
                  background: n < current ? "var(--green)" : n === current ? "var(--orange)" : "var(--surface-2, #eee)",
                  color: n <= current ? "#fff" : "var(--text-faint)",
                  transition: "background 0.2s",
                }}
              >
                {n < current ? <Icon name="check" style={{ fontSize: 16 }} /> : n}
              </div>
              <div style={{ fontSize: 11, marginTop: 4, color: n === current ? "var(--orange)" : n < current ? "var(--green)" : "var(--text-faint)", fontWeight: n === current ? 700 : 400, textAlign: "center", whiteSpace: "nowrap" }}>
                {label}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 2, height: 2, marginBottom: 18, background: n < current ? "var(--green)" : "var(--border, #ddd)", transition: "background 0.2s" }} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

export default function SowWizardPanel({ refs }: { refs: ReferenceData }) {
  const p = usePageText(TEXT);
  const [step, setStep] = useState(1);

  const sourceTypeOptions = Object.entries(p.sourceTypes).map(([value, label]) => ({ value, label }));
  const priorityOptions = Object.entries(p.priorities).map(([value, label]) => ({ value, label }));

  const [searchParams] = useSearchParams();
  const [title, setTitle] = useState(() => searchParams.get("sowTitle") || "");
  const [sourceType, setSourceType] = useState("TEXT");
  const [sourceText, setSourceText] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [activeImport, setActiveImport] = useState<SowImport | null>(null);

  const [items, setItems] = useState<SowParsedItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [summary, setSummary] = useState<SowSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [projectId, setProjectId] = useState<number | "">("");
  const [planLoading, setPlanLoading] = useState(false);
  const [planData, setPlanData] = useState<{ project_tasks_to_create: number; project_tasks_existing: number } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [taskCreating, setTaskCreating] = useState(false);
  const [taskCreateResult, setTaskCreateResult] = useState<{ created_count: number; existing_count: number } | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);
  const [assignCollaboratorIds, setAssignCollaboratorIds] = useState<number[]>([]);
  const [assignDeadline, setAssignDeadline] = useState("");
  const [assignPriority, setAssignPriority] = useState("");

  useEffect(() => {
    if (step === 5 && projects.length === 0) {
      projectsApi.list({ page_size: "500" }).then((r) => setProjects(r.results));
      collaboratorsApi.list({ page_size: "500" }).then((r) => setCollaborators(r.results));
    }
  }, [step, projects.length]);

  function withBusy<T>(id: number, fn: () => Promise<T>) {
    setBusyIds((prev) => new Set(prev).add(id));
    return fn().finally(() => setBusyIds((prev) => { const next = new Set(prev); next.delete(id); return next; }));
  }

  async function loadItems(importId: number) {
    setLoadingItems(true);
    try { const data = await planningApi.sowImports.items(importId); setItems(data); }
    finally { setLoadingItems(false); }
  }

  async function loadSummary(importId: number) {
    setSummaryLoading(true);
    try { const data = await planningApi.sowImports.summary(importId); setSummary(data); }
    catch { setSummary(null); }
    finally { setSummaryLoading(false); }
  }

  async function handleCreateAndProcess() {
    setCreateError(null);
    if (!sourceFile && !sourceText.trim()) { setCreateError(p.erroTextoOuArquivo); return; }
    setCreating(true);
    try {
      const created = sourceFile
        ? await planningApi.sowImports.createWithFile({ title, source_type: sourceType, source_text: sourceText, source_file: sourceFile })
        : await planningApi.sowImports.create({ title, source_type: sourceType, source_text: sourceText } as never);
      if (created.status === "FAILED") {
        setActiveImport(created);
        setCreateError(`${p.falhaProcessamento}: ${created.error_message}`);
        return;
      }
      const processed = await planningApi.sowImports.process(created.id);
      setActiveImport(processed);
      await loadItems(processed.id);
      await loadSummary(processed.id);
      setStep(2);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string; source_text?: string[] } } };
      setCreateError(e.response?.data?.detail || e.response?.data?.source_text?.[0] || p.erroProcessar);
    } finally {
      setCreating(false);
    }
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function selectAll() {
    setSelectedIds(new Set(items.filter((i) => i.active && (i.review_status === "PENDING" || i.review_status === "NEEDS_REVIEW")).map((i) => i.id)));
  }

  async function handleApproveSelected() {
    if (!activeImport || selectedIds.size === 0) return;
    setActionError(null); setActionMessage(null); setBulkBusy(true);
    try {
      const result = await planningApi.sowImports.approveSelected(activeImport.id, Array.from(selectedIds));
      setActiveImport(result.sow_import);
      if (result.errors.length > 0) setActionError(p.erroAprovarItens(result.errors.length));
      if (result.approved.length > 0) setActionMessage(p.itensAprovados(result.approved.length));
      setSelectedIds(new Set());
      await loadItems(activeImport.id);
      await loadSummary(activeImport.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setActionError(e.response?.data?.detail || p.erroAprovarBulk);
    } finally { setBulkBusy(false); }
  }

  async function handleRejectSelected() {
    if (!activeImport || selectedIds.size === 0) return;
    setActionError(null); setBulkBusy(true);
    try {
      const result = await planningApi.sowImports.rejectSelected(activeImport.id, Array.from(selectedIds));
      setActiveImport(result.sow_import);
      setSelectedIds(new Set());
      await loadItems(activeImport.id);
    } catch { setActionError(p.erroRejeitarBulk); }
    finally { setBulkBusy(false); }
  }

  async function handleApproveItem(item: SowParsedItem) {
    setActionError(null);
    try {
      await withBusy(item.id, () => planningApi.sowParsedItems.approve(item.id));
      if (activeImport) { const updated = await planningApi.sowImports.get(activeImport.id); setActiveImport(updated); await loadItems(activeImport.id); await loadSummary(activeImport.id); }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setActionError(e.response?.data?.detail || p.erroAprovar);
    }
  }

  async function handleRejectItem(item: SowParsedItem) {
    setActionError(null);
    try {
      await withBusy(item.id, () => planningApi.sowParsedItems.reject(item.id));
      if (activeImport) { const updated = await planningApi.sowImports.get(activeImport.id); setActiveImport(updated); await loadItems(activeImport.id); }
    } catch { setActionError(p.erroRejeitar); }
  }

  async function handleReprocessItem(item: SowParsedItem) {
    setActionError(null);
    try { await withBusy(item.id, () => planningApi.sowParsedItems.reprocess(item.id)); if (activeImport) await loadItems(activeImport.id); }
    catch { setActionError(p.erroReprocessar); }
  }

  async function saveEdit(item: SowParsedItem) {
    if (!editForm) return;
    const payload = {
      suggested_cable_family: editForm.suggested_cable_family || null,
      suggested_cable_spec: editForm.suggested_cable_spec || null,
      suggested_network: editForm.suggested_network || null,
      suggested_workstream: editForm.suggested_workstream || null,
      suggested_paths: editForm.suggested_paths,
      quantity: editForm.quantity === "" ? null : editForm.quantity,
      unit: editForm.unit, length_type: editForm.length_type,
      length_m: editForm.length_m === "" ? null : editForm.length_m,
      medium: editForm.medium,
      preterminated: editForm.preterminated === "" ? null : editForm.preterminated === "true",
      color: editForm.color,
      fiber_count: editForm.fiber_count === "" ? null : editForm.fiber_count,
    };
    await planningApi.sowParsedItems.update(item.id, payload as never);
    setEditingId(null); setEditForm(null);
    if (activeImport) await loadItems(activeImport.id);
  }

  async function handleFinalize() {
    if (!activeImport) return;
    setActionError(null); setActionMessage(null);
    try {
      const updated = await planningApi.sowImports.finalize(activeImport.id);
      setActiveImport(updated);
      await loadSummary(updated.id);
      setActionMessage(p.importacaoFinalizada(updated.total_items_approved));
      setStep(3);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setActionError(e.response?.data?.detail || p.erroPendentes);
    }
  }

  async function handleResolveTemplates() {
    if (!activeImport) return;
    setActionError(null); setActionMessage(null); setBulkBusy(true);
    try {
      const result = await masterDataApi.scopeItems.resolveAll(activeImport.code);
      setActionMessage(p.resolucaoMsg(result.resolved, result.no_match, result.conflict, result.total));
      await loadSummary(activeImport.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setActionError(e.response?.data?.detail || p.erroResolverTemplates);
    } finally { setBulkBusy(false); }
  }

  async function handleGenerateTasks() {
    if (!activeImport) return;
    setActionError(null); setActionMessage(null); setBulkBusy(true);
    try {
      const result = await masterDataApi.scopeItems.generateTasksBulk(activeImport.code);
      setActionMessage(p.tarefasGeradasDetalhe(result.tasks_created, result.scope_items_processed, result.tasks_existing));
      await loadSummary(activeImport.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setActionError(e.response?.data?.detail || p.erroGerarTarefas);
    } finally { setBulkBusy(false); }
  }

  async function loadPlan() {
    if (!projectId || !activeImport) return;
    setPlanError(null); setPlanLoading(true);
    try {
      const data = await planningApi.projectPlan.get(Number(projectId), { sowImport: activeImport.code });
      setPlanData({ project_tasks_to_create: data.totals.project_tasks_to_create, project_tasks_existing: data.totals.project_tasks_existing });
      const tasksData = await projectTasksApi.list({ project: String(projectId), sow_import: activeImport.code });
      setProjectTasks(tasksData.results);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setPlanError(e.response?.data?.detail || p.erroCarregarPlano);
    } finally { setPlanLoading(false); }
  }

  async function handleCreateTasks() {
    if (!projectId || !activeImport) return;
    setTaskCreating(true); setPlanError(null);
    try {
      const result = await planningApi.projectPlan.createTasks(Number(projectId), { sowImport: activeImport.code });
      setTaskCreateResult({ created_count: result.created_count, existing_count: result.existing_count });
      await loadPlan();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setPlanError(e.response?.data?.detail || p.erroGerarTarefas);
    } finally { setTaskCreating(false); }
  }

  async function handleAssign() {
    if (!projectId || selectedTaskIds.size === 0 || assignCollaboratorIds.length === 0) {
      setAssignMessage(p.erroAtribuirSelecao); return;
    }
    setAssigning(true); setAssignMessage(null);
    try {
      const result = await projectsApi.tasksBulk(Number(projectId), {
        action: "update",
        task_ids: Array.from(selectedTaskIds),
        collaborator_ids: assignCollaboratorIds,
        planned_end: assignDeadline ? new Date(assignDeadline).toISOString() : null,
        priority: assignPriority || undefined,
      });
      setAssignMessage(p.atribuicaoMsg(result.updated ?? selectedTaskIds.size));
      setSelectedTaskIds(new Set());
      await loadPlan();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setAssignMessage(e.response?.data?.detail || p.erroAtribuir);
    } finally { setAssigning(false); }
  }

  const pendingCount = items.filter((i) => i.active && (i.review_status === "PENDING" || i.review_status === "NEEDS_REVIEW")).length;
  const approvedCount = items.filter((i) => i.active && i.review_status === "APPROVED").length;
  const selectedProject = projects.find((proj) => proj.id === projectId);
  // Só projetos em planejamento (mesma regra da aba "Planejamentos": planejamento ou não iniciado).
  const planningProjects = projects.filter((proj) => PLANNING_STATUSES.includes(proj.status));

  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <div>
          <div className="toolbar-title">{p.titulo}</div>
          <div className="toolbar-subtitle">{p.subtitulo}</div>
        </div>
        {activeImport && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "right" }}>
            <strong>{activeImport.code}</strong>
            {activeImport.title && <> — {activeImport.title}</>}
          </div>
        )}
      </div>

      <StepBar current={step} steps={p.steps} />

      {actionError && (
        <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 10, padding: "8px 12px", background: "var(--red-soft, #fff0f0)", borderRadius: 6 }}>
          {actionError}
        </div>
      )}
      {actionMessage && (
        <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 10, padding: "8px 12px", background: "var(--green-soft, #f0fff4)", borderRadius: 6 }}>
          ✓ {actionMessage}
        </div>
      )}

      {step === 1 && (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>{p.step1Desc}</p>
          {createError && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{createError}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div className="field-group">
              <span className="field-label">{p.tituloOpcional}</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={p.placeholderTitulo} />
            </div>
            <div className="field-group">
              <span className="field-label">{p.tipoOrigem}</span>
              <SearchSelect
                options={sourceTypeOptions.map((o) => ({ value: o.value, label: o.label }))}
                value={sourceType}
                onChange={(v) => { const val = String(v); setSourceType(val); }}
                clearable={false}
              />
            </div>
          </div>
          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">{p.textoSow}</span>
            <textarea className="input" rows={10} value={sourceText} onChange={(e) => setSourceText(e.target.value)} placeholder={p.placeholderTexto} />
          </div>
          <div className="field-group" style={{ marginBottom: 20 }}>
            <span className="field-label">{p.ouEnvieArquivo}</span>
            <FileInput value={sourceFile} onChange={setSourceFile} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={handleCreateAndProcess} disabled={creating}>
              {creating ? p.processando : p.processarSow}
              {!creating && <Icon name="arrow_forward" style={{ fontSize: 16, marginLeft: 6 }} />}
            </button>
          </div>
        </div>
      )}

      {step === 2 && activeImport && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
              {p.aprovados(approvedCount)} · {p.pendentes(pendingCount)} {p.de} {items.length} {p.itensDetectados}
            </p>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-outline btn-sm" onClick={selectAll}>{p.selecionarPendentes}</button>
              <button className="btn btn-outline btn-sm" onClick={handleApproveSelected} disabled={bulkBusy || selectedIds.size === 0}>
                {p.aprovarSelecionados(selectedIds.size)}
              </button>
              <button className="btn btn-outline btn-sm" onClick={handleRejectSelected} disabled={bulkBusy || selectedIds.size === 0}>
                {p.rejeitarSelecionados(selectedIds.size)}
              </button>
            </div>
          </div>

          {loadingItems && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{p.carregandoItens}</p>}

          {!loadingItems && items.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: 14 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={items.filter((i) => i.review_status === "PENDING" || i.review_status === "NEEDS_REVIEW").length > 0 && items.filter((i) => i.review_status === "PENDING" || i.review_status === "NEEDS_REVIEW").every((i) => selectedIds.has(i.id))}
                        onChange={(e) => { if (e.target.checked) selectAll(); else setSelectedIds(new Set()); }}
                      />
                    </th>
                    <th>{p.seq}</th>
                    <th>{p.textoOriginal}</th>
                    <th>{p.familia}</th>
                    <th>{p.spec}</th>
                    <th>{p.rede}</th>
                    <th>{p.ws}</th>
                    <th>{p.qtd}</th>
                    <th>{p.metragem}</th>
                    <th>{p.confianca}</th>
                    <th>{p.warnings}</th>
                    <th>{p.revisao}</th>
                    <th>{p.acoes}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <Fragment key={item.id}>
                      <tr>
                        <td><input type="checkbox" checked={selectedIds.has(item.id)} disabled={item.review_status !== "PENDING" && item.review_status !== "NEEDS_REVIEW"} onChange={() => toggleSelected(item.id)} /></td>
                        <td>{item.sequence}</td>
                        <td style={{ maxWidth: 240, fontSize: 12 }}>{item.raw_text}</td>
                        <td>{item.suggested_cable_family_code || "—"}</td>
                        <td>{item.suggested_cable_spec_code || "—"}</td>
                        <td>{item.suggested_network_code || "—"}</td>
                        <td>{item.suggested_workstream_code || "—"}</td>
                        <td>{item.quantity ?? "—"}</td>
                        <td>{item.length_m ? `${item.length_m}m` : "—"}</td>
                        <td style={{ color: confidenceColor(item.confidence_band) }}>{item.confidence_score ?? "—"}</td>
                        <td>{item.warnings.map((w, i) => <div key={i} style={{ color: w.critical ? "var(--red)" : "var(--amber)", fontSize: 11 }}>⚠ {w.message}</div>)}</td>
                        <td style={{ color: reviewStatusColor(item.review_status) }}>
                          {p.reviewStatus[item.review_status as keyof typeof p.reviewStatus] || item.review_status}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button className="btn btn-outline btn-sm" disabled={busyIds.has(item.id) || item.review_status === "APPROVED"} onClick={() => handleApproveItem(item)}>✓</button>
                            <button className="btn btn-outline btn-sm" disabled={busyIds.has(item.id) || item.review_status === "APPROVED"} onClick={() => handleRejectItem(item)}>✕</button>
                            <button className="btn btn-outline btn-sm" disabled={busyIds.has(item.id) || item.review_status === "APPROVED"} onClick={() => (editingId === item.id ? setEditingId(null) : (setEditingId(item.id), setEditForm(editFormFromItem(item))))}><Icon name="edit" style={{ fontSize: 13 }} /></button>
                            <button className="btn btn-outline btn-sm" disabled={busyIds.has(item.id) || item.review_status === "APPROVED"} onClick={() => handleReprocessItem(item)}><Icon name="refresh" style={{ fontSize: 13 }} /></button>
                          </div>
                        </td>
                      </tr>
                      {editingId === item.id && editForm && (
                        <tr>
                          <td colSpan={13}>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, padding: 12, background: "var(--surface-2, #f7f7f8)", borderRadius: 8 }}>
                              <div className="field-group">
                                <span className="field-label">{p.familia}</span>
                                <SearchSelect
                                  options={(refs.cableFamilies.map((f) => ({ value: f.id, label: f.code, sublabel: f.name })))}
                                  value={editForm.suggested_cable_family}
                                  onChange={(v) => { const val = v === "" ? "" : Number(v); setEditForm({ ...editForm, suggested_cable_family: val }); }}
                                  placeholder="—"
                                />
                              </div>
                              <div className="field-group">
                                <span className="field-label">{p.spec}</span>
                                <SearchSelect
                                  options={(refs.cableSpecs.map((s) => ({ value: s.id, label: s.code })))}
                                  value={editForm.suggested_cable_spec}
                                  onChange={(v) => { const val = v === "" ? "" : Number(v); setEditForm({ ...editForm, suggested_cable_spec: val }); }}
                                  placeholder="—"
                                />
                              </div>
                              <div className="field-group">
                                <span className="field-label">{p.rede}</span>
                                <SearchSelect
                                  options={(refs.networks.map((n) => ({ value: n.id, label: n.code, sublabel: n.name })))}
                                  value={editForm.suggested_network}
                                  onChange={(v) => { const val = v === "" ? "" : Number(v); setEditForm({ ...editForm, suggested_network: val }); }}
                                  placeholder="—"
                                />
                              </div>
                              <div className="field-group">
                                <span className="field-label">{p.ws}</span>
                                <SearchSelect
                                  options={(refs.workstreams.map((w) => ({ value: w.id, label: w.code, sublabel: w.name })))}
                                  value={editForm.suggested_workstream}
                                  onChange={(v) => { const val = v === "" ? "" : Number(v); setEditForm({ ...editForm, suggested_workstream: val }); }}
                                  placeholder="—"
                                />
                              </div>
                              <div className="field-group">
                                <span className="field-label">{p.quantidade}</span>
                                <input className="input" type="number" value={editForm.quantity} onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value ? Number(e.target.value) : "" })} />
                              </div>
                              <div className="field-group">
                                <span className="field-label">{p.metragemmLabel}</span>
                                <input className="input" type="number" value={editForm.length_m} onChange={(e) => setEditForm({ ...editForm, length_m: e.target.value ? Number(e.target.value) : "" })} />
                              </div>
                              <div className="field-group">
                                <span className="field-label">{p.meio}</span>
                                <SearchSelect
                                  options={(["FIBER", "COPPER"].map((v) => ({ value: v, label: v })))}
                                  value={editForm.medium}
                                  onChange={(v) => { const val = String(v); setEditForm({ ...editForm, medium: val }); }}
                                  placeholder="—"
                                />
                              </div>
                              <div className="field-group">
                                <span className="field-label">{p.preTerminado}</span>
                                <SearchSelect
                                  options={([{ value: "true", label: p.sim }, { value: "false", label: p.nao }])}
                                  value={editForm.preterminated}
                                  onChange={(v) => { const val = String(v); setEditForm({ ...editForm, preterminated: val }); }}
                                  placeholder={p.naoInformado}
                                />
                              </div>
                              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                                <button className="btn btn-primary btn-sm" onClick={() => saveEdit(item)}>{p.salvar}</button>
                                <button className="btn btn-outline btn-sm" onClick={() => setEditingId(null)}>{p.cancelar}</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <button className="btn btn-outline" onClick={() => setStep(1)}>
              <Icon name="arrow_back" style={{ fontSize: 16, marginRight: 6 }} />{p.voltar}
            </button>
            <button className="btn btn-primary" onClick={handleFinalize} disabled={pendingCount > 0}>
              {p.finalizarRevisao}<Icon name="arrow_forward" style={{ fontSize: 16, marginLeft: 6 }} />
            </button>
          </div>
          {pendingCount > 0 && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "right", marginTop: 4 }}>
              {p.itensPendentes(pendingCount)}
            </p>
          )}
        </div>
      )}

      {step === 3 && activeImport && (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>{p.step3Desc}</p>
          {summaryLoading && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{p.carregandoResumo}</p>}
          {!summaryLoading && summary && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: p.scopeItemsCriados, value: summary.scope_items_created },
                { label: p.templatesResolvidos, value: summary.templates_resolved, color: summary.templates_resolved > 0 ? "var(--green)" : undefined },
                { label: p.aguardandoResolucao, value: summary.items_awaiting_resolution, color: summary.items_awaiting_resolution > 0 ? "var(--amber)" : undefined },
              ].map((tile) => (
                <div key={tile.label} style={{ padding: 14, background: "var(--surface-2, #f7f7f8)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: tile.color || "var(--text)" }}>{tile.value}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{tile.label}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setStep(2)}>
              <Icon name="arrow_back" style={{ fontSize: 15, marginRight: 6 }} />{p.voltar}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {summary?.items_awaiting_resolution === 0 && (summary?.templates_resolved ?? 0) > 0 && (
                <span style={{ fontSize: 12, color: "var(--green)" }}>{p.todosResolvidos}</span>
              )}
              <button className="btn btn-outline btn-sm" onClick={handleResolveTemplates} disabled={bulkBusy || (summary?.items_awaiting_resolution === 0 && (summary?.templates_resolved ?? 0) > 0)}>
                {bulkBusy ? p.resolvendo : p.resolverTemplates}
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => { setActionError(null); setActionMessage(null); setStep(4); }} disabled={(summary?.templates_resolved ?? 0) === 0}>
                {p.continuarGeracaoTarefas}<Icon name="arrow_forward" style={{ fontSize: 15, marginLeft: 6 }} />
              </button>
            </div>
          </div>
          {(summary?.templates_resolved ?? 0) === 0 && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "right", marginTop: 4 }}>{p.resolva1Template}</p>
          )}
        </div>
      )}

      {step === 4 && activeImport && (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>{p.step4Desc}</p>
          {!summaryLoading && summary && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: p.templatesResolvidos, value: summary.templates_resolved, color: "var(--green)" },
                { label: p.tarefasGeradas, value: summary.tasks_generated, color: summary.tasks_generated > 0 ? "var(--green)" : undefined },
                { label: p.aguardandoResolucao, value: summary.items_awaiting_resolution, color: summary.items_awaiting_resolution > 0 ? "var(--amber)" : undefined },
              ].map((tile) => (
                <div key={tile.label} style={{ padding: 14, background: "var(--surface-2, #f7f7f8)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: tile.color || "var(--text)" }}>{tile.value}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{tile.label}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setStep(3)}>
              <Icon name="arrow_back" style={{ fontSize: 15, marginRight: 6 }} />{p.voltar}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {(summary?.tasks_generated ?? 0) > 0 && !bulkBusy && (
                <span style={{ fontSize: 12, color: "var(--green)" }}>{p.tarefasGeradasMsg(summary!.tasks_generated)}</span>
              )}
              <button className="btn btn-outline btn-sm" onClick={handleGenerateTasks} disabled={bulkBusy || (summary?.templates_resolved ?? 0) === 0}>
                {bulkBusy ? p.gerando : p.gerarTarefas}
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => { setActionError(null); setActionMessage(null); setStep(5); }} disabled={(summary?.tasks_generated ?? 0) === 0}>
                {p.continuarEnvioProjeto}<Icon name="arrow_forward" style={{ fontSize: 15, marginLeft: 6 }} />
              </button>
            </div>
          </div>
          {(summary?.tasks_generated ?? 0) === 0 && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "right", marginTop: 4 }}>{p.gere1Tarefa}</p>
          )}
        </div>
      )}

      {step === 5 && activeImport && (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>{p.step5Desc}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, marginBottom: 14, alignItems: "flex-end" }}>
            <div className="field-group">
              <span className="field-label">{p.projetoDestino}</span>
              <ProjectCombobox
                projects={planningProjects}
                value={projectId}
                onChange={(id) => { setProjectId(id); setPlanData(null); setTaskCreateResult(null); }}
                placeholder={p.buscarProjeto}
                emptyLabel={p.nenhumProjeto}
                showAllToggle={false}
              />
              <span style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>
                {planningProjects.length === 0 && projects.length > 0 ? p.semProjetosPlanejamento : p.somentePlanejamento}
              </span>
            </div>
            <button className="btn btn-outline" onClick={loadPlan} disabled={!projectId || planLoading}>
              {planLoading ? p.carregando : p.verificar}
            </button>
            <button className="btn btn-primary" onClick={handleCreateTasks} disabled={!projectId || taskCreating || (planData?.project_tasks_to_create === 0 && taskCreateResult !== null)}>
              {taskCreating ? p.criando : p.criarTarefasProjeto}
            </button>
          </div>

          {planError && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{planError}</p>}

          {planData && (
            <div style={{ padding: 12, background: "var(--surface-2, #f7f7f8)", borderRadius: 8, fontSize: 13, marginBottom: 14, lineHeight: 1.8 }}>
              <div>{p.tarefasCriar}: <strong>{planData.project_tasks_to_create}</strong></div>
              <div>{p.tarefasExistentes}: <strong>{planData.project_tasks_existing}</strong></div>
            </div>
          )}

          {taskCreateResult && (
            <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 14 }}>
              ✓ {p.tarefasCriadasMsg(taskCreateResult.created_count, taskCreateResult.existing_count)}
              {selectedProject && (
                <Link className="btn btn-outline btn-sm" to={`/projetos/${selectedProject.id}`} style={{ marginLeft: 10 }}>
                  {p.abrirProjeto}
                </Link>
              )}
            </div>
          )}

          {projectTasks.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{p.atribuirEquipe}</div>
              <div className="table-wrap" style={{ marginBottom: 10 }}>
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
                    {projectTasks.map((task) => (
                      <tr key={task.id}>
                        <td><input type="checkbox" checked={selectedTaskIds.has(task.id)} onChange={() => { setSelectedTaskIds((prev) => { const next = new Set(prev); next.has(task.id) ? next.delete(task.id) : next.add(task.id); return next; }); }} /></td>
                        <td>{task.task_name}</td>
                        <td>{task.activity_code || "—"}</td>
                        <td>{task.path_code || "—"}</td>
                        <td>{task.quantity_planned ?? "—"} {task.unit}</td>
                        <td>{task.status_display}</td>
                        <td>{task.collaborators.map((c) => c.name).join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 10, alignItems: "flex-end" }}>
                <div className="field-group">
                  <span className="field-label">{p.tecnicos}</span>
                  <SearchMultiSelect
                    options={collaborators.map((c) => ({ value: c.id, label: c.name }))}
                    value={assignCollaboratorIds}
                    onChange={(next) => { const val = next.map(Number); setAssignCollaboratorIds(val); }}
                  />
                </div>
                <div className="field-group">
                  <span className="field-label">{p.prazo}</span>
                  <DateInput value={assignDeadline} onChange={setAssignDeadline} />
                </div>
                <div className="field-group">
                  <span className="field-label">{p.prioridade}</span>
                  <SearchSelect
                    options={priorityOptions.map((o) => ({ value: o.value, label: o.label }))}
                    value={assignPriority}
                    onChange={(v) => { const val = String(v); setAssignPriority(val); }}
                    placeholder={p.naoAlterar}
                  />
                </div>
                <button className="btn btn-primary btn-sm" onClick={handleAssign} disabled={assigning}>
                  <Icon name="person_add" style={{ fontSize: 14 }} />
                  {assigning ? p.atribuindo : p.atribuir(selectedTaskIds.size)}
                </button>
              </div>
              {assignMessage && <p style={{ fontSize: 13, marginTop: 8 }}>{assignMessage}</p>}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
            <button className="btn btn-outline" onClick={() => setStep(4)}>
              <Icon name="arrow_back" style={{ fontSize: 16, marginRight: 6 }} />{p.voltar}
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              {selectedProject && (
                <Link className="btn btn-outline" to={`/projetos/${selectedProject.id}`}>
                  <Icon name="open_in_new" style={{ fontSize: 16, marginRight: 6 }} />{p.abrirProjeto}
                </Link>
              )}
              <button className="btn btn-primary" onClick={() => {
                setStep(1); setTitle(""); setSourceType("TEXT"); setSourceText(""); setSourceFile(null); setCreateError(null);
                setActiveImport(null); setItems([]); setSummary(null);
                setProjectId(""); setPlanData(null); setTaskCreateResult(null); setProjectTasks([]);
                setActionError(null); setActionMessage(null);
              }}>
                <Icon name="add" style={{ fontSize: 16, marginRight: 6 }} />{p.novaImportacao}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
