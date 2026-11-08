import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { FormPage, FormSection } from '../components/layout/FormPage';
import { projectsApi, type CreateProjectInput } from '../api/projects';
import { clientsApi, type Client } from '../api/clients';
import { costCentersApi, type CostCenter } from '../api/costCenters';
import { collaboratorsApi, type CollaboratorSafe } from '../api/collaborators';
import { translateApiError } from '../utils/apiError';
import { useAuth } from '../context/AuthContext';
import { ProjectDocuments } from '../components/ProjectDocuments';
import { DOCUMENT_ACCEPT, readFileAsBase64 } from '../utils/fileUpload';

const emptyForm: CreateProjectInput = {
  name: '',
  clientId: '',
  costCenterId: '',
  responsibleCollaboratorId: '',
  plannedStartDate: '',
  plannedEndDate: '',
};

/** `''` vira `null` (apaga a data na edição; na criação, sem data). */
const dateOrNull = (value: string | null | undefined) => (value ? value : null);

export function ProjectFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [sowFile, setSowFile] = useState<File | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorSafe[]>([]);
  const [form, setForm] = useState<CreateProjectInput>(emptyForm);
  const [code, setCode] = useState<string | null>(null);
  const location = useLocation();
  // Mensagem vinda da criação quando o projeto foi criado mas a SOW não subiu.
  const [error, setError] = useState<string | null>((location.state as { error?: string } | null)?.error ?? null);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    Promise.all([clientsApi.list(), costCentersApi.list(), collaboratorsApi.list()])
      .then(([c, cc, col]) => {
        setClients(c);
        setCostCenters(cc);
        setCollaborators(col);
      })
      .catch((err) => setError(translateApiError(err, 'Erro ao carregar clientes, centros de custo e colaboradores.')));
  }, []);

  useEffect(() => {
    if (!id) return;
    projectsApi
      .get(id)
      .then((p) => {
        setCode(p.code);
        setForm({
          name: p.name ?? '',
          clientId: p.clientId,
          costCenterId: p.costCenterId,
          responsibleCollaboratorId: p.responsibleCollaboratorId,
          plannedStartDate: p.plannedStartDate?.slice(0, 10) ?? '',
          plannedEndDate: p.plannedEndDate?.slice(0, 10) ?? '',
        });
      })
      .catch((err) => setError(translateApiError(err, 'Erro ao carregar o projeto.')))
      .finally(() => setLoading(false));
  }, [id]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const plannedStartDate = dateOrNull(form.plannedStartDate);
    const plannedEndDate = dateOrNull(form.plannedEndDate);
    if (plannedStartDate && plannedEndDate && plannedEndDate < plannedStartDate) {
      setError('A conclusão prevista não pode ser antes do início previsto.');
      return;
    }
    try {
      if (isEdit && id) {
        await projectsApi.update(id, {
          name: form.name,
          costCenterId: form.costCenterId,
          responsibleCollaboratorId: form.responsibleCollaboratorId,
          plannedStartDate,
          plannedEndDate,
        });
      } else {
        const created = await projectsApi.create({ ...form, plannedStartDate, plannedEndDate });
        if (sowFile) {
          try {
            const contentBase64 = await readFileAsBase64(sowFile);
            await projectsApi.addDocument(created.id, { kind: 'sow', filename: sowFile.name, contentBase64 });
          } catch (uploadErr) {
            // O projeto já existe: leva para a edição, onde dá para tentar anexar de novo.
            const detail = translateApiError(uploadErr, 'Erro ao anexar a SOW.');
            navigate(`/projects/${created.id}/edit`, {
              state: { error: `Projeto ${created.code} criado, mas a SOW não foi anexada (${detail}). Tente de novo abaixo.` },
            });
            return;
          }
        }
      }
      navigate('/projects');
    } catch (err) {
      setError(translateApiError(err, isEdit ? 'Erro ao salvar o projeto.' : 'Erro ao cadastrar projeto.'));
    }
  };

  return (
    <FormPage
      breadcrumb={['Axis', 'Projetos', isEdit ? (code ?? 'Editar') : 'Novo']}
      onSubmit={onSubmit}
      onCancel={() => navigate('/projects')}
      error={error}
      loading={loading}
      submitLabel={isEdit ? 'Salvar alterações' : 'Cadastrar'}
      maxWidth={520}
    >
      <FormSection title="Dados do projeto">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            placeholder="Nome do projeto"
            value={form.name}
            maxLength={200}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <select
            value={form.clientId}
            onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            required
            disabled={isEdit}
            title={isEdit ? 'O cliente faz parte do código do projeto e não pode ser trocado.' : undefined}
          >
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
      <FormSection title="Prazo previsto">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            Início
            <input
              type="date"
              value={form.plannedStartDate ?? ''}
              onChange={(e) => setForm({ ...form, plannedStartDate: e.target.value })}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            Conclusão
            <input
              type="date"
              value={form.plannedEndDate ?? ''}
              min={form.plannedStartDate || undefined}
              onChange={(e) => setForm({ ...form, plannedEndDate: e.target.value })}
            />
          </label>
        </div>
      </FormSection>
      <FormSection title="SOW do cliente">
        {isEdit && id ? (
          <ProjectDocuments projectId={id} kind="sow" />
        ) : hasPermission('project:update') ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input type="file" accept={DOCUMENT_ACCEPT} onChange={(e) => setSowFile(e.target.files?.[0] ?? null)} />
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              Opcional. PDF, DOCX, XLSX, PNG ou JPG, até 25MB. Também dá para anexar depois, na edição do projeto.
            </p>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>A SOW pode ser anexada na edição do projeto.</p>
        )}
      </FormSection>
    </FormPage>
  );
}
