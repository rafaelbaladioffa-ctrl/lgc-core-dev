import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FormPage, FormSection, fieldStyle, labelStyle } from '../components/layout/FormPage';
import { formatBRL } from '../utils/format';
import { requestCategoriesApi, type RequestCategory, type RequestFormField, type RequestFieldOptionsSource } from '../api/requestCategories';
import { requestsApi, type CreateRequestInput } from '../api/requests';
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

interface PurchaseRow { materialId: string; quantity: number; }

/** "Nova requisição" — simplificada em uma única página (categoria + dados + campos dinâmicos),
 * em vez do stepper Categoria → Dados → Revisão → Envio do §15.1.2: o `FormPage` compartilhado já
 * cobre autosave de rascunho? Não — Fase 1 cria o rascunho só ao enviar (ver nota de simplificação
 * em requests.service.ts); o stepper visual fica para a Fase 2. */
export function NewRequestPage() {
  const navigate = useNavigate();
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
  const isPurchaseRequest = selectedCategory?.code === 'SUP-COMPRA' || selectedCategory?.name.toLowerCase() === 'compra de material';
  const requesterSector = requester ? sectors.find((sector) => sector.id === requester.sectorId) : null;
  const requesterParentSector = requesterSector?.parentSectorId ? sectors.find((sector) => sector.id === requesterSector.parentSectorId) : null;
  const purchaseTitle = requesterSector ? `Compra de Materiais - ${requesterParentSector ? `${requesterParentSector.name}/${requesterSector.name}` : requesterSector.name}` : 'Compra de Materiais';

  useEffect(() => {
    if (!isPurchaseRequest) { setPurchaseCatalog([]); setStockAvailability({}); setPurchaseRows([]); return; }
    void logisticsCatalogApi
      .list()
      .then((items) => {
        setPurchaseCatalog(items);
        return logisticsCatalogApi.availability(items.map((item) => item.id));
      })
      .then((rows) => setStockAvailability(Object.fromEntries(rows.map((row) => [row.material_id, row.available]))))
      .catch(() => setError('Não foi possível carregar o catálogo da Logística.'));
  }, [isPurchaseRequest]);

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

    try {
      const items = purchaseRows.map((row) => {
        const material = purchaseCatalog.find((item) => item.id === row.materialId)!;
        return { materialId: material.id, code: material.code, item: material.shortDescription, category: material.category, subcategory: material.subcategory, unit: material.unit, quantity: row.quantity, unitPrice: material.unitPrice };
      });
      const purchaseTotal = items.reduce((total, item) => total + item.quantity * Number(item.unitPrice ?? 0), 0).toFixed(2);
      const created = await requestsApi.create({ ...form, categoryId, title: isPurchaseRequest ? purchaseTitle : form.title, estimatedValue: isPurchaseRequest ? purchaseTotal : form.estimatedValue, parentRequestId, formData: isPurchaseRequest ? { purchaseItems: items } : customFields.length > 0 ? formValues : undefined });
      await requestsApi.submit(created.id);
      navigate(`/requests/${created.id}`);
    } catch (err) {
      setError(translateApiError(err, 'Erro ao abrir requisição.'));
    }
  };

  return (
    <FormPage breadcrumb={['Axis', 'Requisições', 'Nova']} onSubmit={onSubmit} onCancel={() => navigate('/requests')} error={error} submitLabel="Enviar requisição">
      {!categoryId && (
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

      {categoryId && (
        <FormSection title="Dados da requisição">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {isPurchaseRequest ? <input value={purchaseTitle} readOnly aria-label="Título da requisição" /> : <input placeholder="Título (10-120 caracteres)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={10} maxLength={120} />}
            <div style={fieldStyle}>
              <label style={labelStyle}>Solicitante</label>
              <input value={requester?.fullName ?? ''} readOnly aria-label="Solicitante" />
            </div>
            <textarea placeholder="Descrição/justificativa" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} required />
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as CreateRequestInput['priority'] })}>
              <option value="baixa">Prioridade: Baixa</option>
              <option value="normal">Prioridade: Normal</option>
              <option value="alta">Prioridade: Alta</option>
              <option value="critica">Prioridade: Crítica</option>
            </select>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Data necessária</label>
            <input type="date" value={form.neededBy ?? ''} onChange={(e) => setForm({ ...form, neededBy: e.target.value })} />
            {/* Toda requisição exige centro de custo, não só compras — RequestsService.create valida de novo no servidor. */}
            <select value={form.costCenterId ?? ''} onChange={(e) => setForm({ ...form, costCenterId: e.target.value || undefined })} required>
              <option value="">Selecione o centro de custo *</option>
              {optionData.cost_centers.map((cc) => (
                <option key={cc.id} value={cc.id}>
                  {cc.code} — {cc.name}
                </option>
              ))}
            </select>
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
              const item = purchaseCatalog.find((candidate) => candidate.id === row.materialId)!;
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
