import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FormPage, FormSection } from '../components/layout/FormPage';
import { costCentersApi, type CostCenter, type CreateCostCenterInput } from '../api/costCenters';
import { sectorsApi, type Sector } from '../api/sectors';
import { translateApiError } from '../utils/apiError';

const emptyForm: CreateCostCenterInput = { name: '', sectorId: '' };

export function CostCenterFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [form, setForm] = useState<CreateCostCenterInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    void Promise.all([costCentersApi.list(), sectorsApi.list()]).then(([cc, secs]) => {
      setCostCenters(cc);
      setSectors(secs);
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    void costCentersApi.get(id).then((c) => {
      setForm({ name: c.name, sectorId: c.sectorId, parentCostCenterId: c.parentCostCenterId ?? undefined });
      setLoading(false);
    });
  }, [id]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (isEdit && id) {
        await costCentersApi.update(id, { name: form.name, sectorId: form.sectorId });
      } else {
        await costCentersApi.create(form);
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
        </div>
      </FormSection>
    </FormPage>
  );
}
