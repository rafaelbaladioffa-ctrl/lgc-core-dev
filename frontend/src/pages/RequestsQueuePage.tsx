import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { DataTable, StatusBadge, type ColumnDef } from '../components/DataTable';
import { requestsApi, type QueueRequest } from '../api/requests';
import { sectorsApi, type Sector } from '../api/sectors';
import { formatDate } from '../utils/formatDate';
import { useAuth } from '../context/AuthContext';
import { translateApiError } from '../utils/apiError';

/** Fila do setor (§15.1.5) — visão tabela das requisições por setor; distribuição/kanban
 * avançado fica para a Fase 2. */
export function RequestsQueuePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [requests, setRequests] = useState<QueueRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [sectorId, setSectorId] = useState('');
  const isSupplyAnalyst = user?.roles.includes('analista_suprimentos') ?? false;

  useEffect(() => {
    void sectorsApi.list().then(setSectors);
  }, []);

  useEffect(() => {
    requestsApi
      .queue({ sectorId: sectorId || undefined })
      .then((rows) => {
        setRequests(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        setRequests([]);
        setError(translateApiError(err, 'Não foi possível carregar a fila.'));
      });
  }, [sectorId]);

  const sectorName = (id: string) => sectors.find((s) => s.id === id)?.name ?? '—';

  const columns: ColumnDef<QueueRequest>[] = [
    {
      key: 'code',
      header: 'Código',
      render: (r) => (
        <button onClick={() => navigate(`/requests/${r.id}`)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}>
          {r.code}
        </button>
      ),
      filterable: true,
      filterValue: (r) => r.code,
      width: '150px',
    },
    { key: 'title', header: 'Título', render: (r) => r.title, filterable: true, filterValue: (r) => r.title },
    { key: 'sector', header: 'Setor', render: (r) => sectorName(r.sectorId) },
    { key: 'priority', header: 'Prioridade', render: (r) => r.priority },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge label={r.status} tone="default" /> },
    { key: 'createdAt', header: 'Criada em', render: (r) => formatDate(r.createdAt) },
  ];

  return (
    <AppLayout breadcrumb={['Axis', 'Requisições', 'Minha fila']}>
      <div style={{ marginBottom: 12 }}>
        {isSupplyAnalyst && <p style={{ margin: '0 0 8px', color: 'var(--text-muted)' }}>Exibindo as requisições encaminhadas ao seu setor de Suprimentos.</p>}
        {!isSupplyAnalyst && (
        <select value={sectorId} onChange={(e) => setSectorId(e.target.value)} style={{ width: 260 }}>
          <option value="">Todos os setores</option>
          {sectors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        )}
      </div>
      {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}
      <DataTable columns={columns} rows={requests} rowKey={(r) => r.id} />
    </AppLayout>
  );
}
