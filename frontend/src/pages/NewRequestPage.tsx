import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FormPage, FormSection } from '../components/layout/FormPage';
import { requestCategoriesApi, type RequestCategory, type RequestFormField, type RequestFieldOptionsSource } from '../api/requestCategories';
import { requestsApi, type CreateRequestInput } from '../api/requests';
import { projectsApi, type Project } from '../api/projects';
import { collaboratorsApi, type CollaboratorSafe } from '../api/collaborators';
import { clientsApi, type Client } from '../api/clients';
import { costCentersApi, type CostCenter } from '../api/costCenters';
import { jobTitlesApi, type JobTitle } from '../api/jobTitles';
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

/** "Nova requisição" — simplificada em uma única página (categoria + dados + campos dinâmicos),
 * em vez do stepper Categoria → Dados → Revisão → Envio do §15.1.2: o `FormPage` compartilhado já
 * cobre autosave de rascunho? Não — Fase 1 cria o rascunho só ao enviar (ver nota de simplificação
 * em requests.service.ts); o stepper visual fica para a Fase 2. */
export function NewRequestPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [categories, setCategories] = useState<RequestCategory[]>([]);
  const [optionData, setOptionData] = useState<OptionSourceData>({ projects: [], collaborators: [], clients: [], cost_centers: [], job_titles: [] });
  const [categoryId, setCategoryId] = useState(searchParams.get('categoryId') ?? '');
  const parentRequestId = searchParams.get('parentRequestId') ?? undefined;
  const [form, setForm] = useState(emptyForm);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([requestCategoriesApi.list(), projectsApi.list(), collaboratorsApi.list(), clientsApi.list(), costCentersApi.list(), jobTitlesApi.list()]).then(
      ([c, projects, collaborators, clients, costCenters, jobTitles]) => {
        setCategories(c);
        setOptionData({ projects, collaborators, clients, cost_centers: costCenters, job_titles: jobTitles });
      },
    );
  }, []);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const customFields: RequestFormField[] = useMemo(() => selectedCategory?.currentVersion?.formSchema ?? [], [selectedCategory]);

  function pickCategory(id: string) {
    setCategoryId(id);
    setFormValues({});
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
    for (const field of customFields) {
      if (field.required && isFieldEmpty(formValues[field.key])) {
        setError(`Campo obrigatório: ${field.label}`);
        return;
      }
    }

    try {
      const created = await requestsApi.create({ ...form, categoryId, parentRequestId, formData: customFields.length > 0 ? formValues : undefined });
      await requestsApi.submit(created.id);
      navigate(`/requests/${created.id}`);
    } catch (err) {
      setError(translateApiError(err, 'Erro ao abrir requisição.'));
    }
  };

  return (
    <FormPage breadcrumb={['Axis', 'Requisições', 'Nova']} onSubmit={onSubmit} onCancel={() => navigate('/requests')} error={error} submitLabel="Enviar requisição" maxWidth={620}>
      <FormSection title="Categoria">
        <select value={categoryId} onChange={(e) => pickCategory(e.target.value)} required>
          <option value="">Selecione a categoria</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
      </FormSection>

      {categoryId && (
        <FormSection title="Dados da requisição">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input placeholder="Título (10-120 caracteres)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={10} maxLength={120} />
            <textarea placeholder="Descrição/justificativa" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} required />
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as CreateRequestInput['priority'] })}>
              <option value="baixa">Prioridade: Baixa</option>
              <option value="normal">Prioridade: Normal</option>
              <option value="alta">Prioridade: Alta</option>
              <option value="critica">Prioridade: Crítica</option>
            </select>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Data necessária</label>
            <input type="date" value={form.neededBy ?? ''} onChange={(e) => setForm({ ...form, neededBy: e.target.value })} />
          </div>
        </FormSection>
      )}

      {customFields.length > 0 && (
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
