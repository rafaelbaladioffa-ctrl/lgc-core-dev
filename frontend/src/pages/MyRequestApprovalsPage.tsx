import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { Button } from '../components/Button';
import { requestsApi, type MyApproval } from '../api/requests';

const cardStyle = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)' as const,
  padding: 14,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 6,
};

export function MyRequestApprovalsPage() {
  const navigate = useNavigate();
  const [approvals, setApprovals] = useState<MyApproval[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    setApprovals(await requestsApi.myApprovals());
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const approve = async (requestId: string) => {
    await requestsApi.approve(requestId);
    await refresh();
  };

  const reject = async (requestId: string) => {
    const comment = window.prompt('Motivo da reprovação:');
    if (!comment) return;
    await requestsApi.reject(requestId, comment);
    await refresh();
  };

  return (
    <AppLayout breadcrumb={['Axis', 'Minhas aprovações']}>
      <h2 style={{ marginBottom: 4 }}>Minhas aprovações</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>Requisições aguardando sua decisão nesta etapa da cadeia de aprovação.</p>

      {loading && <p>Carregando...</p>}
      {!loading && approvals.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhuma requisição aguardando sua aprovação.</p>}

      {!loading && approvals.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {approvals.map((a) => (
            <div key={a.approvalId} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => navigate(`/requests/${a.requestId}`)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit', fontWeight: 700 }}>
                  {a.code}
                </button>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Etapa: {a.requiredLevel ?? 'gestor direto'}</span>
              </div>
              <div style={{ fontSize: 13 }}>{a.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {a.categoryName} • Solicitante: {a.requesterName}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <Button variant="positive" onClick={() => void approve(a.requestId)}>
                  Aprovar
                </Button>
                <Button variant="danger" onClick={() => void reject(a.requestId)}>
                  Reprovar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
