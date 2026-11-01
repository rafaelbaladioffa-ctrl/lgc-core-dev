import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { KpiCard, KpiRow } from '../components/KpiCard';
import { PieChart, type ChartDatum } from '../components/charts';
import { useAuth } from '../context/AuthContext';
import { collaboratorsApi } from '../api/collaborators';
import { clientsApi } from '../api/clients';
import { projectsApi, type ProjectStatus } from '../api/projects';
import { requestsApi, type RequestStatus } from '../api/requests';
import { integrationApi } from '../api/integration';

const REQUEST_OPEN_STATUSES: RequestStatus[] = [
  'rascunho',
  'enviada',
  'em_triagem',
  'aguardando_aprovacao',
  'aprovada',
  'planejada',
  'em_atendimento',
  'aguardando_solicitante',
  'aguardando_terceiro',
];

const REQUEST_STATUS_LABELS: Partial<Record<RequestStatus, string>> = {
  em_triagem: 'Em triagem',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovada: 'Aprovada',
  em_atendimento: 'Em atendimento',
  concluida: 'Concluída',
  encerrada: 'Encerrada',
  reprovada: 'Reprovada',
  cancelada: 'Cancelada',
};

const REQUEST_STATUS_COLORS: Partial<Record<RequestStatus, string>> = {
  em_triagem: '#c9975a',
  aguardando_aprovacao: '#e0a53a',
  aprovada: '#5b8def',
  em_atendimento: '#e0a53a',
  concluida: '#3fbf80',
  encerrada: '#9aa1ad',
  reprovada: '#e2605f',
  cancelada: '#9aa1ad',
};

const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  proposta: '#9aa1ad',
  aprovado: '#e0a53a',
  em_execucao: '#3fbf80',
  encerrado: '#e2605f',
};

const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  proposta: 'Proposta',
  aprovado: 'Aprovado',
  em_execucao: 'Em execução',
  encerrado: 'Encerrado',
};

const MODULE_SHORTCUTS: Array<{ label: string; icon: string; to: string; permission?: string }> = [
  { label: 'Colaboradores', icon: '☆', to: '/collaborators', permission: 'collaborator:read' },
  { label: 'Setores', icon: '▣', to: '/sectors', permission: 'sector:read' },
  { label: 'Centros de Custo', icon: '⧈', to: '/cost-centers', permission: 'cost_center:read' },
  { label: 'Clientes', icon: '◈', to: '/clients', permission: 'client:read' },
  { label: 'Projetos', icon: '⚑', to: '/projects', permission: 'project:read' },
  { label: 'Requisições', icon: '⚑︎', to: '/requests', permission: 'request:read' },
  { label: 'Integrações', icon: '⇄', to: '/integrations', permission: 'integration:read' },
];

export function DashboardPage() {
  const { user, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [counts, setCounts] = useState({
    collaborators: 0,
    clients: 0,
    activeProjects: 0,
    openTickets: 0,
    overdueTickets: 0,
    satellites: 0,
  });
  const [requestsByStatus, setRequestsByStatus] = useState<ChartDatum[]>([]);
  const [projectsByStatus, setProjectsByStatus] = useState<ChartDatum[]>([]);

  useEffect(() => {
    void (async () => {
      const [collaborators, clients, projects, requests, satellites] = await Promise.all([
        hasPermission('collaborator:read') ? collaboratorsApi.list() : Promise.resolve([]),
        hasPermission('client:read') ? clientsApi.list() : Promise.resolve([]),
        hasPermission('project:read') ? projectsApi.list() : Promise.resolve([]),
        hasPermission('request:read') ? requestsApi.queue() : Promise.resolve([]),
        hasPermission('integration:read') ? integrationApi.list() : Promise.resolve([]),
      ]);
      const now = Date.now();
      const openRequests = requests.filter((r) => REQUEST_OPEN_STATUSES.includes(r.status));
      setCounts({
        collaborators: collaborators.filter((c) => c.status === 'ativo').length,
        clients: clients.length,
        activeProjects: projects.filter((p) => p.status === 'em_execucao').length,
        openTickets: openRequests.length,
        overdueTickets: openRequests.filter((r) => r.slaDueResolutionAt !== null && new Date(r.slaDueResolutionAt).getTime() < now).length,
        satellites: satellites.filter((s) => s.status === 'active').length,
      });

      const requestCounts: Partial<Record<RequestStatus, number>> = {};
      for (const r of requests) requestCounts[r.status] = (requestCounts[r.status] ?? 0) + 1;
      setRequestsByStatus(
        (Object.keys(REQUEST_STATUS_LABELS) as RequestStatus[]).map((status) => ({
          label: REQUEST_STATUS_LABELS[status]!,
          value: requestCounts[status] ?? 0,
          color: REQUEST_STATUS_COLORS[status]!,
        })),
      );

      const projectCounts: Partial<Record<ProjectStatus, number>> = {};
      for (const p of projects) projectCounts[p.status] = (projectCounts[p.status] ?? 0) + 1;
      setProjectsByStatus(
        (Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((status) => ({
          label: PROJECT_STATUS_LABELS[status],
          value: projectCounts[status] ?? 0,
          color: PROJECT_STATUS_COLORS[status],
        })),
      );
    })();
  }, [hasPermission]);

  const visibleModules = MODULE_SHORTCUTS.filter((m) => !m.permission || hasPermission(m.permission));

  return (
    <AppLayout breadcrumb={['Axis', 'Dashboard']}>
      <h2 style={{ marginBottom: 4 }}>Olá, {user?.email}</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>Resumo geral do sistema</p>

      <KpiRow>
        <KpiCard icon="☆" label="Colaboradores ativos" value={counts.collaborators} />
        <KpiCard icon="◈" label="Clientes" value={counts.clients} />
        <KpiCard icon="⚑" label="Projetos em execução" value={counts.activeProjects} tone="success" />
        <KpiCard icon="⚑︎" label="Requisições abertos" value={counts.openTickets} tone="warning" />
        <KpiCard icon="⚠" label="Requisições fora do SLA" value={counts.overdueTickets} tone="danger" />
        <KpiCard icon="⇄" label="Satélites conectados" value={counts.satellites} />
      </KpiRow>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {hasPermission('request:read') && (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
            <h4 style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Requisições por status</h4>
            <PieChart data={requestsByStatus} />
          </div>
        )}
        {hasPermission('project:read') && (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
            <h4 style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Projetos por status</h4>
            <PieChart data={projectsByStatus} />
          </div>
        )}
      </div>

      {visibleModules.length > 0 && (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <h4 style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Módulos</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {visibleModules.map((m) => (
              <button
                key={m.to}
                onClick={() => navigate(m.to)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: 14,
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'var(--brand-gradient)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 15,
                  }}
                >
                  {m.icon}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </AppLayout>
  );
}
