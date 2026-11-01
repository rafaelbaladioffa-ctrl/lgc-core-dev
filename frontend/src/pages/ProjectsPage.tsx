import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { DataTable, StatusBadge, type ColumnDef } from '../components/DataTable';
import { KpiCard, KpiRow } from '../components/KpiCard';
import { projectsApi, type Project, type ProjectStatus } from '../api/projects';
import { clientsApi, type Client } from '../api/clients';
import { costCentersApi, type CostCenter } from '../api/costCenters';
import { collaboratorsApi, type CollaboratorSafe } from '../api/collaborators';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';

const STATUS_TONE: Record<ProjectStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  proposta: 'default',
  aprovado: 'warning',
  em_execucao: 'success',
  encerrado: 'danger',
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

  const refresh = () =>
    Promise.all([projectsApi.list(), clientsApi.list(), costCentersApi.list(), collaboratorsApi.list()]).then(
      ([p, c, cc, col]) => {
        setProjects(p);
        setClients(c);
        setCostCenters(cc);
        setCollaborators(col);
      },
    );

  useEffect(() => {
    void refresh();
  }, []);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.legalName ?? '—';
  const costCenterName = (id: string) => costCenters.find((c) => c.id === id)?.name ?? '—';
  const collaboratorName = (id: string) => collaborators.find((c) => c.id === id)?.fullName ?? '—';

  const columns: ColumnDef<Project>[] = [
    { key: 'code', header: 'Código', render: (p) => p.code, filterable: true, width: '120px' },
    { key: 'client', header: 'Cliente', render: (p) => clientName(p.clientId), filterable: true, filterValue: (p) => clientName(p.clientId) },
    { key: 'costCenter', header: 'Centro de custo', render: (p) => costCenterName(p.costCenterId) },
    { key: 'responsible', header: 'Responsável', render: (p) => collaboratorName(p.responsibleCollaboratorId) },
    {
      key: 'status',
      header: 'Status',
      render: (p) =>
        hasPermission('project:update') ? (
          <select
            value={p.status}
            onChange={async (e) => {
              await projectsApi.updateStatus(p.id, e.target.value as ProjectStatus);
              await refresh();
            }}
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

  const kpiCounts = projects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <AppLayout breadcrumb={['Axis', 'Projetos']}>
      <KpiRow>
        <KpiCard label="Total de projetos" value={projects.length} />
        <KpiCard label="Em execução" value={kpiCounts.em_execucao ?? 0} tone="success" />
        <KpiCard label="Propostas" value={kpiCounts.proposta ?? 0} />
        <KpiCard label="Encerrados" value={kpiCounts.encerrado ?? 0} tone="danger" />
      </KpiRow>

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
