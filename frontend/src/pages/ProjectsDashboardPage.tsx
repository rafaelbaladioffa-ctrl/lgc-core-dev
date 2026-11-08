import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { PieChart, BarChart, type ChartDatum } from '../components/charts';
import { projectsApi, type Project, type ProjectStatus } from '../api/projects';
import { costCentersApi, type CostCenter } from '../api/costCenters';
import { clientsApi, type Client } from '../api/clients';

const STATUS_COLORS: Record<ProjectStatus, string> = {
  proposta: '#9aa1ad',
  aprovado: '#e0a53a',
  em_execucao: '#3fbf80',
  encerrado: '#e2605f',
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  proposta: 'Proposta',
  aprovado: 'Aprovado',
  em_execucao: 'Em execução',
  encerrado: 'Encerrado',
};

const BAR_COLORS = ['#5b8def', '#e0a53a', '#3fbf80', '#e2605f', '#9b6bdb', '#3ac8c0'];

export function ProjectsDashboardPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    void Promise.all([projectsApi.list(), costCentersApi.list(), clientsApi.list()]).then(([p, cc, c]) => {
      setProjects(p);
      setCostCenters(cc);
      setClients(c);
    });
  }, []);

  const byStatus: ChartDatum[] = (Object.keys(STATUS_LABELS) as ProjectStatus[]).map((status) => ({
    label: STATUS_LABELS[status],
    value: projects.filter((p) => p.status === status).length,
    color: STATUS_COLORS[status],
  }));

  const costCenterCounts = new Map<string, number>();
  for (const p of projects) costCenterCounts.set(p.costCenterId, (costCenterCounts.get(p.costCenterId) ?? 0) + 1);
  const byCostCenter: ChartDatum[] = Array.from(costCenterCounts.entries())
    .map(([id, value], i) => ({
      label: costCenters.find((c) => c.id === id)?.code ?? '—',
      value,
      color: BAR_COLORS[i % BAR_COLORS.length],
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.legalName ?? '—';
  const costCenterName = (id: string) => costCenters.find((c) => c.id === id)?.name ?? '—';

  return (
    <AppLayout breadcrumb={['Axis', 'Projetos', 'Dashboard']}>
      <button
        onClick={() => navigate('/projects')}
        style={{ marginBottom: 16, fontSize: 13, padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)' }}
      >
        ← Voltar para Projetos
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <h4 style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Projetos por status</h4>
          <PieChart data={byStatus} />
        </div>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <h4 style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Projetos por centro de custo</h4>
          <BarChart data={byCostCenter} />
        </div>
      </div>

      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <th style={{ padding: '8px 14px' }}>Código</th>
              <th style={{ padding: '8px 14px' }}>Cliente</th>
              <th style={{ padding: '8px 14px' }}>Centro de custo</th>
              <th style={{ padding: '8px 14px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 14px' }}>{p.name ? `${p.code} — ${p.name}` : p.code}</td>
                <td style={{ padding: '8px 14px' }}>{clientName(p.clientId)}</td>
                <td style={{ padding: '8px 14px' }}>{costCenterName(p.costCenterId)}</td>
                <td style={{ padding: '8px 14px' }}>{STATUS_LABELS[p.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppLayout>
  );
}
