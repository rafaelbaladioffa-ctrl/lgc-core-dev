import { useEffect, useState } from 'react';
import { DataTable, StatusBadge, type ColumnDef } from './DataTable';
import { SlideOver } from './SlideOver';
import { inboxApi, type InboxMessage, type InboxMessageDetail, type InboxStatus } from '../api/inbox';
import { extractApiMessages } from '../utils/apiError';
import { formatDateTime } from '../utils/formatDate';

const INBOX_STATUS_LABEL: Record<InboxStatus, string> = { processed: 'Processada', ignored: 'Ignorada', failed: 'Falhou' };
const INBOX_STATUS_TONE: Record<InboxStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  processed: 'success',
  ignored: 'default',
  failed: 'danger',
};

/** Últimas mensagens recebidas dos satélites (`integration_inbox`), com filtro por satélite e status. */
export function InboundMessagesPanel({ satellites }: { satellites: Array<{ id: string; name: string }> }) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [satelliteId, setSatelliteId] = useState('');
  const [status, setStatus] = useState<InboxStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<InboxMessageDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    inboxApi
      .list({ satelliteId: satelliteId || undefined, status: status || undefined, perPage: 100 })
      .then((r) => {
        if (cancelled) return;
        setMessages(r.data);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setMessages([]);
          setError(extractApiMessages(err, 'Não foi possível carregar as mensagens recebidas.')[0]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [satelliteId, status]);

  // O carregamento recomeça no gesto que muda o filtro, não dentro do efeito.
  const changeSatellite = (value: string) => {
    setLoading(true);
    setSatelliteId(value);
  };
  const changeStatus = (value: InboxStatus | '') => {
    setLoading(true);
    setStatus(value);
  };

  const openDetail = (id: string) => {
    setError(null);
    inboxApi
      .get(id)
      .then(setDetail)
      .catch((err) => setError(extractApiMessages(err, 'Não foi possível abrir a mensagem.')[0]));
  };

  const columns: ColumnDef<InboxMessage>[] = [
    {
      key: 'eventType',
      header: 'Evento',
      render: (m) => (
        <button
          onClick={() => openDetail(m.id)}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}
        >
          {m.eventType}
        </button>
      ),
      filterable: true,
      filterValue: (m) => m.eventType,
    },
    { key: 'satelliteName', header: 'Satélite', render: (m) => m.satelliteName },
    { key: 'status', header: 'Status', render: (m) => <StatusBadge label={INBOX_STATUS_LABEL[m.status]} tone={INBOX_STATUS_TONE[m.status]} /> },
    { key: 'receivedAt', header: 'Recebida em', render: (m) => formatDateTime(m.receivedAt) },
    { key: 'error', header: 'Erro', render: (m) => m.error ?? '—' },
  ];

  return (
    <>
      <div style={{ marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select aria-label="Filtrar por satélite" value={satelliteId} onChange={(e) => changeSatellite(e.target.value)} style={{ fontSize: 13 }}>
          <option value="">Todos os satélites</option>
          {satellites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select aria-label="Filtrar por status" value={status} onChange={(e) => changeStatus(e.target.value as InboxStatus | '')} style={{ fontSize: 13 }}>
          <option value="">Todos os status</option>
          <option value="processed">Processada</option>
          <option value="ignored">Ignorada</option>
          <option value="failed">Falhou</option>
        </select>
      </div>

      {error && (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 12px' }}>
          {error}
        </p>
      )}

      <DataTable
        columns={columns}
        rows={messages}
        rowKey={(m) => m.id}
        emptyMessage={loading ? 'Carregando...' : 'Nenhuma mensagem recebida.'}
      />

      {detail && (
        <SlideOver title={`Mensagem ${detail.eventType}`} onClose={() => setDetail(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <StatusBadge label={INBOX_STATUS_LABEL[detail.status]} tone={INBOX_STATUS_TONE[detail.status]} />
            <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Satélite:</span> {detail.satelliteName}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Id do evento:</span> <code>{detail.eventId}</code>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Recebida em:</span> {formatDateTime(detail.receivedAt)}
              </div>
              {detail.processedAt && (
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Tratada em:</span> {formatDateTime(detail.processedAt)}
                </div>
              )}
              {detail.error && (
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Erro:</span> {detail.error}
                </div>
              )}
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
    </>
  );
}
