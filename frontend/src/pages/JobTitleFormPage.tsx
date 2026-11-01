import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FormPage, FormSection } from '../components/layout/FormPage';
import { jobTitlesApi, type CreateJobTitleInput } from '../api/jobTitles';
import { translateApiError } from '../utils/apiError';

const emptyForm: CreateJobTitleInput = { name: '', isTechnician: false };

export function JobTitleFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState<CreateJobTitleInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    if (!id) return;
    void jobTitlesApi.list().then((list) => {
      const jt = list.find((j) => j.id === id);
      if (jt) setForm({ name: jt.name, isTechnician: jt.isTechnician });
      setLoading(false);
    });
  }, [id]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (isEdit && id) {
        await jobTitlesApi.update(id, form);
      } else {
        await jobTitlesApi.create(form);
      }
      navigate('/job-titles');
    } catch (err) {
      setError(translateApiError(err, isEdit ? 'Erro ao salvar cargo.' : 'Erro ao cadastrar cargo.'));
    }
  };

  return (
    <FormPage
      breadcrumb={['Axis', 'Cargos', isEdit ? 'Editar' : 'Novo']}
      onSubmit={onSubmit}
      onCancel={() => navigate('/job-titles')}
      error={error}
      loading={loading}
      submitLabel={isEdit ? 'Salvar alterações' : 'Cadastrar'}
      maxWidth={480}
    >
      <FormSection title="Dados do cargo">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input placeholder="Nome do cargo" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={form.isTechnician ?? false}
              onChange={(e) => setForm({ ...form, isTechnician: e.target.checked })}
            />
            Cargo técnico (exige certificações NR no cadastro do colaborador)
          </label>
        </div>
      </FormSection>
    </FormPage>
  );
}
