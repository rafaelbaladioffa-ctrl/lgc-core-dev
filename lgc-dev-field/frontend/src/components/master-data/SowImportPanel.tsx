import SearchSelect, { SearchMultiSelect } from "../ui/SearchSelect";
import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { masterDataApi, planningApi } from "../../api/resources";
import type { AiStatus, SowImport, SowParsedItem } from "../../api/types";
import { useI18n, usePageText } from "../../i18n";
import FileInput from "../ui/FileInput";
import Icon from "../ui/Icon";
import type { ReferenceData } from "../../pages/cadastros/registryConfig";

const TEXT = {
  "pt-BR": {
    titulo: "Importar SOW",
    subtitulo: "Cole o texto de um escopo (ou envie um arquivo) e deixe o parser determinístico + IA propor Itens de Escopo — sempre como preview revisável, nunca gravado sem sua aprovação explícita.",
    novaImportacao: "Nova Importação",
    ia: "IA",
    configurado: "Configurado",
    naoConfigurado: "Não configurado (modo determinístico)",
    modeloConfigurado: "Modelo configurado",
    statusLabel: "Status",
    carregando: "Carregando…",
    codigo: "Código",
    titulo2: "Título",
    detectados: "Detectados",
    aprovados: "Aprovados",
    rejeitados: "Rejeitados",
    warnings: "Warnings",
    data: "Data",
    nenhumaImportacao: "Nenhuma importação ainda.",
    novaImportacaoTitulo: "Nova Importação de SOW",
    etapa1: "Etapa 1 — Origem: cole o texto ou envie um arquivo.",
    voltar: "Voltar",
    tituloOpcional: "Título",
    placeholderTitulo: "Opcional",
    tipoOrigem: "Tipo de origem",
    textoSow: "Texto do SOW",
    placeholderTexto: "Uma linha por item, ex:\n2x 72F OS2 Yellow MPO/MPO, MPO-B, 0072X6P64 with 50m\n4x 2F robust fibers up to 60m\n10x CAT6 UTP up to 60m",
    ouEnvieArquivo: "Ou envie um arquivo",
    avisoArquivo: "O texto é extraído automaticamente de arquivos de texto e de PDF com texto selecionável. DOCX, imagens e PDFs escaneados são guardados para auditoria, mas exigem colar o texto.",
    processando: "Processando…",
    processarSow: "Processar SOW",
    erroTextoOuArquivo: "Cole o texto do SOW ou envie um arquivo.",
    erroProcessar: "Não foi possível processar o SOW.",
    falhaProcessamento: "Falha no processamento",
    reprocessarSow: "Reprocessar SOW",
    erroReprocessar: "Não foi possível reprocessar.",
    modoLabel: "Modo",
    modeloUtilizado: "Modelo utilizado",
    scopeItemsCriados: "ScopeItems criados",
    templatesResolvidos: "templates resolvidos",
    itensAguardando: "itens aguardando resolução",
    tarefasGeradas2: "tarefas geradas",
    abrirItensEscopo: "Abrir Itens de Escopo desta SOW",
    resolverTemplates: (n: number) => `Resolver templates pendentes (${n})`,
    gerarTarefas: "Gerar tarefas dos itens prontos",
    abrirTarefasGeradas: "Abrir Tarefas Geradas desta SOW",
    abrirPlanoProjeto: "Abrir Plano do Projeto",
    erroResolverTemplates: "Não foi possível resolver os templates pendentes.",
    erroGerarTarefas: "Não foi possível gerar as tarefas.",
    resolucaoEmLote: (resolved: number, noMatch: number, conflict: number, total: number) =>
      `Resolução em lote: ${resolved} resolvido(s), ${noMatch} sem match, ${conflict} em conflito (de ${total} pendente(s)).`,
    tarefasGeradasMsg: (tasks: number, items: number, existing: number) =>
      `${tasks} tarefa(s) gerada(s) para ${items} item(ns) de escopo.${existing > 0 ? ` (${existing} já existiam)` : ""}`,
    carregandoItens: "Carregando itens…",
    aprovarSelecionados: (n: number) => `Aprovar selecionados (${n})`,
    rejeitarSelecionados: (n: number) => `Rejeitar selecionados (${n})`,
    finalizarImportacao: "Finalizar Importação",
    itensPendentes: (n: number) => `${n} item(ns) ainda pendente(s) de revisão`,
    erroPendentes: "Ainda há itens pendentes de revisão.",
    erroAprovar: "Não foi possível aprovar este item.",
    erroRejeitar: "Não foi possível rejeitar este item.",
    erroReprocessarItem: "Não foi possível reprocessar este item.",
    errosAprovacao: (n: number, detail: string) => `${n} item(ns) não puderam ser aprovados: ${detail}`,
    scopeItemsCriadosMsg: (n: number) => `${n} ScopeItem(ns) criado(s). Use "Abrir Itens de Escopo desta SOW" abaixo para resolver os templates e gerar as tarefas.`,
    importacaoFinalizada: (approved: number, rejected: number) =>
      `Importação finalizada. ${approved} ScopeItem(ns) criado(s), ${rejected} rejeitado(s).`,
    seq: "Seq.",
    textoOriginal: "Texto Original",
    familia: "Família",
    spec: "Spec",
    rede: "Rede",
    workstream: "Workstream",
    paths: "Paths",
    qtd: "Qtd",
    metragem: "Metragem",
    meio: "Meio",
    confianca: "Confiança",
    revisao: "Revisão",
    acoes: "Ações",
    aprovar: "Aprovar",
    rejeitar: "Rejeitar",
    editar: "Editar",
    reprocessar: "Reprocessar",
    quantidade: "Quantidade",
    unidade: "Unidade",
    tipoMetragem: "Tipo de Metragem",
    metragemmLabel: "Metragem (m)",
    preTerminado: "Pré-terminado",
    naoInformado: "Não informado",
    sim: "Sim",
    nao: "Não",
    cor: "Cor",
    nFibras: "Nº de Fibras",
    salvar: "Salvar",
    cancelar: "Cancelar",
    sourceTypes: { TEXT: "Texto colado", PDF: "Arquivo PDF", DOCX: "Arquivo DOCX", IMAGE: "Imagem", OTHER: "Outro arquivo" },
    statusImport: { DRAFT: "Rascunho", PROCESSING: "Processando", READY_FOR_REVIEW: "Pronto para revisão", PARTIALLY_REVIEWED: "Parcialmente revisado", APPROVED: "Finalizado", FAILED: "Falhou", CANCELLED: "Cancelado" },
    reviewStatus: { PENDING: "Pendente", APPROVED: "Aprovado", REJECTED: "Rejeitado", NEEDS_REVIEW: "Exige revisão" },
  },
  "en-US": {
    titulo: "Import SOW",
    subtitulo: "Paste a scope text (or upload a file) and let the deterministic parser + AI propose Scope Items — always as a reviewable preview, never saved without your explicit approval.",
    novaImportacao: "New Import",
    ia: "AI",
    configurado: "Configured",
    naoConfigurado: "Not configured (deterministic mode)",
    modeloConfigurado: "Configured model",
    statusLabel: "Status",
    carregando: "Loading…",
    codigo: "Code",
    titulo2: "Title",
    detectados: "Detected",
    aprovados: "Approved",
    rejeitados: "Rejected",
    warnings: "Warnings",
    data: "Date",
    nenhumaImportacao: "No imports yet.",
    novaImportacaoTitulo: "New SOW Import",
    etapa1: "Step 1 — Source: paste the text or upload a file.",
    voltar: "Back",
    tituloOpcional: "Title",
    placeholderTitulo: "Optional",
    tipoOrigem: "Source type",
    textoSow: "SOW Text",
    placeholderTexto: "One item per line, e.g.:\n2x 72F OS2 Yellow MPO/MPO, MPO-B, 0072X6P64 with 50m\n4x 2F robust fibers up to 60m\n10x CAT6 UTP up to 60m",
    ouEnvieArquivo: "Or upload a file",
    avisoArquivo: "Text is extracted automatically from plain text files and PDFs with selectable text. DOCX, images and scanned PDFs are kept for auditing but require pasting the text.",
    processando: "Processing…",
    processarSow: "Process SOW",
    erroTextoOuArquivo: "Paste the SOW text or upload a file.",
    erroProcessar: "Could not process the SOW.",
    falhaProcessamento: "Processing failed",
    reprocessarSow: "Reprocess SOW",
    erroReprocessar: "Could not reprocess.",
    modoLabel: "Mode",
    modeloUtilizado: "Model used",
    scopeItemsCriados: "ScopeItems created",
    templatesResolvidos: "templates resolved",
    itensAguardando: "items awaiting resolution",
    tarefasGeradas2: "tasks generated",
    abrirItensEscopo: "Open Scope Items for this SOW",
    resolverTemplates: (n: number) => `Resolve pending templates (${n})`,
    gerarTarefas: "Generate tasks for ready items",
    abrirTarefasGeradas: "Open Generated Tasks for this SOW",
    abrirPlanoProjeto: "Open Project Plan",
    erroResolverTemplates: "Could not resolve pending templates.",
    erroGerarTarefas: "Could not generate the tasks.",
    resolucaoEmLote: (resolved: number, noMatch: number, conflict: number, total: number) =>
      `Batch resolution: ${resolved} resolved, ${noMatch} no match, ${conflict} conflict (of ${total} pending).`,
    tarefasGeradasMsg: (tasks: number, items: number, existing: number) =>
      `${tasks} task(s) generated for ${items} scope item(s).${existing > 0 ? ` (${existing} already existed)` : ""}`,
    carregandoItens: "Loading items…",
    aprovarSelecionados: (n: number) => `Approve selected (${n})`,
    rejeitarSelecionados: (n: number) => `Reject selected (${n})`,
    finalizarImportacao: "Finalize Import",
    itensPendentes: (n: number) => `${n} item(s) still pending review`,
    erroPendentes: "There are still items pending review.",
    erroAprovar: "Could not approve this item.",
    erroRejeitar: "Could not reject this item.",
    erroReprocessarItem: "Could not reprocess this item.",
    errosAprovacao: (n: number, detail: string) => `${n} item(s) could not be approved: ${detail}`,
    scopeItemsCriadosMsg: (n: number) => `${n} ScopeItem(s) created. Use "Open Scope Items for this SOW" below to resolve templates and generate tasks.`,
    importacaoFinalizada: (approved: number, rejected: number) =>
      `Import finalized. ${approved} ScopeItem(s) created, ${rejected} rejected.`,
    seq: "Seq.",
    textoOriginal: "Original Text",
    familia: "Family",
    spec: "Spec",
    rede: "Network",
    workstream: "Workstream",
    paths: "Paths",
    qtd: "Qty",
    metragem: "Length",
    meio: "Medium",
    confianca: "Confidence",
    revisao: "Review",
    acoes: "Actions",
    aprovar: "Approve",
    rejeitar: "Reject",
    editar: "Edit",
    reprocessar: "Reprocess",
    quantidade: "Quantity",
    unidade: "Unit",
    tipoMetragem: "Length Type",
    metragemmLabel: "Length (m)",
    preTerminado: "Preterminated",
    naoInformado: "Not specified",
    sim: "Yes",
    nao: "No",
    cor: "Color",
    nFibras: "Fiber count",
    salvar: "Save",
    cancelar: "Cancel",
    sourceTypes: { TEXT: "Pasted text", PDF: "PDF file", DOCX: "DOCX file", IMAGE: "Image", OTHER: "Other file" },
    statusImport: { DRAFT: "Draft", PROCESSING: "Processing", READY_FOR_REVIEW: "Ready for review", PARTIALLY_REVIEWED: "Partially reviewed", APPROVED: "Finalized", FAILED: "Failed", CANCELLED: "Cancelled" },
    reviewStatus: { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", NEEDS_REVIEW: "Needs review" },
  },
  "es-ES": {
    titulo: "Importar SOW",
    subtitulo: "Pegue el texto de un alcance (o suba un archivo) y deje que el parser determinístico + IA proponga Ítems de Alcance — siempre como vista previa revisable, nunca guardado sin su aprobación explícita.",
    novaImportacao: "Nueva Importación",
    ia: "IA",
    configurado: "Configurado",
    naoConfigurado: "No configurado (modo determinístico)",
    modeloConfigurado: "Modelo configurado",
    statusLabel: "Estado",
    carregando: "Cargando…",
    codigo: "Código",
    titulo2: "Título",
    detectados: "Detectados",
    aprovados: "Aprobados",
    rejeitados: "Rechazados",
    warnings: "Avisos",
    data: "Fecha",
    nenhumaImportacao: "Ninguna importación todavía.",
    novaImportacaoTitulo: "Nueva Importación de SOW",
    etapa1: "Paso 1 — Origen: pegue el texto o suba un archivo.",
    voltar: "Volver",
    tituloOpcional: "Título",
    placeholderTitulo: "Opcional",
    tipoOrigem: "Tipo de origen",
    textoSow: "Texto del SOW",
    placeholderTexto: "Un ítem por línea, ej.:\n2x 72F OS2 Yellow MPO/MPO, MPO-B, 0072X6P64 with 50m\n4x 2F robust fibers up to 60m\n10x CAT6 UTP up to 60m",
    ouEnvieArquivo: "O suba un archivo",
    avisoArquivo: "El texto se extrae automáticamente de archivos de texto y de PDF con texto seleccionable. DOCX, imágenes y PDF escaneados se guardan para auditoría, pero requieren pegar el texto.",
    processando: "Procesando…",
    processarSow: "Procesar SOW",
    erroTextoOuArquivo: "Pegue el texto del SOW o suba un archivo.",
    erroProcessar: "No se pudo procesar el SOW.",
    falhaProcessamento: "Error de procesamiento",
    reprocessarSow: "Reprocesar SOW",
    erroReprocessar: "No se pudo reprocesar.",
    modoLabel: "Modo",
    modeloUtilizado: "Modelo utilizado",
    scopeItemsCriados: "ScopeItems creados",
    templatesResolvidos: "templates resueltos",
    itensAguardando: "ítems en espera de resolución",
    tarefasGeradas2: "tareas generadas",
    abrirItensEscopo: "Abrir Ítems de Alcance de este SOW",
    resolverTemplates: (n: number) => `Resolver templates pendientes (${n})`,
    gerarTarefas: "Generar tareas de los ítems listos",
    abrirTarefasGeradas: "Abrir Tareas Generadas de este SOW",
    abrirPlanoProjeto: "Abrir Plan del Proyecto",
    erroResolverTemplates: "No se pudieron resolver los templates pendientes.",
    erroGerarTarefas: "No se pudieron generar las tareas.",
    resolucaoEmLote: (resolved: number, noMatch: number, conflict: number, total: number) =>
      `Resolución en lote: ${resolved} resuelto(s), ${noMatch} sin match, ${conflict} en conflicto (de ${total} pendiente(s)).`,
    tarefasGeradasMsg: (tasks: number, items: number, existing: number) =>
      `${tasks} tarea(s) generada(s) para ${items} ítem(s) de alcance.${existing > 0 ? ` (${existing} ya existían)` : ""}`,
    carregandoItens: "Cargando ítems…",
    aprovarSelecionados: (n: number) => `Aprobar seleccionados (${n})`,
    rejeitarSelecionados: (n: number) => `Rechazar seleccionados (${n})`,
    finalizarImportacao: "Finalizar Importación",
    itensPendentes: (n: number) => `${n} ítem(s) aún pendiente(s) de revisión`,
    erroPendentes: "Todavía hay ítems pendientes de revisión.",
    erroAprovar: "No se pudo aprobar este ítem.",
    erroRejeitar: "No se pudo rechazar este ítem.",
    erroReprocessarItem: "No se pudo reprocesar este ítem.",
    errosAprovacao: (n: number, detail: string) => `${n} ítem(s) no pudieron ser aprobados: ${detail}`,
    scopeItemsCriadosMsg: (n: number) => `${n} ScopeItem(s) creado(s). Use "Abrir Ítems de Alcance de este SOW" abajo para resolver los templates y generar las tareas.`,
    importacaoFinalizada: (approved: number, rejected: number) =>
      `Importación finalizada. ${approved} ScopeItem(s) creado(s), ${rejected} rechazado(s).`,
    seq: "Seq.",
    textoOriginal: "Texto Original",
    familia: "Familia",
    spec: "Spec",
    rede: "Red",
    workstream: "Workstream",
    paths: "Paths",
    qtd: "Cant.",
    metragem: "Metraje",
    meio: "Medio",
    confianca: "Confianza",
    revisao: "Revisión",
    acoes: "Acciones",
    aprovar: "Aprobar",
    rejeitar: "Rechazar",
    editar: "Editar",
    reprocessar: "Reprocesar",
    quantidade: "Cantidad",
    unidade: "Unidad",
    tipoMetragem: "Tipo de Metraje",
    metragemmLabel: "Metraje (m)",
    preTerminado: "Preterminado",
    naoInformado: "No especificado",
    sim: "Sí",
    nao: "No",
    cor: "Color",
    nFibras: "Nº de fibras",
    salvar: "Guardar",
    cancelar: "Cancelar",
    sourceTypes: { TEXT: "Texto pegado", PDF: "Archivo PDF", DOCX: "Archivo DOCX", IMAGE: "Imagen", OTHER: "Otro archivo" },
    statusImport: { DRAFT: "Borrador", PROCESSING: "Procesando", READY_FOR_REVIEW: "Listo para revisión", PARTIALLY_REVIEWED: "Parcialmente revisado", APPROVED: "Finalizado", FAILED: "Falló", CANCELLED: "Cancelado" },
    reviewStatus: { PENDING: "Pendiente", APPROVED: "Aprobado", REJECTED: "Rechazado", NEEDS_REVIEW: "Requiere revisión" },
  },
};

interface SowSummary {
  total_items_detected: number;
  total_items_approved: number;
  total_items_rejected: number;
  scope_items_created: number;
  templates_resolved: number;
  items_awaiting_resolution: number;
  tasks_generated: number;
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

export default function SowImportPanel({ refs }: { refs: ReferenceData }) {
  const navigate = useNavigate();
  const { locale } = useI18n();
  const p = usePageText(TEXT);

  const sourceTypeOptions = Object.entries(p.sourceTypes).map(([value, label]) => ({ value, label }));

  const [mode, setMode] = useState<"list" | "new" | "detail">("list");
  const [imports, setImports] = useState<SowImport[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [summary, setSummary] = useState<SowSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [bulkActionBusy, setBulkActionBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState("TEXT");
  const [sourceText, setSourceText] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [activeImport, setActiveImport] = useState<SowImport | null>(null);
  const [items, setItems] = useState<SowParsedItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  function loadImports() {
    setLoadingList(true);
    planningApi.sowImports
      .list({ page_size: "50" } as never)
      .then((r) => setImports(r.results))
      .finally(() => setLoadingList(false));
  }

  useEffect(() => {
    loadImports();
    planningApi.ai.status().then(setAiStatus).catch(() => setAiStatus(null));
  }, []);

  function resetNewForm() {
    setTitle("");
    setSourceType("TEXT");
    setSourceText("");
    setSourceFile(null);
    setCreateError(null);
  }

  function openNew() {
    resetNewForm();
    setMode("new");
  }

  async function openDetail(imp: SowImport) {
    setActiveImport(imp);
    setMode("detail");
    setSelectedIds(new Set());
    setEditingId(null);
    setActionError(null);
    setSuccessMessage(null);
    setSummary(null);
    await loadItems(imp.id);
    await loadSummary(imp.id);
  }

  function loadSummary(importId: number) {
    setSummaryLoading(true);
    return planningApi.sowImports
      .summary(importId)
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoading(false));
  }

  function openScopeItemsForThisSow() {
    if (!activeImport) return;
    navigate(`/cadastros-mestres?focusEntity=scope-items&focusSearch=${encodeURIComponent(activeImport.code)}`);
  }

  function openGeneratedTasksForThisSow() {
    if (!activeImport) return;
    navigate(`/cadastros-mestres?focusEntity=generated-tasks&focusSearch=${encodeURIComponent(activeImport.code)}`);
  }

  function openProjectPlanForThisSow() {
    if (!activeImport) return;
    navigate(`/cadastros-mestres?focusEntity=project-plan&planSow=${encodeURIComponent(activeImport.code)}`);
  }

  async function handleResolvePendingTemplates() {
    if (!activeImport) return;
    setActionError(null);
    setBulkActionBusy(true);
    try {
      const result = await masterDataApi.scopeItems.resolveAll(activeImport.code);
      setSuccessMessage(p.resolucaoEmLote(result.resolved, result.no_match, result.conflict, result.total));
      await loadSummary(activeImport.id);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setActionError(axiosErr.response?.data?.detail || p.erroResolverTemplates);
    } finally {
      setBulkActionBusy(false);
    }
  }

  async function handleGenerateReadyTasks() {
    if (!activeImport) return;
    setActionError(null);
    setBulkActionBusy(true);
    try {
      const result = await masterDataApi.scopeItems.generateTasksBulk(activeImport.code);
      setSuccessMessage(p.tarefasGeradasMsg(result.tasks_created, result.scope_items_processed, result.tasks_existing));
      await loadSummary(activeImport.id);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setActionError(axiosErr.response?.data?.detail || p.erroGerarTarefas);
    } finally {
      setBulkActionBusy(false);
    }
  }

  async function loadItems(importId: number) {
    setLoadingItems(true);
    try {
      const data = await planningApi.sowImports.items(importId);
      setItems(data);
    } finally {
      setLoadingItems(false);
    }
  }

  async function refreshActiveImport(importId: number) {
    const updated = await planningApi.sowImports.get(importId);
    setActiveImport(updated);
    setImports((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    return updated;
  }

  async function handleCreateAndProcess() {
    setCreateError(null);
    if (!sourceFile && !sourceText.trim()) {
      setCreateError(p.erroTextoOuArquivo);
      return;
    }
    setCreating(true);
    try {
      const created = sourceFile
        ? await planningApi.sowImports.createWithFile({ title, source_type: sourceType, source_text: sourceText, source_file: sourceFile })
        : await planningApi.sowImports.create({ title, source_type: sourceType, source_text: sourceText } as never);

      if (created.status === "FAILED") {
        setImports((prev) => [created, ...prev]);
        await openDetail(created);
        return;
      }

      const processed = await planningApi.sowImports.process(created.id);
      setImports((prev) => [processed, ...prev]);
      await openDetail(processed);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string; source_text?: string[] } } };
      setCreateError(axiosErr.response?.data?.detail || axiosErr.response?.data?.source_text?.[0] || p.erroProcessar);
    } finally {
      setCreating(false);
    }
  }

  async function handleReprocessImport() {
    if (!activeImport) return;
    setActionError(null);
    try {
      const updated = await planningApi.sowImports.reprocess(activeImport.id);
      setActiveImport(updated);
      await loadItems(updated.id);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setActionError(axiosErr.response?.data?.detail || p.erroReprocessar);
    }
  }

  function withBusy<T>(id: number, fn: () => Promise<T>) {
    setBusyIds((prev) => new Set(prev).add(id));
    return fn().finally(() => {
      setBusyIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    });
  }

  async function handleApprove(item: SowParsedItem) {
    setActionError(null);
    try {
      await withBusy(item.id, () => planningApi.sowParsedItems.approve(item.id));
      if (activeImport) { await refreshActiveImport(activeImport.id); await loadItems(activeImport.id); }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setActionError(axiosErr.response?.data?.detail || p.erroAprovar);
    }
  }

  async function handleReject(item: SowParsedItem) {
    setActionError(null);
    try {
      await withBusy(item.id, () => planningApi.sowParsedItems.reject(item.id));
      if (activeImport) { await refreshActiveImport(activeImport.id); await loadItems(activeImport.id); }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setActionError(axiosErr.response?.data?.detail || p.erroRejeitar);
    }
  }

  async function handleReprocessItem(item: SowParsedItem) {
    setActionError(null);
    try {
      await withBusy(item.id, () => planningApi.sowParsedItems.reprocess(item.id));
      if (activeImport) await loadItems(activeImport.id);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setActionError(axiosErr.response?.data?.detail || p.erroReprocessarItem);
    }
  }

  async function handleApproveSelected() {
    if (!activeImport || selectedIds.size === 0) return;
    setActionError(null);
    setSuccessMessage(null);
    const result = await planningApi.sowImports.approveSelected(activeImport.id, Array.from(selectedIds));
    setActiveImport(result.sow_import);
    setImports((prev) => prev.map((i) => (i.id === result.sow_import.id ? result.sow_import : i)));
    if (result.errors.length > 0) {
      setActionError(p.errosAprovacao(result.errors.length, result.errors.map((e) => e.detail).join(" ")));
    }
    if (result.approved.length > 0) {
      setSuccessMessage(p.scopeItemsCriadosMsg(result.approved.length));
    }
    setSelectedIds(new Set());
    await loadItems(activeImport.id);
    await loadSummary(activeImport.id);
  }

  async function handleRejectSelected() {
    if (!activeImport || selectedIds.size === 0) return;
    setActionError(null);
    const result = await planningApi.sowImports.rejectSelected(activeImport.id, Array.from(selectedIds));
    setActiveImport(result.sow_import);
    setImports((prev) => prev.map((i) => (i.id === result.sow_import.id ? result.sow_import : i)));
    setSelectedIds(new Set());
    await loadItems(activeImport.id);
  }

  async function handleFinalize() {
    if (!activeImport) return;
    setActionError(null);
    setSuccessMessage(null);
    try {
      const updated = await planningApi.sowImports.finalize(activeImport.id);
      setActiveImport(updated);
      setImports((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setSuccessMessage(p.importacaoFinalizada(updated.total_items_approved, updated.total_items_rejected));
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setActionError(axiosErr.response?.data?.detail || p.erroPendentes);
    }
  }

  function startEdit(item: SowParsedItem) {
    setEditingId(item.id);
    setEditForm(editFormFromItem(item));
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
      unit: editForm.unit,
      length_type: editForm.length_type,
      length_m: editForm.length_m === "" ? null : editForm.length_m,
      medium: editForm.medium,
      preterminated: editForm.preterminated === "" ? null : editForm.preterminated === "true",
      color: editForm.color,
      fiber_count: editForm.fiber_count === "" ? null : editForm.fiber_count,
    };
    await planningApi.sowParsedItems.update(item.id, payload as never);
    setEditingId(null);
    setEditForm(null);
    if (activeImport) await loadItems(activeImport.id);
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const pendingCount = items.filter((i) => i.active && (i.review_status === "PENDING" || i.review_status === "NEEDS_REVIEW")).length;

  if (mode === "list") {
    return (
      <div className="card">
        <div className="toolbar">
          <div>
            <div className="toolbar-title">{p.titulo}</div>
            <div className="toolbar-subtitle">{p.subtitulo}</div>
          </div>
          <button className="btn btn-primary" onClick={openNew}>
            <Icon name="add" style={{ fontSize: 16 }} /> {p.novaImportacao}
          </button>
        </div>

        {aiStatus && (
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
            {p.ia}: {aiStatus.provider === "openrouter" ? "OpenRouter" : aiStatus.provider} · {p.modeloConfigurado}:{" "}
            {aiStatus.configured_model || "—"} · {p.statusLabel}:{" "}
            <span style={{ color: aiStatus.configured ? "var(--green)" : "var(--text-muted)" }}>
              {aiStatus.configured ? p.configurado : p.naoConfigurado}
            </span>
          </p>
        )}

        {loadingList && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{p.carregando}</p>}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{p.codigo}</th>
                <th>{p.titulo2}</th>
                <th>{p.statusLabel}</th>
                <th>{p.detectados}</th>
                <th>{p.aprovados}</th>
                <th>{p.rejeitados}</th>
                <th>{p.warnings}</th>
                <th>{p.data}</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((imp) => (
                <tr key={imp.id} style={{ cursor: "pointer" }} onClick={() => openDetail(imp)}>
                  <td>{imp.code}</td>
                  <td>{imp.title || "—"}</td>
                  <td>{p.statusImport[imp.status as keyof typeof p.statusImport] || imp.status}</td>
                  <td>{imp.total_items_detected}</td>
                  <td>{imp.total_items_approved}</td>
                  <td>{imp.total_items_rejected}</td>
                  <td>{imp.total_warnings}</td>
                  <td>{new Date(imp.created_at).toLocaleString(locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {imports.length === 0 && !loadingList && <div className="table-empty">{p.nenhumaImportacao}</div>}
        </div>
      </div>
    );
  }

  if (mode === "new") {
    return (
      <div className="card">
        <div className="toolbar">
          <div>
            <div className="toolbar-title">{p.novaImportacaoTitulo}</div>
            <div className="toolbar-subtitle">{p.etapa1}</div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => setMode("list")}>{p.voltar}</button>
        </div>

        <div style={{ padding: "0 20px 20px" }}>
          {createError && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{createError}</p>}

          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">{p.tituloOpcional}</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={p.placeholderTitulo} />
          </div>

          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">{p.tipoOrigem}</span>
            <SearchSelect
              options={sourceTypeOptions.map((o) => ({ value: o.value, label: o.label }))}
              value={sourceType}
              onChange={(v) => { const val = String(v); setSourceType(val); }}
              clearable={false}
            />
          </div>

          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">{p.textoSow}</span>
            <textarea className="input" rows={10} value={sourceText} onChange={(e) => setSourceText(e.target.value)} placeholder={p.placeholderTexto} />
          </div>

          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">{p.ouEnvieArquivo}</span>
            <FileInput value={sourceFile} onChange={setSourceFile} />
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{p.avisoArquivo}</p>
          </div>

          <button className="btn btn-primary" onClick={handleCreateAndProcess} disabled={creating}>
            {creating ? p.processando : p.processarSow}
          </button>
        </div>
      </div>
    );
  }

  if (!activeImport) return null;

  return (
    <div className="card">
      <div className="toolbar">
        <div>
          <div className="toolbar-title">
            {activeImport.code} {activeImport.title ? `— ${activeImport.title}` : ""}
          </div>
          <div className="toolbar-subtitle">
            {p.statusLabel}: {p.statusImport[activeImport.status as keyof typeof p.statusImport] || activeImport.status} · {p.detectados}:{" "}
            {activeImport.total_items_detected} · {p.aprovados}: {activeImport.total_items_approved} · {p.rejeitados}:{" "}
            {activeImport.total_items_rejected} · {p.warnings}: {activeImport.total_warnings}
            <br />
            {p.modoLabel}:{" "}
            <span style={{ color: activeImport.ai_mode === "HYBRID_AI" ? "var(--green)" : "var(--text-muted)" }}>
              {activeImport.ai_mode === "HYBRID_AI" ? "Hybrid AI" : "Deterministic Only"}
            </span>
            {activeImport.ai_mode === "HYBRID_AI" && activeImport.ai_model && (
              <> · {p.modeloUtilizado}: {activeImport.ai_model}</>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => setMode("list")}>{p.voltar}</button>
          <button className="btn btn-outline btn-sm" onClick={handleReprocessImport}>{p.reprocessarSow}</button>
        </div>
      </div>

      {activeImport.status === "FAILED" && (
        <p style={{ color: "var(--red)", fontSize: 13 }}>⚠ {p.falhaProcessamento}: {activeImport.error_message}</p>
      )}
      {successMessage && <p style={{ color: "var(--green)", fontSize: 13, marginBottom: 10 }}>✓ {successMessage}</p>}
      {actionError && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{actionError}</p>}

      {!summaryLoading && summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, padding: 12, marginBottom: 14, background: "var(--surface-2, #f7f7f8)", borderRadius: 8, fontSize: 13 }}>
          <div><strong>{summary.scope_items_created}</strong><br />{p.scopeItemsCriados}</div>
          <div><strong>{summary.templates_resolved}</strong><br />{p.templatesResolvidos}</div>
          <div><strong>{summary.items_awaiting_resolution}</strong><br />{p.itensAguardando}</div>
          <div><strong>{summary.tasks_generated}</strong><br />{p.tarefasGeradas2}</div>
          <div style={{ gridColumn: "span 4", display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            <button className="btn btn-outline btn-sm" onClick={openScopeItemsForThisSow} disabled={summary.scope_items_created === 0}>
              {p.abrirItensEscopo}
            </button>
            <button className="btn btn-outline btn-sm" onClick={handleResolvePendingTemplates} disabled={bulkActionBusy || summary.items_awaiting_resolution === 0}>
              {p.resolverTemplates(summary.items_awaiting_resolution)}
            </button>
            <button className="btn btn-outline btn-sm" onClick={handleGenerateReadyTasks} disabled={bulkActionBusy || summary.templates_resolved === 0}>
              {p.gerarTarefas}
            </button>
            <button className="btn btn-outline btn-sm" onClick={openGeneratedTasksForThisSow} disabled={summary.tasks_generated === 0}>
              {p.abrirTarefasGeradas}
            </button>
            <button className="btn btn-primary btn-sm" onClick={openProjectPlanForThisSow} disabled={summary.tasks_generated === 0}>
              {p.abrirPlanoProjeto}
            </button>
          </div>
        </div>
      )}

      {loadingItems && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{p.carregandoItens}</p>}

      {!loadingItems && items.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button className="btn btn-outline btn-sm" onClick={handleApproveSelected} disabled={selectedIds.size === 0}>
              {p.aprovarSelecionados(selectedIds.size)}
            </button>
            <button className="btn btn-outline btn-sm" onClick={handleRejectSelected} disabled={selectedIds.size === 0}>
              {p.rejeitarSelecionados(selectedIds.size)}
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleFinalize} disabled={pendingCount > 0}>
              {p.finalizarImportacao}
            </button>
            {pendingCount > 0 && (
              <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
                {p.itensPendentes(pendingCount)}
              </span>
            )}
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th>{p.seq}</th>
                  <th>{p.textoOriginal}</th>
                  <th>{p.familia}</th>
                  <th>{p.spec}</th>
                  <th>{p.rede}</th>
                  <th>{p.workstream}</th>
                  <th>{p.paths}</th>
                  <th>{p.qtd}</th>
                  <th>{p.metragem}</th>
                  <th>{p.meio}</th>
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
                      <td>
                        <input type="checkbox" checked={selectedIds.has(item.id)} disabled={item.review_status !== "PENDING" && item.review_status !== "NEEDS_REVIEW"} onChange={() => toggleSelected(item.id)} />
                      </td>
                      <td>{item.sequence}</td>
                      <td style={{ maxWidth: 260 }}>{item.raw_text}</td>
                      <td>{item.suggested_cable_family_code || "—"}</td>
                      <td>{item.suggested_cable_spec_code || "—"}</td>
                      <td>{item.suggested_network_code || "—"}</td>
                      <td>{item.suggested_workstream_code || "—"}</td>
                      <td>{item.suggested_path_codes.join(", ") || "—"}</td>
                      <td>{item.quantity ?? "—"}</td>
                      <td>{item.length_m ? `${item.length_m}m` : "—"} {item.length_type && `(${item.length_type})`}</td>
                      <td>{item.medium || "—"}</td>
                      <td style={{ color: confidenceColor(item.confidence_band) }}>{item.confidence_score ?? "—"}</td>
                      <td>
                        {item.warnings.map((w, i) => (
                          <div key={i} style={{ color: w.critical ? "var(--red)" : "var(--amber)", fontSize: 11 }}>⚠ {w.message}</div>
                        ))}
                      </td>
                      <td style={{ color: reviewStatusColor(item.review_status) }}>
                        {p.reviewStatus[item.review_status as keyof typeof p.reviewStatus] || item.review_status}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          <button className="btn btn-outline btn-sm" disabled={busyIds.has(item.id) || item.review_status === "APPROVED"} onClick={() => handleApprove(item)}>{p.aprovar}</button>
                          <button className="btn btn-outline btn-sm" disabled={busyIds.has(item.id) || item.review_status === "APPROVED"} onClick={() => handleReject(item)}>{p.rejeitar}</button>
                          <button className="btn btn-outline btn-sm" disabled={busyIds.has(item.id) || item.review_status === "APPROVED"} onClick={() => (editingId === item.id ? setEditingId(null) : startEdit(item))}>{p.editar}</button>
                          <button className="btn btn-outline btn-sm" disabled={busyIds.has(item.id) || item.review_status === "APPROVED"} onClick={() => handleReprocessItem(item)}>{p.reprocessar}</button>
                        </div>
                      </td>
                    </tr>
                    {editingId === item.id && editForm && (
                      <tr>
                        <td colSpan={15}>
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
                              <span className="field-label">{p.workstream}</span>
                              <SearchSelect
                                options={(refs.workstreams.map((w) => ({ value: w.id, label: w.code, sublabel: w.name })))}
                                value={editForm.suggested_workstream}
                                onChange={(v) => { const val = v === "" ? "" : Number(v); setEditForm({ ...editForm, suggested_workstream: val }); }}
                                placeholder="—"
                              />
                            </div>
                            <div className="field-group" style={{ gridColumn: "span 2" }}>
                              <span className="field-label">{p.paths}</span>
                              <SearchMultiSelect
                                options={(refs.paths.map((pp) => ({ value: pp.id, label: pp.code, sublabel: pp.name })))}
                                value={editForm.suggested_paths}
                                onChange={(next) => { const val = next.map(Number); setEditForm({ ...editForm, suggested_paths: val }); }}
                              />
                            </div>
                            <div className="field-group">
                              <span className="field-label">{p.quantidade}</span>
                              <input className="input" type="number" value={editForm.quantity} onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value ? Number(e.target.value) : "" })} />
                            </div>
                            <div className="field-group">
                              <span className="field-label">{p.unidade}</span>
                              <input className="input" value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} />
                            </div>
                            <div className="field-group">
                              <span className="field-label">{p.tipoMetragem}</span>
                              <SearchSelect
                                options={(["EXACT", "MAXIMUM", "MINIMUM", "RANGE", "UNKNOWN"].map((v) => ({ value: v, label: v })))}
                                value={editForm.length_type}
                                onChange={(v) => { const val = String(v); setEditForm({ ...editForm, length_type: val }); }}
                                placeholder="—"
                              />
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
                            <div className="field-group">
                              <span className="field-label">{p.cor}</span>
                              <input className="input" value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} />
                            </div>
                            <div className="field-group">
                              <span className="field-label">{p.nFibras}</span>
                              <input className="input" type="number" value={editForm.fiber_count} onChange={(e) => setEditForm({ ...editForm, fiber_count: e.target.value ? Number(e.target.value) : "" })} />
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
        </>
      )}
    </div>
  );
}
