import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { DataTable, StatusBadge, type ColumnDef } from '../components/DataTable';
import { KpiCard, KpiRow } from '../components/KpiCard';
import { collaboratorsApi, type CollaboratorSafe, type CollaboratorStatus, type OrgChartNode } from '../api/collaborators';
import { sectorsApi, type Sector } from '../api/sectors';
import { OrgChartTree } from '../components/OrgChartTree';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';

const STATUS_LABEL: Record<CollaboratorStatus, string> = {
  ativo: 'Ativo',
  afastado: 'Afastado',
  ferias: 'Férias',
  desligado: 'Desligado',
};

const STATUS_TONE: Record<CollaboratorStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  ativo: 'success',
  afastado: 'warning',
  ferias: 'default',
  desligado: 'danger',
};

export function CollaboratorsPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [collaborators, setCollaborators] = useState<CollaboratorSafe[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [orgChart, setOrgChart] = useState<OrgChartNode[]>([]);
  const [orgChartError, setOrgChartError] = useState<string | null>(null);
  const [orgChartLoading, setOrgChartLoading] = useState(false);
  const [view, setView] = useState<'list' | 'orgchart'>('list');

  const refresh = async () => {
    const [cols, secs] = await Promise.all([collaboratorsApi.list(), sectorsApi.list()]);
    setCollaborators(cols);
    setSectors(secs);
  };

  const loadOrgChart = async () => {
    setOrgChartLoading(true);
    setOrgChartError(null);
    try {
      setOrgChart(await collaboratorsApi.orgChart());
    } catch {
      setOrgChart([]);
      setOrgChartError('Não foi possível carregar o organograma. Tente novamente.');
    } finally {
      setOrgChartLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (view === 'orgchart') {
      void loadOrgChart();
    }
  }, [view]);

  const sectorName = (id: string) => sectors.find((s) => s.id === id)?.name ?? '—';

  const columns: ColumnDef<CollaboratorSafe>[] = [
    { key: 'matricula', header: 'Matrícula', render: (c) => <code>{c.matricula}</code>, filterable: true, width: '100px' },
    {
      key: 'fullName',
      header: 'Nome',
      render: (c) => (
        <button
          onClick={() => navigate(`/collaborators/${c.id}/edit`)}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit', textAlign: 'left' }}
        >
          {c.fullName}
        </button>
      ),
      filterable: true,
      filterValue: (c) => c.fullName,
    },
    { key: 'jobTitleName', header: 'Cargo', render: (c) => c.jobTitleName, filterable: true },
    { key: 'sector', header: 'Setor', render: (c) => sectorName(c.sectorId), filterable: true, filterValue: (c) => sectorName(c.sectorId) },
    { key: 'corporateEmail', header: 'Email corporativo', render: (c) => c.corporateEmail },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <StatusBadge label={STATUS_LABEL[c.status]} tone={STATUS_TONE[c.status]} />,
      filterable: true,
      filterValue: (c) => STATUS_LABEL[c.status],
    },
  ];

  return (
    <AppLayout breadcrumb={['Axis', 'Colaboradores']}>
      <KpiRow>
        <KpiCard label="Total" value={collaborators.length} />
        <KpiCard label="Ativos" value={collaborators.filter((c) => c.status === 'ativo').length} tone="success" />
        <KpiCard label="Afastados/Férias" value={collaborators.filter((c) => c.status === 'afastado' || c.status === 'ferias').length} tone="warning" />
        <KpiCard label="Desligados" value={collaborators.filter((c) => c.status === 'desligado').length} tone="danger" />
        <KpiCard label="Técnicos" value={collaborators.filter((c) => c.isTechnician).length} />
      </KpiRow>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <button
          onClick={() => setView('list')}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: view === 'list' ? 'var(--accent-soft)' : 'var(--bg-elevated)',
            color: view === 'list' ? 'var(--accent)' : 'var(--text)',
          }}
        >
          Lista
        </button>
        <button
          onClick={() => setView('orgchart')}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: view === 'orgchart' ? 'var(--accent-soft)' : 'var(--bg-elevated)',
            color: view === 'orgchart' ? 'var(--accent)' : 'var(--text)',
          }}
        >
          Organograma
        </button>
      </div>

      {view === 'orgchart' ? (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          {orgChartLoading ? (
            <p>Carregando organograma...</p>
          ) : orgChartError ? (
            <div>
              <p style={{ color: 'var(--danger)' }}>{orgChartError}</p>
              <button onClick={() => void loadOrgChart()}>Tentar novamente</button>
            </div>
          ) : (
            <OrgChartTree roots={orgChart} />
          )}
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={collaborators}
          rowKey={(c) => c.id}
          toolbar={
            hasPermission('collaborator:create') && (
              <Button variant="positive" onClick={() => navigate('/collaborators/new')}>
                + Novo colaborador
              </Button>
            )
          }
        />
      )}
    </AppLayout>
  );
}
