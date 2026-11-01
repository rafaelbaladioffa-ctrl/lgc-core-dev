import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormPage, FormSection } from '../components/layout/FormPage';
import { projectsApi, type CreateProjectInput } from '../api/projects';
import { clientsApi, type Client } from '../api/clients';
import { costCentersApi, type CostCenter } from '../api/costCenters';
import { collaboratorsApi, type CollaboratorSafe } from '../api/collaborators';
import { translateApiError } from '../utils/apiError';

const emptyForm: CreateProjectInput = { clientId: '', costCenterId: '', responsibleCollaboratorId: '' };

export function ProjectFormPage() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorSafe[]>([]);
  const [form, setForm] = useState<CreateProjectInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([clientsApi.list(), costCentersApi.list(), collaboratorsApi.list()]).then(([c, cc, col]) => {
      setClients(c);
      setCostCenters(cc);
      setCollaborators(col);
    });
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await projectsApi.create(form);
      navigate('/projects');
    } catch (err) {
      setError(translateApiError(err, 'Erro ao cadastrar projeto.'));
    }
  };

  return (
    <FormPage
      breadcrumb={['Axis', 'Projetos', 'Novo']}
      onSubmit={onSubmit}
      onCancel={() => navigate('/projects')}
      error={error}
      submitLabel="Cadastrar"
      maxWidth={520}
    >
      <FormSection title="Dados do projeto">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} required>
            <option value="">Selecione o cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </select>
          <select value={form.costCenterId} onChange={(e) => setForm({ ...form, costCenterId: e.target.value })} required>
            <option value="">Selecione o centro de custo</option>
            {costCenters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          <select
            value={form.responsibleCollaboratorId}
            onChange={(e) => setForm({ ...form, responsibleCollaboratorId: e.target.value })}
            required
          >
            <option value="">Selecione o responsável</option>
            {collaborators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
        </div>
      </FormSection>
    </FormPage>
  );
}
