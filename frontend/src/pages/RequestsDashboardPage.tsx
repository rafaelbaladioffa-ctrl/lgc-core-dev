import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { KpiCard, KpiRow } from '../components/KpiCard';
import { PieChart, type ChartDatum } from '../components/charts';
import { requestsApi, type RequestsDashboard } from '../api/requests';
import { collaboratorsApi, type CollaboratorSafe } from '../api/collaborators';

const STATUS_LABEL: Record<string, string> = {
  rascunho: 'Rascunho',
  enviada: 'Enviada',
  em_triagem: 'Em triagem',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovada: 'Aprovada',
  planejada: 'Planejada',
  em_atendimento: 'Em atendimento',
  aguardando_solicitante: 'Aguardando solicitante',
  aguardando_terceiro: 'Aguardando terceiro',
  aguardando_entrega: 'Aguardando entrega',
  concluida: 'Concluída',
  encerrada: 'Encerrada',
  devolvida_ajuste: 'Devolvida para ajuste',
  reprovada: 'Reprovada',
  cancelada: 'Cancelada',
  suspensa: 'Suspensa',
  reaberta: 'Reaberta',
  expirada: 'Expirada',
};

const STATUS_COLOR: Record<string, string> = {
  rascunho: '#9aa1ad',
  enviada: '#5b8def',
  em_triagem: '#c9975a',
  aguardando_aprovacao: '#e0a53a',
  aprovada: '#5b8def',
  em_atendimento: '#e0a53a',
  aguardando_solicitante: '#e0a53a',
  concluida: '#3fbf80',
  encerrada: '#9aa1ad',
  devolvida_ajuste: '#e2605f',
  reprovada: '#e2605f',
  cancelada: '#9aa1ad',
};

/** Painel gerencial (§15.1 item 7, §19) — primeiro incremento: volume por status, backlog/aging,
 * percentis de SLA de solução, taxas de devolução/reprovação/reabertura e carga por responsável.
 * Tudo calculado a partir de dados reais via RequestsService.dashboard(). */
export function RequestsDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<RequestsDashboard | null>(null);
  const [collaborators, setCollaborators] = useState<CollaboratorSafe[]>([]);

  useEffect(() => {
    void requestsApi.dashboard().then(setData);
    void collaboratorsApi.list().then(setCollaborators);
  }, []);

  if (!data) return <AppLayout breadcrumb={['Axis', 'Requisições', 'Painel gerencial']}><p>Carregando...</p></AppLayout>;

  const collaboratorName = (id: string) => collaborators.find((c) => c.id === id)?.fullName ?? '—';
  const statusSeries: ChartDatum[] = data.byStatus.map((s) => ({ label: STATUS_LABEL[s.status] ?? s.status, value: s.count, color: STATUS_COLOR[s.status] ?? '#9aa1ad' }));
  const totalRequests = data.byStatus.reduce((acc, s) => acc + s.count, 0);

  return (
    <AppLayout breadcrumb={['Axis', 'Requisições', 'Painel gerencial']}>
      <button onClick={() => navigate('/requests')} style={{ marginBottom: 16, fontSize: 13, padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)' }}>
        ← Voltar para Requisições
      </button>

      <KpiRow>
        <KpiCard label="Total de requisições" value={totalRequests} />
        <KpiCard label="Backlog (em aberto)" value={data.backlogOpen} tone="warning" />
        <KpiCard label="SLA solução — P50 (h)" value={data.slaResolutionHours.p50 ?? '—'} />
        <KpiCard label="SLA solução — P90 (h)" value={data.slaResolutionHours.p90 ?? '—'} tone="warning" />
        <KpiCard label="SLA solução — P95 (h)" value={data.slaResolutionHours.p95 ?? '—'} tone="danger" />
      </KpiRow>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <h4 style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Volume por status</h4>
          <PieChart data={statusSeries} />
        </div>

        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <h4 style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Aging do backlog (dias em aberto)</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(data.aging).map(([bucket, count]) => (
              <div key={bucket} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>{bucket}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <h4 style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Taxas</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Devolução (triagem)</span>
              <strong>{data.rates.devolucao !== null ? `${data.rates.devolucao}%` : '—'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Reprovação</span>
              <strong>{data.rates.reprovacao !== null ? `${data.rates.reprovacao}%` : '—'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Reabertura</span>
              <strong>{data.rates.reabertura !== null ? `${data.rates.reabertura}%` : '—'}</strong>
            </div>
          </div>
        </div>

        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <h4 style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Carga por responsável (em aberto)</h4>
          {data.loadByAssignee.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhuma requisição atribuída em aberto.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              {data.loadByAssignee
                .sort((a, b) => b.count - a.count)
                .map((a) => (
                  <div key={a.assigneeId} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{collaboratorName(a.assigneeId)}</span>
                    <strong>{a.count}</strong>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
