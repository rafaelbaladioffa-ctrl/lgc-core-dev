import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { DataTable, StatusBadge, type ColumnDef } from '../components/DataTable';
import { KpiCard, KpiRow } from '../components/KpiCard';
import { projectsApi, type Project, type ProjectJourneyStages, type ProjectStatus } from '../api/projects';
import { JOURNEY_STATE_LABEL } from '../utils/journey';
import { clientsApi, type Client } from '../api/clients';
import { costCentersApi, type CostCenter } from '../api/costCenters';
import { collaboratorsApi, type CollaboratorSafe } from '../api/collaborators';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';
import { translateApiError } from '../utils/apiError';
import { runBulkDelete } from '../utils/bulkDelete';
import { formatIsoDate } from '../utils/purchaseDeliveries';

const STATUS_TONE: Record<ProjectStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  proposta: 'default',
  aprovado: 'warning',
  em_execucao: 'success',
  encerrado: 'danger',
};

/** Tom do selo da etapa atual pelo estado da etapa (feito, em andamento, pendente, atenção). */
const STAGE_TONE: Record<'feito' | 'em_andamento' | 'pendente' | 'atencao', 'default' | 'success' | 'warning' | 'danger'> = {
  feito: 'success',
  em_andamento: 'default',
  pendente: 'default',
  atencao: 'warning',
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  proposta: 'Proposta',
  aprovado: 'Aprovado',
  em_execucao: 'Em execução',
  encerrado: 'Encerrado',
};

export function ProjectsPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorSafe[]>([]);
  const [stages, setStages] = useState<ProjectJourneyStages>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([projectsApi.list(), clientsApi.list(), costCentersApi.list(), collaboratorsApi.list()])
      .then(([p, c, cc, col]) => {
        setProjects(p);
        setClients(c);
        setCostCenters(cc);
        setCollaborators(col);
      })
      .then(() =>
        // O selo da etapa é complementar: se falhar, a lista continua útil e o erro aparece acima dela.
        projectsApi
          .journeyStages()
          .then(setStages)
          .catch((err) => setError(translateApiError(err, 'Erro ao carregar a etapa dos projetos.'))),
      )
      .catch((err) => setError(translateApiError(err, 'Erro ao carregar projetos.')));

  useEffect(() => {
    void refresh();
  }, []);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.legalName ?? '—';
  const costCenterName = (id: string) => costCenters.find((c) => c.id === id)?.name ?? '—';
  const collaboratorName = (id: string) => collaborators.find((c) => c.id === id)?.fullName ?? '—';

  const changeStatus = async (project: Project, status: ProjectStatus) => {
    setError(null);
    // Aprovar exige site, revisão da cotação aceita e PO: o diálogo "Aprovar projeto" fica na edição do projeto (PT-06).
    if (status === 'aprovado') {
      navigate(`/projects/${project.id}/edit?approve=1`);
      return;
    }
    try {
      await projectsApi.updateStatus(project.id, status);
    } catch (err) {
      setError(translateApiError(err, 'Erro ao mudar o status do projeto.'));
    }
    await refresh();
  };

  const columns: ColumnDef<Project>[] = [
    { key: 'code', header: 'Código', render: (p) => p.code, filterable: true, width: '160px' },
    {
      key: 'name',
      header: 'Nome',
      render: (p) =>
        hasPermission('project:update') ? (
          <button
            onClick={() => navigate(`/projects/${p.id}/edit`)}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit', textAlign: 'left' }}
          >
            {p.name ?? 'Sem nome — editar'}
          </button>
        ) : (
          (p.name ?? '—')
        ),
      filterable: true,
      filterValue: (p) => p.name ?? '',
    },
    { key: 'client', header: 'Cliente', render: (p) => clientName(p.clientId), filterable: true, filterValue: (p) => clientName(p.clientId) },
    { key: 'costCenter', header: 'Centro de custo', render: (p) => costCenterName(p.costCenterId) },
    { key: 'responsible', header: 'Responsável', render: (p) => collaboratorName(p.responsibleCollaboratorId) },
    {
      key: 'prazo',
      header: 'Prazo previsto',
      render: (p) =>
        p.plannedStartDate || p.plannedEndDate ? `${formatIsoDate(p.plannedStartDate)} a ${formatIsoDate(p.plannedEndDate)}` : '—',
    },
    {
      key: 'etapa',
      header: 'Etapa',
      render: (p) => {
        const stage = stages[p.id];
        return stage ? (
          <button
            onClick={() => navigate(`/projects/${p.id}/journey`)}
            title={`Ver a jornada do projeto — ${JOURNEY_STATE_LABEL[stage.state]}`}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <StatusBadge label={stage.label} tone={STAGE_TONE[stage.state]} />
          </button>
        ) : (
          '—'
        );
      },
      filterable: true,
      filterValue: (p) => stages[p.id]?.label ?? '',
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) =>
        hasPermission('project:update') ? (
          <select
            value={p.status}
            onChange={(e) => void changeStatus(p, e.target.value as ProjectStatus)}
            style={{ fontSize: 12, padding: '3px 6px' }}
          >
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          <StatusBadge label={STATUS_LABEL[p.status]} tone={STATUS_TONE[p.status]} />
        ),
      filterable: true,
      filterValue: (p) => STATUS_LABEL[p.status],
    },
  ];

  if (hasPermission('project:delete')) {
    columns.push({
      key: 'actions',
      header: '',
      width: '90px',
      render: (p) =>
        p.status === 'proposta' ? (
          <button
            onClick={async () => setError(await runBulkDelete([p], (r) => projectsApi.remove(r.id), refresh))}
            title="Só propostas sem requisições podem ser excluídas; depois disso, encerre o projeto."
            style={{ fontSize: 12, padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--danger-soft)', color: 'var(--danger)' }}
          >
            Excluir
          </button>
        ) : null,
    });
  }

  const kpiCounts = projects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});
  const withoutName = projects.filter((p) => !p.name).length;

  return (
    <AppLayout breadcrumb={['Axis', 'Projetos']}>
      <KpiRow>
        <KpiCard label="Total de projetos" value={projects.length} />
        <KpiCard label="Em execução" value={kpiCounts.em_execucao ?? 0} tone="success" />
        <KpiCard label="Propostas" value={kpiCounts.proposta ?? 0} />
        <KpiCard label="Encerrados" value={kpiCounts.encerrado ?? 0} tone="danger" />
        {withoutName > 0 && <KpiCard label="Sem nome" value={withoutName} tone="warning" />}
      </KpiRow>

      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{error}</p>}

      <div style={{ marginBottom: 12 }}>
        <button
          onClick={() => navigate('/projects/dashboard')}
          style={{ padding: '6px 14px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text)' }}
        >
          Ver dashboard
        </button>
      </div>

      <DataTable
        columns={columns}
        rows={projects}
        rowKey={(p) => p.id}
        toolbar={
          hasPermission('project:create') && (
            <Button variant="positive" onClick={() => navigate('/projects/new')}>
              + Novo projeto
            </Button>
          )
        }
      />
    </AppLayout>
  );
}
