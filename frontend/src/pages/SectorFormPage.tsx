import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FormPage, FormSection } from '../components/layout/FormPage';
import { sectorsApi, type CreateSectorInput, type Sector } from '../api/sectors';
import { translateApiError } from '../utils/apiError';

const emptyForm: CreateSectorInput = { name: '' };

export function SectorFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [sectors, setSectors] = useState<Sector[]>([]);
  const [form, setForm] = useState<CreateSectorInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    void sectorsApi.list().then(setSectors);
  }, []);

  useEffect(() => {
    if (!id) return;
    void sectorsApi.get(id).then((s) => {
      setForm({ name: s.name, parentSectorId: s.parentSectorId ?? undefined, responsibleCollaboratorId: s.responsibleCollaboratorId ?? undefined });
      setLoading(false);
    });
  }, [id]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (isEdit && id) {
        await sectorsApi.update(id, { name: form.name, responsibleCollaboratorId: form.responsibleCollaboratorId });
      } else {
        await sectorsApi.create(form);
      }
      navigate('/sectors');
    } catch (err) {
      setError(translateApiError(err, isEdit ? 'Erro ao salvar setor.' : 'Erro ao cadastrar setor.'));
    }
  };

  // Codes are generated server-side and hierarchical (parent.code + ".n") — reparenting isn't
  // supported (it would require recomputing codes for the whole subtree), so the parent dropdown
  // only appears when creating a new sector, never on edit.
  const availableParents = sectors.filter((s) => s.id !== id);

  return (
    <FormPage
      breadcrumb={['Axis', 'Setores', isEdit ? 'Editar' : 'Novo']}
      onSubmit={onSubmit}
      onCancel={() => navigate('/sectors')}
      error={error}
      loading={loading}
      submitLabel={isEdit ? 'Salvar alterações' : 'Cadastrar'}
      maxWidth={520}
    >
      <FormSection title="Dados do setor">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          {!isEdit && (
            <select value={form.parentSectorId ?? ''} onChange={(e) => setForm({ ...form, parentSectorId: e.target.value || undefined })}>
              <option value="">Setor raiz (sem pai)</option>
              {availableParents.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </FormSection>
    </FormPage>
  );
}
