import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { DataTable, StatusBadge, type ColumnDef } from '../components/DataTable';
import { KpiCard, KpiRow } from '../components/KpiCard';
import { SlideOver } from '../components/SlideOver';
import { integrationApi, type Satellite } from '../api/integration';
import { outboxApi, type OutboxEvent, type OutboxEventDetail, type OutboxStatus } from '../api/outbox';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';
import { formatDateTime } from '../utils/formatDate';
import { extractApiMessages, translateApiError } from '../utils/apiError';
import { InboundMessagesPanel } from '../components/InboundMessagesPanel';
import '../styles/integrations.css';

const OUTBOX_STATUS_LABEL: Record<OutboxStatus, string> = { pending: 'Pendente', delivered: 'Entregue', failed: 'Falhou' };
const OUTBOX_STATUS_TONE: Record<OutboxStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  delivered: 'success',
  failed: 'danger',
};

const TABS = [
  { key: 'satellites', label: 'Satélites' },
  { key: 'outbox', label: 'Eventos (Outbox)' },
  { key: 'inbox', label: 'Mensagens recebidas' },
] as const;

export function IntegrationsPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'satellites' | 'outbox' | 'inbox'>('satellites');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [satellites, setSatellites] = useState<Satellite[]>([]);
  const [events, setEvents] = useState<OutboxEvent[]>([]);
  const [statusFilter, setStatusFilter] = useState<OutboxStatus | ''>('');
  const [detail, setDetail] = useState<OutboxEventDetail | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [resyncMessage, setResyncMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // Carga inicial do cache dos satélites: manda o estado atual dos cadastros como eventos de atualização.
  const resyncMasterData = async () => {
    if (!window.confirm('Reenviar a todos os satélites inscritos os centros de custo, colaboradores e alocações atuais?')) return;
    setResyncing(true);
    setResyncMessage(null);
    try {
      const r = await integrationApi.resyncMasterData();
      setResyncMessage({ tone: 'ok', text: `Reenvio registrado: ${r.costCenters} centros de custo, ${r.collaborators} colaboradores, ${r.allocations} alocações e ${r.sites} sites. A entrega aparece em Eventos (Outbox).` });
    } catch (err) {
      setResyncMessage({ tone: 'error', text: translateApiError(err, 'Não foi possível reenviar os cadastros.') });
    } finally {
      setResyncing(false);
    }
  };

  useEffect(() => {
    integrationApi
      .list()
      .then(setSatellites)
      .catch((err) => setLoadError(extractApiMessages(err, 'Não foi possível carregar os satélites.')[0]));
  }, []);

  // Abre a aba ANTES do fetch (gesto do usuário síncrono) pra não ser bloqueado como pop-up —
  // só define a URL de verdade quando o token (90s) volta. A URL nunca é guardada/reusada.
  const launchSatellite = async (id: string) => {
    // Sem noopener/noreferrer: precisamos da referência pra definir a URL depois do fetch —
    // aceitável porque frontendUrl é configurado por um admin (integration:manage), não por
    // entrada de usuário/terceiro.
    const win = window.open('', '_blank');
    try {
      const { url } = await integrationApi.launch(id);
      if (win) win.location.href = url;
    } catch (err) {
      win?.close();
      throw err;
    }
  };

  useEffect(() => {
    if (tab !== 'outbox') return;
    outboxApi
      .list({ status: statusFilter || undefined, perPage: 100 })
      .then((r) => {
        setEvents(r.data);
        setLoadError(null);
      })
      .catch((err) => setLoadError(extractApiMessages(err, 'Não foi possível carregar os eventos enviados.')[0]));
  }, [tab, statusFilter]);

  const satelliteColumns: ColumnDef<Satellite>[] = [
    { key: 'name', header: 'Nome', render: (s) => s.name, filterable: true },
    { key: 'webhookUrl', header: 'Webhook', render: (s) => <code style={{ fontSize: 12 }}>{s.webhookUrl}</code> },
    {
      key: 'status',
      header: 'Status',
      render: (s) => <StatusBadge label={s.status === 'active' ? 'Ativo' : 'Inativo'} tone={s.status === 'active' ? 'success' : 'danger'} />,
    },
    {
      key: 'subscribedEvents',
      header: 'Eventos inscritos',
      render: (s) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {s.subscribedEvents.map((eventType) => (
            <StatusBadge key={eventType} label={eventType} tone="default" />
          ))}
        </div>
      ),
    },
    {
      key: 'lastEvent',
      header: 'Última entrega',
      render: (s) =>
        s.lastEvent ? (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {s.lastEvent.eventType} — {s.lastEvent.status}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (s) => (
        <div style={{ display: 'flex', gap: 6 }}>
          {s.frontendUrl && (
            <button
              onClick={() => void launchSatellite(s.id)}
              style={{ fontSize: 12, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              Abrir
            </button>
          )}
          {hasPermission('integration:manage') && (
            <button
              onClick={() => integrationApi.testWebhook(s.id)}
              style={{ fontSize: 12, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)' }}
            >
              Testar webhook
            </button>
          )}
        </div>
      ),
    },
  ];

  const outboxColumns: ColumnDef<OutboxEvent>[] = [
    {
      key: 'eventType',
      header: 'Evento',
      render: (e) => (
        <button
          onClick={() => void outboxApi.get(e.id).then(setDetail)}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}
        >
          {e.eventType}
        </button>
      ),
      filterable: true,
      filterValue: (e) => e.eventType,
    },
    { key: 'status', header: 'Status', render: (e) => <StatusBadge label={OUTBOX_STATUS_LABEL[e.status]} tone={OUTBOX_STATUS_TONE[e.status]} /> },
    { key: 'attempts', header: 'Tentativas', render: (e) => e.attempts },
    { key: 'createdAt', header: 'Criado em', render: (e) => formatDateTime(e.createdAt) },
    { key: 'lastError', header: 'Último erro', render: (e) => e.lastError ?? '—' },
  ];

  return (
    <AppLayout breadcrumb={['Axis', 'Integrações']}>
      <KpiRow>
        <KpiCard label="Satélites registrados" value={satellites.length} />
        <KpiCard label="Ativos" value={satellites.filter((s) => s.status === 'active').length} tone="success" />
      </KpiRow>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: tab === key ? 'var(--accent-soft)' : 'var(--bg-elevated)',
              color: tab === key ? 'var(--accent)' : 'var(--text)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loadError && (
        <p role="alert" className="integration-notice integration-notice--error">
          {loadError}
        </p>
      )}

      {resyncMessage && (
        <p role={resyncMessage.tone === 'error' ? 'alert' : 'status'} className={resyncMessage.tone === 'error' ? 'integration-notice integration-notice--error' : 'integration-notice'}>
          {resyncMessage.text}
        </p>
      )}

      {tab === 'satellites' ? (
        <DataTable
          columns={satelliteColumns}
          rows={satellites}
          rowKey={(s) => s.id}
          toolbar={
            hasPermission('integration:manage') && (
              <>
                <Button onClick={() => void resyncMasterData()} disabled={resyncing}>
                  {resyncing ? 'Reenviando…' : 'Reenviar cadastros'}
                </Button>
                <Button variant="positive" onClick={() => navigate('/integrations/new')}>
                  + Novo satélite
                </Button>
              </>
            )
          }
        />
      ) : tab === 'inbox' ? (
        <InboundMessagesPanel satellites={satellites} />
      ) : (
        <>
          <div style={{ marginBottom: 10 }}>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as OutboxStatus | '')} style={{ fontSize: 13 }}>
              <option value="">Todos os status</option>
              <option value="pending">Pendente</option>
              <option value="delivered">Entregue</option>
              <option value="failed">Falhou</option>
            </select>
          </div>
          <DataTable columns={outboxColumns} rows={events} rowKey={(e) => e.id} />
        </>
      )}

      {detail && (
        <SlideOver title={`Evento ${detail.eventType}`} onClose={() => setDetail(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <StatusBadge label={OUTBOX_STATUS_LABEL[detail.status]} tone={OUTBOX_STATUS_TONE[detail.status]} />
            <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Tentativas:</span> {detail.attempts}
              </div>
              {detail.lastError && (
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Último erro:</span> {detail.lastError}
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Linha do tempo</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {detail.timeline.map((step, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        marginTop: 3,
                        background: step.done ? 'var(--success)' : 'var(--border)',
                        flexShrink: 0,
                      }}
                    />
                    <div>
                      <div style={{ fontSize: 13 }}>{step.label}</div>
                      {step.at && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(step.at).toLocaleString('pt-BR')}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Payload</div>
              <pre style={{ background: 'var(--bg)', borderRadius: 6, padding: 10, fontSize: 11, overflowX: 'auto' }}>
                {JSON.stringify(detail.payload, null, 2)}
              </pre>
            </div>
          </div>
        </SlideOver>
      )}
    </AppLayout>
  );
}
