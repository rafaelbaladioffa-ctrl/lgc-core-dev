import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { masterDataApi, sitesMapApi } from "../../api/resources";
import { useI18n } from "../../i18n";
import { entityLabels } from "../../pages/cadastros/registryConfig";
import type {
  CableAlias,
  CableSpec,
  GeneratedTaskDependency,
  ScopeItemGenerateTasksResult,
  ScopeItemResolutionResult,
  TaskTemplateStep,
} from "../../api/types";
import { useAuth } from "../../context/AuthContext";
import { PERMS, hasPerm } from "../../utils/permissions";
import type { EntityConfig, ReferenceData } from "../../pages/cadastros/registryConfig";
import BulkNamesModal from "../ui/BulkNamesModal";
import CsvImportModal from "../ui/CsvImportModal";
import DynamicForm, { type FormValues } from "../ui/DynamicForm";
import Icon from "../ui/Icon";
import Modal from "../ui/Modal";
import Pagination from "../ui/Pagination";
import { FilterTh, useColumnFilters } from "../ui/ColumnFilter";

type ApiErrors = Record<string, string[]>;

/** Painel de CRUD genérico e reutilizável — tabela/busca/paginação/
 * modal de criação-edição/CSV/ativar-inativar — dirigido inteiramente por
 * um `EntityConfig`. Usado tanto por Cadastros Gerais quanto por
 * Cadastros Mestres, para não duplicar essa lógica entre os dois. */
export default function EntityCrudPanel({
  entity,
  refs,
  refsLoaded,
  onBack,
  autoOpenCreateNonce,
  initialSearch,
}: {
  entity: EntityConfig<any>;
  refs: ReferenceData;
  refsLoaded: boolean;
  onBack?: () => void;
  /** Muda de valor sempre que o catálogo pedir para abrir esta entidade já
   * com o modal de criação aberto ("Novo cadastro" > escolher o tipo). */
  autoOpenCreateNonce?: number;
  /** Preenche a busca já ao abrir esta entidade — usado pelos links
   * contextuais da tela Importar SOW ("Abrir Itens de Escopo desta SOW"
   * etc.), que navegam pra cá já filtrados pelo código da importação. Só
   * lido na montagem/troca de entidade, não controla o campo depois. */
  initialSearch?: string;
}) {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const el = entityLabels(entity, locale);
  const canAdd = hasPerm(user, entity.perms.add) && !entity.disableCreate;
  const canChange = hasPerm(user, entity.perms.change);
  const canDelete = hasPerm(user, entity.perms.delete);
  const canChangeSite = hasPerm(user, PERMS.changeSite);
  const statusField = entity.statusField ?? "is_active";
  const showActionsColumn = canChange || (canDelete && !entity.disableHardDelete);

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Só usado pela Família de Cabo: aliases e specs apontando para o
  // registro em edição, mostrados como seções somente-leitura no modal (o
  // equivalente mais próximo de "tela de detalhes" que este painel genérico
  // tem hoje — ver EntityConfig/masterDataConfig para o resto da entidade).
  const [familyAliases, setFamilyAliases] = useState<CableAlias[]>([]);
  const [familyAliasesLoading, setFamilyAliasesLoading] = useState(false);
  const [familySpecs, setFamilySpecs] = useState<CableSpec[]>([]);
  const [familySpecsLoading, setFamilySpecsLoading] = useState(false);
  // Idem para Template de Tarefa: suas etapas, mostradas como tabela
  // somente-leitura no modal — a edição de verdade (adicionar/editar/
  // reordenar etapa) acontece em Cadastros Mestres > Operação > Etapas
  // dos Templates (filtrando por este template).
  const [templateSteps, setTemplateSteps] = useState<TaskTemplateStep[]>([]);
  const [templateStepsLoading, setTemplateStepsLoading] = useState(false);
  // Só usado por Itens de Escopo: resultado da última chamada a
  // "Resolver Template" (POST .../resolve-template/) dentro do modal —
  // não persiste entre aberturas de itens diferentes.
  const [scopeResolution, setScopeResolution] = useState<ScopeItemResolutionResult | null>(null);
  const [scopeResolving, setScopeResolving] = useState(false);
  const [scopeResolutionError, setScopeResolutionError] = useState<string | null>(null);
  // Idem para a geração de tarefas (POST .../generate-tasks/) a partir de
  // um Item de Escopo já resolvido — mesmo espírito do bloco acima.
  const [generateTasksResult, setGenerateTasksResult] = useState<ScopeItemGenerateTasksResult | null>(null);
  const [generatingTasks, setGeneratingTasks] = useState(false);
  const [generateTasksError, setGenerateTasksError] = useState<string | null>(null);
  // Só usado por Tarefas Geradas: dependências que apontam PARA (predecessoras)
  // e que partem DE (sucessoras) a tarefa em edição.
  const [taskPredecessors, setTaskPredecessors] = useState<GeneratedTaskDependency[]>([]);
  const [taskSuccessors, setTaskSuccessors] = useState<GeneratedTaskDependency[]>([]);
  const [taskDependenciesLoading, setTaskDependenciesLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<FormValues>({});
  const [formErrors, setFormErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [bulkCreateOpen, setBulkCreateOpen] = useState(false);
  const [regeocodingId, setRegeocodingId] = useState<number | null>(null);

  function reload() {
    setLoading(true);
    setLoadError(null);
    entity.api
      // page_size grande (o teto permitido pela API) porque este painel faz
      // busca/filtro/paginação no lado do cliente sobre `rows` — sem isso,
      // uma entidade com mais registros que o page_size padrão da API (25)
      // aparece truncada na primeira página, mesmo a contagem exibida
      // batendo com `rows.length` (nunca com o total real do backend).
      .list({ page_size: "500" })
      .then((data) => setRows(data.results))
      .catch(() => {
        // Nunca deixar a tabela anterior (de outra entidade) visível em
        // caso de falha — isso já causou confusão real: uma falha ao
        // trocar de aba deixava a listagem antiga na tela, parecendo
        // (incorretamente) que a nova entidade estava usando o dataset
        // errado.
        setRows([]);
        setLoadError(t.crud.erroCarregar(el.label.toLowerCase()));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    setSearch(initialSearch ?? "");
    setFilterValues({});
    setPage(1);
    setCsvImportOpen(false);
    setBulkCreateOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.key]);

  async function handleRegeocode(siteId: number) {
    setRegeocodingId(siteId);
    try {
      await sitesMapApi.regeocode(siteId);
      reload();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      alert(axiosErr.response?.data?.detail || t.crud.erroCarregar("este site"));
    } finally {
      setRegeocodingId(null);
    }
  }

  async function handleExportCsv() {
    const blob = await entity.api.exportCsv();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${entity.key}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const baseFiltered = useMemo(() => {
    let result = rows;
    for (const filter of entity.filters ?? []) {
      const value = filterValues[filter.key];
      if (value) result = result.filter((row) => String(row[filter.key] ?? "") === value);
    }
    if (search) {
      const lower = search.toLowerCase();
      result = result.filter((row) => JSON.stringify(row).toLowerCase().includes(lower));
    }
    return result;
  }, [rows, search, filterValues, entity.filters]);

  // Filtro por coluna (clicar no título): valores exatamente como aparecem na tabela.
  const columnAccessors: Record<string, (row: Record<string, unknown>) => string> = {};
  for (const col of entity.columns) {
    columnAccessors[col.key] = (row) => (col.render ? col.render(row as never) : String((row[col.key] as string | number) ?? "—")) || "—";
  }
  columnAccessors.__status = (row) => (row[statusField] ? t.common.ativo : t.common.inativo);
  const { filtered, filters: colFilters } = useColumnFilters(baseFiltered, columnAccessors);
  useEffect(() => {
    colFilters.clearAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.key]);
  useEffect(() => {
    setPage(1);
  }, [colFilters.selected]);

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  function openCreate() {
    if (!canAdd) return;
    setEditingId(null);
    setFormValues(entity.emptyValues);
    setFormErrors({});
    setFamilyAliases([]);
    setFamilySpecs([]);
    setTemplateSteps([]);
    setScopeResolution(null);
    setScopeResolutionError(null);
    setGenerateTasksResult(null);
    setGenerateTasksError(null);
    setTaskPredecessors([]);
    setTaskSuccessors([]);
    setModalOpen(true);
  }

  useEffect(() => {
    if (autoOpenCreateNonce != null) openCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenCreateNonce]);

  function openEdit(row: Record<string, unknown>) {
    if (!canChange) return;
    setEditingId(row.id as number);
    setFormValues({ ...row });
    setFormErrors({});
    setScopeResolution(null);
    setScopeResolutionError(null);
    setGenerateTasksResult(null);
    setGenerateTasksError(null);
    setModalOpen(true);
    if (entity.key === "cable-families") {
      setFamilyAliasesLoading(true);
      masterDataApi.cableAliases
        .list({ cable_family: String(row.id) })
        .then((data) => setFamilyAliases(data.results))
        .finally(() => setFamilyAliasesLoading(false));
      setFamilySpecsLoading(true);
      masterDataApi.cableSpecs
        .list({ cable_family: String(row.id) })
        .then((data) => setFamilySpecs(data.results))
        .finally(() => setFamilySpecsLoading(false));
    } else {
      setFamilyAliases([]);
      setFamilySpecs([]);
    }
    if (entity.key === "task-templates") {
      setTemplateStepsLoading(true);
      masterDataApi.taskTemplateSteps
        .list({ task_template: String(row.id) })
        .then((data) => setTemplateSteps([...data.results].sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))))
        .finally(() => setTemplateStepsLoading(false));
    } else {
      setTemplateSteps([]);
    }
    if (entity.key === "generated-tasks") {
      setTaskDependenciesLoading(true);
      Promise.all([
        masterDataApi.generatedTaskDependencies.list({ successor_task: String(row.id) }),
        masterDataApi.generatedTaskDependencies.list({ predecessor_task: String(row.id) }),
      ])
        .then(([predecessors, successors]) => {
          setTaskPredecessors(predecessors.results);
          setTaskSuccessors(successors.results);
        })
        .finally(() => setTaskDependenciesLoading(false));
    } else {
      setTaskPredecessors([]);
      setTaskSuccessors([]);
    }
  }

  async function handleSave() {
    if (editingId && !canChange) return;
    if (!editingId && !canAdd) return;
    setSaving(true);
    setFormErrors({});
    try {
      if (editingId) {
        await entity.api.update(editingId, formValues);
      } else {
        await entity.api.create(formValues);
      }
      setModalOpen(false);
      reload();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: ApiErrors } };
      if (axiosErr.response?.data) {
        setFormErrors(axiosErr.response.data);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleResolveTemplate() {
    if (!editingId) return;
    setScopeResolving(true);
    setScopeResolutionError(null);
    try {
      const result = await masterDataApi.scopeItems.resolveTemplate(editingId);
      setScopeResolution(result);
      reload();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setScopeResolutionError(axiosErr.response?.data?.detail || t.crud.erroCarregar("o template"));
      setScopeResolution(null);
    } finally {
      setScopeResolving(false);
    }
  }

  async function handleGenerateTasks() {
    if (!editingId) return;
    const templateCode = scopeResolution?.selected_template?.code || (formValues.resolved_template_code as string | undefined);
    const stepCount = scopeResolution?.steps?.length;
    const question =
      stepCount != null
        ? `Serão geradas ${stepCount} tarefas com base no template ${templateCode}.`
        : `Gerar tarefas com base no template ${templateCode || "resolvido"}?`;
    if (!window.confirm(question)) return;
    setGeneratingTasks(true);
    setGenerateTasksError(null);
    try {
      const result = await masterDataApi.scopeItems.generateTasks(editingId);
      setGenerateTasksResult(result);
      reload();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setGenerateTasksError(axiosErr.response?.data?.detail || t.crud.erroCarregar("as tarefas"));
      setGenerateTasksResult(null);
    } finally {
      setGeneratingTasks(false);
    }
  }

  async function handleDelete(row: Record<string, unknown>) {
    if (!canDelete) return;
    const label = entity.rowLabel(row as never);
    if (!window.confirm(t.crud.excluirConfirm(label))) return;
    await entity.api.remove(row.id as number);
    reload();
  }

  async function handleToggleActive(row: Record<string, unknown>) {
    if (!canChange) return;
    const label = entity.rowLabel(row as never);
    const isActive = !!row[statusField];
    const question = isActive ? t.crud.inativarConfirm(label) : t.crud.reativarConfirm(label);
    if (!window.confirm(question)) return;
    await entity.api.update(row.id as number, { [statusField]: !isActive } as never);
    reload();
  }

  // Só usado por Itens de Escopo: ação rápida direto na grade (sem abrir
  // o modal) — mesmo endpoint idempotente de "Gerar Tarefas" já usado
  // dentro do modal, só exposto de um jeito mais visível (ver pedido de
  // fechamento do fluxo SOW -> ScopeItem -> Tarefas Geradas).
  async function handleQuickGenerateTasks(row: Record<string, unknown>) {
    const label = entity.rowLabel(row as never);
    const template = (row.resolved_template_code as string) || "(nenhum)";
    const expansionNote =
      row.expansion_mode === "PATH" ? " Este item expande por Path (uma tarefa por rota ativa)." : "";
    const alreadyNote = row.has_generated_tasks
      ? " Já existem tarefas geradas para este item — gerar de novo não duplica."
      : "";
    if (!window.confirm(`Gerar tarefas para "${label}" usando o template ${template}?${expansionNote}${alreadyNote}`)) {
      return;
    }
    try {
      const result = await masterDataApi.scopeItems.generateTasks(row.id as number);
      window.alert(
        t.crud.tarefasCriadasExistentes(result.created_count, result.existing_count) + "\n" +
          t.crud.dependenciasCriadasExistentes(result.created_dependencies.length, result.existing_dependencies.length)
      );
      reload();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      window.alert(axiosErr.response?.data?.detail || t.crud.erroCarregar("as tarefas"));
    }
  }

  const [bulkGeneratingTasks, setBulkGeneratingTasks] = useState(false);

  async function handleBulkGenerateTasks() {
    if (
      !window.confirm(
        "Gerar tarefas para todos os Itens de Escopo prontos (regra e template resolvidos, ativos)? Itens que já têm tarefas não são duplicados."
      )
    ) {
      return;
    }
    setBulkGeneratingTasks(true);
    try {
      const result = await masterDataApi.scopeItems.generateTasksBulk();
      window.alert(
        `${result.scope_items_processed} item(ns) processado(s).\n` +
          `Tarefas — Criadas: ${result.tasks_created} · Já existentes: ${result.tasks_existing}\n` +
          `Dependências — Criadas: ${result.dependencies_created} · Já existentes: ${result.dependencies_existing}` +
          (result.errors.length > 0 ? `\n${result.errors.length} erro(s): ${result.errors.map((e) => e.detail).join(" ")}` : "")
      );
      reload();
    } finally {
      setBulkGeneratingTasks(false);
    }
  }

  const fields = refsLoaded ? entity.fields(refs) : [];

  return (
    <div>
      {onBack && (
        <button
          onClick={onBack}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: "var(--text-muted)",
            background: "none",
            border: 0,
            cursor: "pointer",
            fontSize: 13,
            marginBottom: 12,
            padding: 0,
          }}
        >
          <Icon name="arrow_back" style={{ fontSize: 16 }} />
          {t.common.voltar}
        </button>
      )}

      <div className="card">
        <div className="toolbar">
          <div>
            <div className="toolbar-title">{el.label}</div>
            <div className="toolbar-subtitle">{t.crud.registrosEncontrados(filtered.length)}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {entity.key === "sites" && (
              <Link to="/sites/mapa" className="btn btn-outline">
                <Icon name="map" style={{ fontSize: 16 }} />
                {t.crud.verMapa}
              </Link>
            )}
            <button className="btn btn-outline" onClick={handleExportCsv}>
              <Icon name="download" style={{ fontSize: 16 }} />
              {t.crud.exportarCsv}
            </button>
            {canAdd && (
              <button className="btn btn-outline" onClick={() => setCsvImportOpen(true)}>
                <Icon name="upload" style={{ fontSize: 16 }} />
                {t.crud.importarCsv}
              </button>
            )}
            {canAdd && entity.bulkCreate && (
              <button className="btn btn-outline" onClick={() => setBulkCreateOpen(true)}>
                <Icon name="playlist_add" style={{ fontSize: 16 }} />
                {t.crud.adicionarVarios}
              </button>
            )}
            {canChange && entity.key === "scope-items" && (
              <button className="btn btn-outline" onClick={handleBulkGenerateTasks} disabled={bulkGeneratingTasks}>
                <Icon name="playlist_add_check" style={{ fontSize: 16 }} />
                {bulkGeneratingTasks ? t.crud.gerando : t.crud.gerarTarefasItens}
              </button>
            )}
            {canAdd && (
              <button className="btn btn-primary" onClick={openCreate}>
                <Icon name="add" style={{ fontSize: 18 }} />
                {el.createLabel}
              </button>
            )}
          </div>
        </div>

        <div className="filter-row">
          <div className="search-input-wrap" style={{ flex: 1 }}>
            <Icon name="search" />
            <input
              className="input"
              placeholder={t.crud.buscarEm(el.label)}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          {entity.filters?.map((filter) => (
            <select
              key={filter.key}
              className="select"
              style={{ maxWidth: 220 }}
              value={filterValues[filter.key] ?? ""}
              onChange={(e) => {
                setFilterValues((prev) => ({ ...prev, [filter.key]: e.target.value }));
                setPage(1);
              }}
            >
              <option value="">{filter.label}</option>
              {filter.options(refs, rows).map((opt) => (
                <option key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </select>
          ))}
        </div>

        {loadError && (
          <p style={{ padding: "0 20px 12px", color: "var(--red)", fontSize: 13.5 }}>{loadError}</p>
        )}

        {loading ? (
          <p style={{ padding: 20, color: "var(--text-muted)" }}>{t.common.carregando}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {entity.columns.map((col) => (
                    <FilterTh key={col.key} colKey={col.key} label={col.label} filters={colFilters} />
                  ))}
                  <FilterTh colKey="__status" label={t.crud.situacao} filters={colFilters} />
                  {showActionsColumn && <th>{t.crud.acoes}</th>}
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => (
                  <tr key={row.id as number}>
                    {entity.columns.map((col) => (
                      <td key={col.key}>
                        {col.render ? col.render(row as never) : String((row[col.key] as string | number) ?? "—") || "—"}
                      </td>
                    ))}
                    <td>
                      <span
                        className="badge"
                        style={{
                          background: row[statusField] ? "var(--green-soft)" : "#eef1f6",
                          color: row[statusField] ? "var(--green)" : "var(--text-muted)",
                        }}
                      >
                        {row[statusField] ? t.common.ativo : t.common.inativo}
                      </span>
                    </td>
                    {showActionsColumn && (
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          {canChange && (
                            <button className="btn btn-outline btn-sm" onClick={() => openEdit(row)}>
                              <Icon name="edit" style={{ fontSize: 14 }} />
                            </button>
                          )}
                          {canChange &&
                            entity.key === "scope-items" &&
                            (row.operational_status === "READY_TO_GENERATE" || row.operational_status === "TASKS_GENERATED") && (
                              <button
                                className="btn btn-outline btn-sm"
                                onClick={() => handleQuickGenerateTasks(row)}
                                title={t.crud.gerarTarefas}
                              >
                                <Icon name="playlist_add_check" style={{ fontSize: 14 }} />
                              </button>
                            )}
                          {entity.disableHardDelete
                            ? canChange && (
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={() => handleToggleActive(row)}
                                  title={row[statusField] ? t.crud.inativar : t.crud.reativar}
                                >
                                  <Icon name={row[statusField] ? "toggle_on" : "toggle_off"} style={{ fontSize: 14 }} />
                                </button>
                              )
                            : canDelete && (
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={() => handleDelete(row)}
                                  style={{ color: "var(--red)" }}
                                >
                                  <Icon name="delete" style={{ fontSize: 14 }} />
                                </button>
                              )}
                          {entity.key === "scope-items" &&
                            (row.operational_status === "READY_TO_GENERATE" || row.operational_status === "TASKS_GENERATED") &&
                            Boolean(row.source_reference) && (
                              <Link
                                className="btn btn-outline btn-sm"
                                to={`/cadastros-mestres?focusEntity=project-plan&planSow=${encodeURIComponent(row.source_reference as string)}`}
                                title="Ver no Plano do Projeto"
                              >
                                <Icon name="checklist" style={{ fontSize: 14 }} />
                              </Link>
                            )}
                          {entity.key === "generated-tasks" && Boolean(row.scope_item_source_reference) && (
                            <Link
                              className="btn btn-outline btn-sm"
                              to={`/cadastros-mestres?focusEntity=project-plan&planSow=${encodeURIComponent(row.scope_item_source_reference as string)}`}
                              title="Criar tarefas no projeto"
                            >
                              <Icon name="checklist" style={{ fontSize: 14 }} />
                            </Link>
                          )}
                          {entity.key === "sites" && canChangeSite && !row.manual_coordinates && (
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => handleRegeocode(row.id as number)}
                              disabled={regeocodingId === row.id}
                              title="Regeocodificar"
                            >
                              <Icon name="my_location" style={{ fontSize: 14 }} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={entity.columns.length + 2}>
                      <div className="table-empty">{t.crud.nenhumRegistro}</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>

      {modalOpen && (editingId ? canChange : canAdd) && (
        <Modal
          title={editingId ? t.crud.editar(el.singular) : el.createLabel}
          onClose={() => setModalOpen(false)}
          width={620}
        >
          <DynamicForm
            fields={fields}
            values={formValues}
            errors={formErrors}
            onChange={(name, value) => setFormValues((prev) => ({ ...prev, [name]: value }))}
          />
          {formErrors.non_field_errors && (
            <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{formErrors.non_field_errors.join(" ")}</p>
          )}
          {editingId && entity.key === "scope-items" && Boolean(formValues.tasks_outdated) && (
            <p style={{ color: "var(--amber)", fontSize: 13, marginTop: 8 }}>
              {t.crud.tarefasDesatualizadas}
            </p>
          )}
          {editingId && entity.key === "scope-items" && (
            <div style={{ marginTop: 8, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-faint)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {t.crud.resolucaoTemplate}
                </div>
                <button className="btn btn-outline btn-sm" onClick={handleResolveTemplate} disabled={scopeResolving}>
                  <Icon name="rule" style={{ fontSize: 14 }} />
                  {scopeResolving ? t.crud.resolvendo : t.crud.resolverTemplate}
                </button>
              </div>
              {scopeResolutionError && (
                <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{scopeResolutionError}</p>
              )}
              {scopeResolution && !scopeResolution.selected_rule && (
                <div className="empty-state" style={{ padding: 16 }}>
                  {t.crud.resolucaoNenhumaRegra}
                </div>
              )}
              {scopeResolution && scopeResolution.selected_rule && scopeResolution.selected_template && (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 14 }}>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)", marginBottom: 4 }}>{t.crud.regra}</p>
                      <p style={{ fontSize: 13, margin: 0 }}>
                        {scopeResolution.selected_rule.code} — {scopeResolution.selected_rule.name}
                      </p>
                      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                        {t.crud.prioridade} {scopeResolution.selected_rule.priority} · {t.crud.especificidade}{" "}
                        {scopeResolution.selected_rule.specificity_score}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)", marginBottom: 4 }}>Template</p>

                      <p style={{ fontSize: 13, margin: 0 }}>
                        {scopeResolution.selected_template.code} — {scopeResolution.selected_template.name}
                      </p>
                      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                        {scopeResolution.selected_template.category} · {scopeResolution.selected_template.medium || "—"}
                      </p>
                    </div>
                  </div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)", marginBottom: 8 }}>
                    {t.crud.etapasGeradas(scopeResolution.steps.length)}
                  </p>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{t.crud.ordem}</th>
                          <th>{t.crud.atividade}</th>
                          <th>{t.crud.nomeEfetivo}</th>
                          <th>{t.crud.obrigatoria}</th>
                          <th>{t.crud.repetivel}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scopeResolution.steps.map((s) => (
                          <tr key={s.step_order}>
                            <td>{s.step_order}</td>
                            <td>{s.activity_code}</td>
                            <td>{s.effective_name}</td>
                            <td>{s.required ? t.common.sim : t.common.nao}</td>
                            <td>{s.repeatable ? t.common.sim : t.common.nao}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {scopeResolution.matches.length > 1 && (
                    <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 8 }}>
                      {t.crud.outrasRegras}{" "}
                      {scopeResolution.matches
                        .slice(1)
                        .map((m) => m.rule.code)
                        .join(", ")}
                    </p>
                  )}
                </div>
              )}
              <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 10 }}>
                {t.crud.resolucaoNota}
              </p>
            </div>
          )}
          {editingId && entity.key === "scope-items" && formValues.rule_resolution_status === "RESOLVED" && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-faint)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {t.crud.geracaoTarefas}
                </div>
                <button className="btn btn-outline btn-sm" onClick={handleGenerateTasks} disabled={generatingTasks}>
                  <Icon name="playlist_add_check" style={{ fontSize: 14 }} />
                  {generatingTasks ? t.crud.gerando : t.crud.gerarTarefas}
                </button>
              </div>
              {generateTasksError && (
                <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{generateTasksError}</p>
              )}
              {generateTasksResult && (
                <div>
                  <p style={{ fontSize: 13, marginBottom: 4 }}>
                    {t.crud.tarefasCriadasExistentes(generateTasksResult.created_count, generateTasksResult.existing_count)}
                  </p>
                  <p style={{ fontSize: 13, marginBottom: 8 }}>
                    {t.crud.dependenciasCriadasExistentes(generateTasksResult.created_dependencies.length, generateTasksResult.existing_dependencies.length)}
                  </p>
                  {generateTasksResult.warnings.length > 0 &&
                    generateTasksResult.warnings.map((w, i) => (
                      <p key={i} style={{ color: "var(--amber)", fontSize: 13, margin: "0 0 4px" }}>
                        ⚠ {w}
                      </p>
                    ))}
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{t.crud.ordem}</th>
                          <th>{t.crud.atividade}</th>
                          <th>{t.crud.tarefa}</th>
                          <th>Path</th>
                          <th>{t.crud.quantidade}</th>
                          <th>{t.crud.unidade}</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {generateTasksResult.tasks.map((task) => (
                          <tr key={task.id}>
                            <td>{task.step_order}</td>
                            <td>{task.activity_code}</td>
                            <td>{task.name}</td>
                            <td>{task.path_code || "—"}</td>
                            <td>{task.quantity ?? "—"}</td>
                            <td>{task.unit || "—"}</td>
                            <td>{task.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 10 }}>
                {t.crud.geracaoNota}
              </p>
            </div>
          )}
          {editingId && entity.key === "generated-tasks" && (
            <div style={{ marginTop: 8, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                {t.crud.predecessoras(taskPredecessors.length)}
              </div>
              {taskDependenciesLoading ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.common.carregando}</p>
              ) : taskPredecessors.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.crud.nenhumaDependenciaPredecessora}</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text)" }}>
                  {taskPredecessors.map((d) => (
                    <li key={d.id}>
                      {d.predecessor_task_code} — {d.predecessor_task_name} ({d.dependency_type})
                    </li>
                  ))}
                </ul>
              )}
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginTop: 14,
                  marginBottom: 8,
                }}
              >
                {t.crud.sucessoras(taskSuccessors.length)}
              </div>
              {taskDependenciesLoading ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.common.carregando}</p>
              ) : taskSuccessors.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.crud.nenhumaDependenciaSuccessora}</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text)" }}>
                  {taskSuccessors.map((d) => (
                    <li key={d.id}>
                      {d.successor_task_code} — {d.successor_task_name} ({d.dependency_type})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {editingId && entity.key === "cable-families" && (
            <div style={{ marginTop: 8, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                {t.crud.aliases(familyAliases.length)}
              </div>
              {familyAliasesLoading ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.common.carregando}</p>
              ) : familyAliases.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.crud.nenhumAlias}</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text)" }}>
                  {familyAliases.map((a) => (
                    <li key={a.id}>
                      {a.alias}
                      {a.alias_type ? ` (${a.alias_type})` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {editingId && entity.key === "cable-families" && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                {t.crud.especificacoes(familySpecs.length)}
              </div>
              {familySpecsLoading ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.common.carregando}</p>
              ) : familySpecs.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.crud.nenhumaEspecificacao}</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text)" }}>
                  {familySpecs.map((s) => (
                    <li key={s.id}>
                      {s.code}
                      {s.part_number ? ` (${s.part_number})` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {editingId && entity.key === "task-templates" && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                {t.crud.etapasTemplate(templateSteps.length)}
              </div>
              {templateStepsLoading ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.common.carregando}</p>
              ) : templateSteps.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.crud.nenhumaEtapa}</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t.crud.ordem}</th>
                        <th>{t.crud.atividade}</th>
                        <th>{t.crud.nomeEfetivo}</th>
                        <th>{t.crud.obrigatoria}</th>
                        <th>{t.crud.repetivel}</th>
                        <th>{t.crud.origemQuantidade}</th>
                        <th>{t.crud.unidade}</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {templateSteps.map((s) => (
                        <tr key={s.id}>
                          <td>{s.step_order}</td>
                          <td>{s.activity_code}</td>
                          <td>{s.effective_name}</td>
                          <td>{s.required ? t.common.sim : t.common.nao}</td>
                          <td>{s.repeatable ? t.common.sim : t.common.nao}</td>
                          <td>{s.quantity_source || "—"}</td>
                          <td>{s.unit_override || "—"}</td>
                          <td>{s.active ? t.common.ativo : t.common.inativo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 8 }}>
                {t.crud.etapasNota}
              </p>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <button className="btn btn-outline" onClick={() => setModalOpen(false)}>
              {t.common.cancelar}
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? t.common.salvando : t.common.salvar}
            </button>
          </div>
        </Modal>
      )}

      {csvImportOpen && canAdd && (
        <CsvImportModal
          title={t.crud.importarTitle(el.label)}
          onClose={() => setCsvImportOpen(false)}
          onImport={entity.api.importCsv}
          onImported={reload}
        />
      )}

      {bulkCreateOpen && canAdd && entity.bulkCreate && refsLoaded && (
        <BulkNamesModal
          title={`${t.crud.adicionarVarios} — ${el.label}`}
          helpText={entity.bulkCreate.helpText}
          extraFields={entity.bulkCreate.extraFields(refs)}
          extraValues={entity.bulkCreate.extraValues(refs)}
          onSave={entity.bulkCreate.api}
          onClose={() => setBulkCreateOpen(false)}
          onSaved={() => {
            setBulkCreateOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
