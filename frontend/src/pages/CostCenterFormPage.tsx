import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FormPage, FormSection } from '../components/layout/FormPage';
import { CostCenterBudgetBadge } from '../components/CostCenterBudgetBadge';
import {
  costCentersApi,
  COST_CENTER_KIND_LABELS,
  COST_CENTER_SHORT_CODE_PATTERN,
  type CostCenter,
  type CostCenterKind,
  type CreateCostCenterInput,
} from '../api/costCenters';
import { sectorsApi, type Sector } from '../api/sectors';
import { collaboratorsApi, type CollaboratorSafe } from '../api/collaborators';
import { translateApiError } from '../utils/apiError';
import { formatDateTime } from '../utils/formatDate';
import '../styles/cost-centers.css';

const emptyForm: CreateCostCenterInput = { name: '', sectorId: '', kind: 'administrativo', shortCode: '' };
const KINDS = Object.keys(COST_CENTER_KIND_LABELS) as CostCenterKind[];

export function CostCenterFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorSafe[]>([]);
  const [form, setForm] = useState<CreateCostCenterInput>(emptyForm);
  const [current, setCurrent] = useState<CostCenter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    Promise.all([costCentersApi.list(), sectorsApi.list(), collaboratorsApi.list()])
      .then(([cc, secs, cols]) => {
        setCostCenters(cc);
        setSectors(secs);
        setCollaborators(cols);
      })
      .catch((err: unknown) => setError(translateApiError(err, 'Não foi possível carregar setores, centros de custo e colaboradores.')));
  }, []);

  useEffect(() => {
    if (!id) return;
    costCentersApi
      .get(id)
      .then((c) => {
        setCurrent(c);
        setForm({
          name: c.name,
          sectorId: c.sectorId,
          parentCostCenterId: c.parentCostCenterId ?? undefined,
          responsibleCollaboratorId: c.responsibleCollaboratorId ?? undefined,
          kind: c.kind,
          shortCode: c.shortCode ?? '',
        });
      })
      .catch((err: unknown) => setError(translateApiError(err, 'Não foi possível carregar o centro de custo.')))
      .finally(() => setLoading(false));
  }, [id]);

  const shortCode = (form.shortCode ?? '').trim().toUpperCase();
  const shortCodeInvalid = shortCode !== '' && (shortCode.length > 30 || !COST_CENTER_SHORT_CODE_PATTERN.test(shortCode));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (shortCodeInvalid) {
      setError('Sigla inválida: use letras maiúsculas, números e hífen (ex.: DC-001-JAI), até 30 caracteres.');
      return;
    }
    try {
      if (isEdit && id) {
        await costCentersApi.update(id, { name: form.name, sectorId: form.sectorId, responsibleCollaboratorId: form.responsibleCollaboratorId, kind: form.kind, shortCode: shortCode || null });
      } else {
        await costCentersApi.create({ ...form, shortCode: shortCode || undefined });
      }
      navigate('/cost-centers');
    } catch (err) {
      setError(translateApiError(err, isEdit ? 'Erro ao salvar centro de custo.' : 'Erro ao cadastrar centro de custo.'));
    }
  };

  const availableParents = costCenters.filter((c) => c.id !== id);

  return (
    <FormPage
      breadcrumb={['Axis', 'Centros de Custo', isEdit ? 'Editar' : 'Novo']}
      onSubmit={onSubmit}
      onCancel={() => navigate('/cost-centers')}
      error={error}
      loading={loading}
      submitLabel={isEdit ? 'Salvar alterações' : 'Cadastrar'}
      maxWidth={520}
    >
      <FormSection title="Dados do centro de custo">
        <div className="cc-form-fields">
          <input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <select value={form.sectorId} onChange={(e) => setForm({ ...form, sectorId: e.target.value })} required>
            <option value="">Selecione o setor</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
          {!isEdit && (
            <select value={form.parentCostCenterId ?? ''} onChange={(e) => setForm({ ...form, parentCostCenterId: e.target.value || undefined })}>
              <option value="">Centro de custo raiz (sem pai)</option>
              {availableParents.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          )}
          <label className="cc-field">
            <span className="cc-field__label">Tipo *</span>
            <select value={form.kind ?? 'administrativo'} onChange={(e) => setForm({ ...form, kind: e.target.value as CostCenterKind })} required>
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {COST_CENTER_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
            <span className="cc-field__hint">Equipe técnica aparece no painel das equipes do Financeiro; a raiz da árvore costuma ser Divisão.</span>
          </label>
          <label className="cc-field">
            <span className="cc-field__label">Sigla (opcional)</span>
            <input
              placeholder="Ex.: DC-001-JAI"
              value={form.shortCode ?? ''}
              maxLength={30}
              aria-invalid={shortCodeInvalid}
              onChange={(e) => setForm({ ...form, shortCode: e.target.value.toUpperCase() })}
            />
            <span className="cc-field__hint">
              {shortCodeInvalid ? 'Use letras maiúsculas, números e hífen, sem espaço.' : 'Única. Não substitui o código gerado.'}
            </span>
          </label>
          <select value={form.responsibleCollaboratorId ?? ''} onChange={(e) => setForm({ ...form, responsibleCollaboratorId: e.target.value || undefined })}>
            <option value="">Responsável pela aprovação final (opcional)</option>
            {collaborators.filter((c) => !form.sectorId || c.sectorId === form.sectorId).map((c) => <option key={c.id} value={c.id}>{c.fullName} ({c.matricula})</option>)}
          </select>
        </div>
      </FormSection>
      {isEdit && current && (
        <FormSection title="Orçamento (informado pelo Financeiro)">
          {current.budgetStatus ? (
            <div className="cc-budget">
              <CostCenterBudgetBadge costCenter={current} showYear />
              {current.budgetStatusAt && <span className="cc-field__hint">Atualizado em {formatDateTime(current.budgetStatusAt)}</span>}
            </div>
          ) : (
            <p className="cc-budget__empty">O Financeiro ainda não informou a situação do orçamento deste centro de custo.</p>
          )}
          {current.budgetStatus === 'estourado' && (
            <p className="cc-field__hint">Compras deste centro de custo passam também pela aprovação do responsável do centro de custo pai.</p>
          )}
        </FormSection>
      )}
    </FormPage>
  );
}
