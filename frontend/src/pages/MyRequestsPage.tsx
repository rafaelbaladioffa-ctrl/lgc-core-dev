import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { DataTable, StatusBadge, type ColumnDef } from '../components/DataTable';
import { Button } from '../components/Button';
import { requestsApi, type AxisRequest, type RequestStatus } from '../api/requests';
import { formatDate } from '../utils/formatDate';

const STATUS_LABEL: Record<RequestStatus, string> = {
  rascunho: 'Rascunho',
  enviada: 'Enviada',
  em_triagem: 'Em triagem',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovada: 'Aprovada',
  planejada: 'Planejada',
  em_atendimento: 'Em atendimento',
  aguardando_solicitante: 'Aguardando solicitante',
  aguardando_terceiro: 'Aguardando terceiro',
  concluida: 'Concluída',
  encerrada: 'Encerrada',
  devolvida_ajuste: 'Devolvida para ajuste',
  reprovada: 'Reprovada',
  cancelada: 'Cancelada',
  suspensa: 'Suspensa',
  reaberta: 'Reaberta',
  expirada: 'Expirada',
};

const STATUS_TONE: Record<RequestStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  rascunho: 'default',
  enviada: 'default',
  em_triagem: 'warning',
  aguardando_aprovacao: 'warning',
  aprovada: 'default',
  planejada: 'default',
  em_atendimento: 'warning',
  aguardando_solicitante: 'warning',
  aguardando_terceiro: 'warning',
  concluida: 'success',
  encerrada: 'success',
  devolvida_ajuste: 'danger',
  reprovada: 'danger',
  cancelada: 'danger',
  suspensa: 'warning',
  reaberta: 'warning',
  expirada: 'danger',
};

export function MyRequestsPage() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<AxisRequest[]>([]);

  useEffect(() => {
    void requestsApi.mine().then(setRequests);
  }, []);

  const columns: ColumnDef<AxisRequest>[] = [
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
    { key: 'priority', header: 'Prioridade', render: (r) => r.priority },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />, filterable: true, filterValue: (r) => STATUS_LABEL[r.status] },
    { key: 'neededBy', header: 'Necessário até', render: (r) => (r.neededBy ? formatDate(r.neededBy) : '—') },
    { key: 'createdAt', header: 'Criada em', render: (r) => formatDate(r.createdAt) },
  ];

  return (
    <AppLayout breadcrumb={['Axis', 'Requisições', 'Minhas requisições']}>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="positive" onClick={() => navigate('/requests/new')}>
          + Nova requisição
        </Button>
      </div>
      <DataTable columns={columns} rows={requests} rowKey={(r) => r.id} />
    </AppLayout>
  );
}
