import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FormPage, FormSection, fieldStyle, labelStyle } from '../components/layout/FormPage';
import { formatBRL } from '../utils/format';
import { requestCategoriesApi, type RequestCategory, type RequestFormField, type RequestFieldOptionsSource } from '../api/requestCategories';
import { requestsApi, type CreateRequestInput, type RequestDetail } from '../api/requests';
import { projectsApi, type Project } from '../api/projects';
import { collaboratorsApi, type CollaboratorSafe } from '../api/collaborators';
import { clientsApi, type Client } from '../api/clients';
import { costCentersApi, type CostCenter } from '../api/costCenters';
import { jobTitlesApi, type JobTitle } from '../api/jobTitles';
import { sectorsApi, type Sector } from '../api/sectors';
import { logisticsCatalogApi, type LogisticsCatalogItem } from '../api/logisticsCatalog';
import { translateApiError } from '../utils/apiError';

interface OptionSourceData {
  projects: Project[];
  collaborators: CollaboratorSafe[];
  clients: Client[];
  cost_centers: CostCenter[];
  job_titles: JobTitle[];
}

function optionLabel(source: RequestFieldOptionsSource, item: Project | CollaboratorSafe | Client | CostCenter | JobTitle): string {
  switch (source) {
    case 'projects':
      return (item as Project).code;
    case 'collaborators':
      return (item as CollaboratorSafe).fullName;
    case 'clients':
      return (item as Client).legalName;
    case 'cost_centers':
      return `${(item as CostCenter).code} — ${(item as CostCenter).name}`;
    case 'job_titles':
      return (item as JobTitle).name;
  }
}

function isFieldEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);
}

const emptyForm: Omit<CreateRequestInput, 'categoryId'> = { title: '', description: '', priority: 'normal' };

/** Chaves de `formData` que só o servidor grava (análise/cotações do Suprimentos); nunca vão no PUT. */
const SERVER_FORM_KEYS = ['procurementAnalysis', 'procurementQuotations', 'procurementQuotation', 'selectedQuotationId'];

interface PurchaseRow { materialId: string; quantity: number; }

/** "Nova requisição" — simplificada em uma única página (categoria + dados + campos dinâmicos),
 * em vez do stepper Categoria → Dados → Revisão → Envio do §15.1.2: o `FormPage` compartilhado já
 * cobre autosave de rascunho? Não — Fase 1 cria o rascunho só ao enviar (ver nota de simplificação
 * em requests.service.ts); o stepper visual fica para a Fase 2. */
export function NewRequestPage() {
  const navigate = useNavigate();
  // Com `:id` na rota (`/requests/:id/edit`) a página edita e reenvia uma requisição em
  // rascunho/devolvida para ajuste: categoria fixa, `PUT` e depois `submit`.
  const { id: editId } = useParams<{ id: string }>();
  const isEditing = Boolean(editId);
  const [editLoaded, setEditLoaded] = useState(!editId);
  const [searchParams] = useSearchParams();
  const [categories, setCategories] = useState<RequestCategory[]>([]);
  const [optionData, setOptionData] = useState<OptionSourceData>({ projects: [], collaborators: [], clients: [], cost_centers: [], job_titles: [] });
  const [requester, setRequester] = useState<CollaboratorSafe | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [purchaseCatalog, setPurchaseCatalog] = useState<LogisticsCatalogItem[]>([]);
  // Disponível em estoque por materialId — ver logisticsCatalogApi.availability.
  const [stockAvailability, setStockAvailability] = useState<Record<string, string>>({});
  const [purchaseRows, setPurchaseRows] = useState<PurchaseRow[]>([]);
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [purchaseCategory, setPurchaseCategory] = useState('');
  const [purchaseSubcategory, setPurchaseSubcategory] = useState('');
  const [purchaseItemSelection, setPurchaseItemSelection] = useState('');
  const [categoryId, setCategoryId] = useState(searchParams.get('categoryId') ?? '');
  const [pickerSectorId, setPickerSectorId] = useState('');
  const parentRequestId = searchParams.get('parentRequestId') ?? undefined;
  const [form, setForm] = useState(emptyForm);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [editRequest, setEditRequest] = useState<RequestDetail | null>(null);

  useEffect(() => {
    if (!editId) return;
    void requestsApi
      .get(editId)
      .then((request) => {
        if (!['rascunho', 'devolvida_ajuste'].includes(request.status)) {
          setError('Só é possível editar uma requisição em rascunho ou devolvida para ajuste.');
          return;
        }
        setEditRequest(request);
        setCategoryId(request.categoryVersion.category.id);
        setForm({
          title: request.title,
          description: request.description,
          priority: request.priority,
          neededBy: request.neededBy ? request.neededBy.slice(0, 10) : undefined,
          costCenterId: request.costCenter?.id,
        });
        const data = request.formData && typeof request.formData === 'object' ? { ...(request.formData as Record<string, unknown>) } : {};
        for (const key of SERVER_FORM_KEYS) delete data[key];
        const rows = Array.isArray(data.purchaseItems) ? (data.purchaseItems as Array<{ materialId: string; quantity: number }>) : [];
        setPurchaseRows(rows.map((row) => ({ materialId: row.materialId, quantity: Number(row.quantity) || 1 })));
        delete data.purchaseItems;
        setFormValues(data);
        setEditLoaded(true);
      })
      .catch((err) => setError(translateApiError(err, 'Não foi possível carregar a requisição para edição.')));
  }, [editId]);

  useEffect(() => {
    void Promise.all([requestCategoriesApi.list(), projectsApi.list(), collaboratorsApi.list(), clientsApi.list(), costCentersApi.list(), jobTitlesApi.list(), collaboratorsApi.me(), sectorsApi.list()]).then(
      ([c, projects, collaborators, clients, costCenters, jobTitles, me, sectorList]) => {
        setCategories(c);
        setOptionData({ projects, collaborators, clients, cost_centers: costCenters, job_titles: jobTitles });
        setRequester(me);
        setSectors(sectorList);
      },
    );
  }, []);

  // Setor → requisição em cascata (em vez de uma lista única com todas as categorias): só setores
  // com ao menos uma categoria publicada aparecem no primeiro select.
  const sectorsWithCategories = useMemo(
    () => sectors.filter((s) => categories.some((c) => c.sectorId === s.id)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [sectors, categories],
  );
  const categoriesForSector = useMemo(
    () => categories.filter((c) => c.sectorId === pickerSectorId).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [categories, pickerSectorId],
  );

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const customFields: RequestFormField[] = useMemo(() => selectedCategory?.currentVersion?.formSchema ?? [], [selectedCategory]);
  const isPurchaseRequest = selectedCategory?.kind === 'compra_material';
  const requesterSector = requester ? sectors.find((sector) => sector.id === requester.sectorId) : null;
  const requesterParentSector = requesterSector?.parentSectorId ? sectors.find((sector) => sector.id === requesterSector.parentSectorId) : null;
  const purchaseTitle = requesterSector ? `Compra de Materiais - ${requesterParentSector ? `${requesterParentSector.name}/${requesterSector.name}` : requesterSector.name}` : 'Compra de Materiais';

  useEffect(() => {
    if (!isPurchaseRequest) { setPurchaseCatalog([]); setStockAvailability({}); if (!isEditing) setPurchaseRows([]); return; }
    void logisticsCatalogApi
      .list()
      .then((items) => {
        setPurchaseCatalog(items);
        return logisticsCatalogApi.availability(items.map((item) => item.id));
      })
      .then((rows) => setStockAvailability(Object.fromEntries(rows.map((row) => [row.material_id, row.available]))))
      .catch(() => setError('Não foi possível carregar o catálogo da Logística.'));
  }, [isPurchaseRequest, isEditing]);

  /** "3 disponíveis em estoque" / "1 disponível em estoque" — vazio enquanto a consulta de
   * disponibilidade (segunda chamada, depois do catálogo) ainda não voltou para este item. */
  function stockLabel(materialId: string): string {
    const raw = stockAvailability[materialId];
    if (raw === undefined) return '';
    const n = Number(raw);
    return `${n.toLocaleString('pt-BR')} ${n === 1 ? 'disponível' : 'disponíveis'} em estoque`;
  }

  function pickCategory(id: string) {
    setCategoryId(id);
    setFormValues({});
    setPurchaseRows([]);
  }

  const purchaseCategories = useMemo(() => [...new Set(purchaseCatalog.map((item) => item.category))].sort(), [purchaseCatalog]);
  const purchaseSubcategories = useMemo(
    () => [...new Set(purchaseCatalog.filter((item) => !purchaseCategory || item.category === purchaseCategory).map((item) => item.subcategory || 'Sem subcategoria'))].sort(),
    [purchaseCatalog, purchaseCategory],
  );
  // Um item já adicionado some das três listas (busca, categoria/subcategoria/item): além de não
  // ter sentido escolhê-lo de novo (vira no-op silencioso — addPurchaseRow ignora duplicata), ele
  // já está visível na lista de itens adicionados logo abaixo, com seu campo de quantidade.
  const addedMaterialIds = useMemo(() => new Set(purchaseRows.map((row) => row.materialId)), [purchaseRows]);
  const purchaseItems = useMemo(
    () => purchaseCatalog.filter((item) => !addedMaterialIds.has(item.id) && (!purchaseCategory || item.category === purchaseCategory) && (!purchaseSubcategory || (item.subcategory || 'Sem subcategoria') === purchaseSubcategory)),
    [purchaseCatalog, purchaseCategory, purchaseSubcategory, addedMaterialIds],
  );
  const purchaseSearchResults = useMemo(() => {
    const query = purchaseSearch.trim().toLowerCase();
    if (!query) return [];
    return purchaseCatalog.filter((item) => !addedMaterialIds.has(item.id) && `${item.code} ${item.shortDescription} ${item.category} ${item.subcategory ?? ''}`.toLowerCase().includes(query)).slice(0, 20);
  }, [purchaseCatalog, purchaseSearch, addedMaterialIds]);

  function addPurchaseRow(materialId: string) {
    if (!materialId || purchaseRows.some((row) => row.materialId === materialId)) return;
    setPurchaseRows((rows) => [...rows, { materialId, quantity: 1 }]);
    setPurchaseItemSelection('');
  }

  function setFieldValue(key: string, value: unknown) {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!categoryId) {
      setError('Selecione uma categoria.');
      return;
    }
    if (!form.costCenterId) {
      setError('Selecione o centro de custo.');
      return;
    }
    if (isPurchaseRequest && purchaseRows.length === 0) {
      setError('Selecione ao menos um item da Logística.');
      return;
    }
    for (const field of isPurchaseRequest ? [] : customFields) {
      if (field.required && isFieldEmpty(formValues[field.key])) {
        setError(`Campo obrigatório: ${field.label}`);
        return;
      }
    }

    if (isPurchaseRequest && purchaseRows.some((row) => !purchaseCatalog.some((item) => item.id === row.materialId))) {
      setError('Aguarde o catálogo da Logística carregar ou remova itens que não estão mais disponíveis.');
      return;
    }

    try {
      const items = purchaseRows.map((row) => {
        const material = purchaseCatalog.find((item) => item.id === row.materialId)!;
        return { materialId: material.id, code: material.code, item: material.shortDescription, category: material.category, subcategory: material.subcategory, unit: material.unit, quantity: row.quantity, unitPrice: material.unitPrice };
      });
      const purchaseTotal = items.reduce((total, item) => total + item.quantity * Number(item.unitPrice ?? 0), 0).toFixed(2);
      const formData = isPurchaseRequest ? { purchaseItems: items } : customFields.length > 0 ? formValues : undefined;
      if (editId) {
        // Salvar e reenviar: se o envio falhar depois do PUT, os dados já estão salvos e o erro
        // fica na tela (o botão tenta o envio de novo, regravando os mesmos dados).
        try {
          await requestsApi.update(editId, {
            title: isPurchaseRequest ? undefined : form.title,
            description: form.description,
            priority: form.priority,
            neededBy: form.neededBy || undefined,
            costCenterId: form.costCenterId,
            estimatedValue: isPurchaseRequest ? undefined : form.estimatedValue,
            formData,
          });
        } catch (err) {
          setError(translateApiError(err, 'Não foi possível salvar as alterações.'));
          return;
        }
        try {
          await requestsApi.submit(editId);
        } catch (err) {
          setError(`As alterações foram salvas, mas o reenvio falhou. ${translateApiError(err, 'Tente reenviar novamente.')}`);
          return;
        }
        navigate(`/requests/${editId}`);
        return;
      }
      const created = await requestsApi.create({ ...form, categoryId, title: isPurchaseRequest ? purchaseTitle : form.title, estimatedValue: isPurchaseRequest ? purchaseTotal : form.estimatedValue, parentRequestId, formData });
      await requestsApi.submit(created.id);
      navigate(`/requests/${created.id}`);
    } catch (err) {
      setError(translateApiError(err, 'Erro ao abrir requisição.'));
    }
  };

  return (
    <FormPage
      breadcrumb={isEditing ? ['Axis', 'Requisições', editRequest?.code ?? 'Editar'] : ['Axis', 'Requisições', 'Nova']}
      onSubmit={onSubmit}
      onCancel={() => navigate(isEditing ? `/requests/${editId}` : '/requests')}
      error={error}
      submitLabel={isEditing ? 'Salvar e reenviar' : 'Enviar requisição'}
    >
      {isEditing && !editLoaded && !error && <p>Carregando...</p>}
      {!categoryId && !isEditing && (
        <FormSection title="Categoria">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Setor</label>
              <select
                value={pickerSectorId}
                onChange={(e) => setPickerSectorId(e.target.value)}
                required
              >
                <option value="">Selecione o setor</option>
                {sectorsWithCategories.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            {pickerSectorId && (
              <div style={fieldStyle}>
                <label style={labelStyle}>Requisição</label>
                <select value={categoryId} onChange={(e) => pickCategory(e.target.value)} required>
                  <option value="">Selecione a requisição</option>
                  {categoriesForSector.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </FormSection>
      )}

      {categoryId && editLoaded && (
        <FormSection title={isEditing && editRequest ? `Dados da requisição — ${editRequest.categoryVersion.category.name}` : 'Dados da requisição'}>
          <div className="request-form">
            {isPurchaseRequest ? <input value={purchaseTitle} readOnly aria-label="Título da requisição" /> : <input placeholder="Título (10-120 caracteres)" aria-label="Título da requisição" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={10} maxLength={120} />}
            <div className="request-form-grid">
              <div className="request-form-field">
                <label htmlFor="request-requester">Solicitante</label>
                <input id="request-requester" value={requester?.fullName ?? ''} readOnly />
              </div>
              <div className="request-form-field">
                <label htmlFor="request-priority">Prioridade</label>
                <select id="request-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as CreateRequestInput['priority'] })}>
                  <option value="baixa">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="alta">Alta</option>
                  <option value="critica">Crítica</option>
                </select>
              </div>
              <div className="request-form-field">
                <label htmlFor="request-needed-by">Data necessária</label>
                <input id="request-needed-by" type="date" value={form.neededBy ?? ''} onChange={(e) => setForm({ ...form, neededBy: e.target.value })} />
              </div>
              <div className="request-form-field">
                <label htmlFor="request-cost-center">Centro de custo *</label>
                {/* Toda requisição exige centro de custo, não só compras — RequestsService.create valida de novo no servidor. */}
                <select id="request-cost-center" value={form.costCenterId ?? ''} onChange={(e) => setForm({ ...form, costCenterId: e.target.value || undefined })} required>
                  <option value="">Selecione o centro de custo</option>
                  {optionData.cost_centers.map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.code} — {cc.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <textarea placeholder="Descrição/justificativa" aria-label="Descrição/justificativa" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} required />
          </div>
        </FormSection>
      )}

      {customFields.length > 0 && (
        !isPurchaseRequest && (
        <FormSection title="Campos específicos da categoria">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {customFields.map((field) => (
              <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {field.label}
                  {field.required && ' *'}
                </label>
                {renderField(field, formValues[field.key], (value) => setFieldValue(field.key, value), optionData)}
              </div>
            ))}
          </div>
        </FormSection>)
      )}

      {isPurchaseRequest && (
        <FormSection title="Itens da Logística">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="search"
              placeholder="Pesquisar item por nome ou código"
              value={purchaseSearch}
              onChange={(e) => setPurchaseSearch(e.target.value)}
              disabled={purchaseCatalog.length === 0}
              aria-label="Pesquisar item da Logística"
            />
            {/* Não limpa purchaseSearch ao adicionar: a lista continua na tela com o mesmo termo,
                pra dar pra escolher outro item sem redigitar a busca inteira de novo — o item
                recém-adicionado já some da lista por addedMaterialIds. */}
            {purchaseSearch.trim() && (
              <select value="" onChange={(e) => addPurchaseRow(e.target.value)} disabled={purchaseSearchResults.length === 0} aria-label="Resultado da pesquisa de item">
                <option value="">{purchaseSearchResults.length ? 'Selecione o item encontrado' : 'Nenhum item encontrado — use os filtros abaixo'}</option>
                {purchaseSearchResults.map((item) => <option key={item.id} value={item.id}>{item.category} / {item.subcategory || 'Sem subcategoria'} / {item.shortDescription} — {formatBRL(item.unitPrice)} / {item.unit} — {stockLabel(item.id)}</option>)}
              </select>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr auto', gap: 10, alignItems: 'center' }}>
              <select value={purchaseCategory} onChange={(e) => { setPurchaseCategory(e.target.value); setPurchaseSubcategory(''); setPurchaseItemSelection(''); }} disabled={purchaseCatalog.length === 0} aria-label="Categoria do item">
                <option value="">Categoria</option>
                {purchaseCategories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
              <select value={purchaseSubcategory} onChange={(e) => { setPurchaseSubcategory(e.target.value); setPurchaseItemSelection(''); }} disabled={!purchaseCategory || purchaseSubcategories.length === 0} aria-label="Subcategoria do item">
                <option value="">Subcategoria</option>
                {purchaseSubcategories.map((subcategory) => <option key={subcategory} value={subcategory}>{subcategory}</option>)}
              </select>
              <select value={purchaseItemSelection} onChange={(e) => setPurchaseItemSelection(e.target.value)} disabled={!purchaseSubcategory || purchaseItems.length === 0} aria-label="Item da Logística">
                <option value="">{purchaseSubcategory ? 'Item' : 'Selecione categoria e subcategoria'}</option>
                {purchaseItems.map((item) => <option key={item.id} value={item.id}>{item.shortDescription} — {formatBRL(item.unitPrice)} / {item.unit} — {stockLabel(item.id)}</option>)}
              </select>
              <button type="button" onClick={() => addPurchaseRow(purchaseItemSelection)} disabled={!purchaseItemSelection || purchaseRows.some((row) => row.materialId === purchaseItemSelection)}>Adicionar item</button>
            </div>
            <small style={{ color: 'var(--text-muted)' }}>{purchaseRows.length ? `${purchaseRows.length} item(ns) adicionado(s). Selecione outro item e clique em “Adicionar item”.` : 'Você pode adicionar vários itens diferentes na mesma requisição.'}</small>
            {purchaseRows.map((row) => {
              const item = purchaseCatalog.find((candidate) => candidate.id === row.materialId);
              if (!item) return null;
              return <div key={row.materialId} style={{ display: 'grid', gridTemplateColumns: '1fr 100px auto', gap: 8, alignItems: 'center' }}><span>{item.category} / {item.subcategory ?? '—'} / <strong>{item.shortDescription}</strong><br /><small>{formatBRL(item.unitPrice)} por {item.unit} — {stockLabel(item.id)}</small></span><input type="number" min="1" step="1" value={row.quantity} aria-label={`Quantidade de ${item.shortDescription}`} onChange={(e) => setPurchaseRows((rows) => rows.map((current) => current.materialId === row.materialId ? { ...current, quantity: Math.max(1, Number(e.target.value) || 1) } : current))} /><button type="button" onClick={() => setPurchaseRows((rows) => rows.filter((current) => current.materialId !== row.materialId))}>Remover</button></div>;
            })}
          </div>
        </FormSection>
      )}
    </FormPage>
  );
}

function renderField(field: RequestFormField, value: unknown, onChange: (value: unknown) => void, optionData: OptionSourceData) {
  switch (field.type) {
    case 'text':
      return <input type="text" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'textarea':
      return <textarea value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} rows={3} />;
    case 'number':
      return <input type="number" value={(value as number) ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />;
    case 'date':
      return <input type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox':
      return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case 'attachment':
      return (
        <input
          type="text"
          placeholder="Nome do(s) arquivo(s), separados por vírgula"
          value={Array.isArray(value) ? (value as string[]).join(', ') : ''}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      );
    case 'select':
      if (field.optionsSource) {
        const items = optionData[field.optionsSource];
        return (
          <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
            <option value="">Selecione...</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {optionLabel(field.optionsSource!, item)}
              </option>
            ))}
          </select>
        );
      }
      return (
        <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Selecione...</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
  }
}
