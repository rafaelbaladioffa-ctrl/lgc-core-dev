import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { StatusBadge } from '../components/DataTable';
import { Button } from '../components/Button';
import { useAuth } from '../context/AuthContext';
import { requestsApi, type RequestDetail, type RequestStatus } from '../api/requests';
import { formatDateTime } from '../utils/formatDate';

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

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission, user } = useAuth();
  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [commentBody, setCommentBody] = useState('');

  const refresh = async () => {
    if (!id) return;
    setRequest(await requestsApi.get(id));
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!request) return <AppLayout breadcrumb={['Axis', 'Requisições', 'Detalhe']}><p>Carregando...</p></AppLayout>;

  const canUpdate = hasPermission('request:update');
  const canApprove = hasPermission('request:approve');
  const canCreate = hasPermission('request:create');

  const run = async (action: () => Promise<unknown>) => {
    await action();
    await refresh();
  };

  const triage = (type: 'aceitar' | 'devolver') => {
    if (type === 'devolver') {
      const reason = window.prompt('Motivo da devolução:');
      if (!reason) return;
      void run(() => requestsApi.triage(request.id, 'devolver', reason));
    } else {
      void run(() => requestsApi.triage(request.id, 'aceitar'));
    }
  };

  const decide = (type: 'approve' | 'reject') => {
    if (type === 'reject') {
      const comment = window.prompt('Motivo da reprovação:');
      if (!comment) return;
      void run(() => requestsApi.reject(request.id, comment));
    } else {
      void run(() => requestsApi.approve(request.id));
    }
  };

  const requestInfo = () => {
    const question = window.prompt('O que você precisa perguntar ao solicitante?');
    if (!question) return;
    void run(() => requestsApi.requestInformation(request.id, question));
  };

  const complete = () => {
    const resolution = window.prompt('Resolução/evidência de conclusão:');
    if (!resolution) return;
    void run(() => requestsApi.complete(request.id, resolution));
  };

  const cancel = () => {
    const reason = window.prompt('Motivo do cancelamento:');
    if (!reason) return;
    void run(() => requestsApi.cancel(request.id, reason));
  };

  const reopen = () => {
    const reason = window.prompt('Motivo da reabertura:');
    if (!reason) return;
    void run(() => requestsApi.reopen(request.id, reason));
  };

  const addComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentBody.trim()) return;
    await requestsApi.comment(request.id, commentBody);
    setCommentBody('');
    await refresh();
  };

  return (
    <AppLayout breadcrumb={['Axis', 'Requisições', request.code]}>
      <button onClick={() => navigate(-1)} style={{ marginBottom: 16, fontSize: 13, padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)' }}>
        ← Voltar
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>{request.code}</h2>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{request.categoryVersion.category.name}</div>
          </div>
          <StatusBadge label={STATUS_LABEL[request.status]} tone="default" />
        </div>

        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <strong>{request.title}</strong>
          </div>
          <div style={{ color: 'var(--text-muted)' }}>{request.description}</div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Prioridade:</span> {request.priority} · <span style={{ color: 'var(--text-muted)' }}>Confidencialidade:</span> {request.confidentiality}
            {request.anonymous && (
              <>
                {' · '}
                <span style={{ color: 'var(--text-muted)' }}>Solicitante:</span> {request.requesterDisplay ?? 'Anônimo'}
              </>
            )}
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Criada em:</span> {formatDateTime(request.createdAt)}
          </div>
          {request.slaDueResolutionAt && (
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Prazo de solução:</span> {formatDateTime(request.slaDueResolutionAt)}
            </div>
          )}
        </div>

        {request.approvals.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Cadeia de aprovação</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {request.approvals.map((a) => (
                <div key={a.id} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
                  <span>
                    {a.stepOrder}. {a.requiredLevel ?? 'gestor direto'} — {a.approver.fullName}
                  </span>
                  <StatusBadge label={a.status} tone={a.status === 'pendente' ? 'default' : a.status === 'aprovado' ? 'success' : 'danger'} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Subtarefas</div>
            <button
              onClick={() => navigate(`/requests/new?parentRequestId=${request.id}`)}
              style={{ fontSize: 11, padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)' }}
            >
              + Nova subtarefa
            </button>
          </div>
          {request.relationsAsTarget.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhuma subtarefa.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {request.relationsAsTarget.map((link) => (
                <button
                  key={link.source.id}
                  onClick={() => navigate(`/requests/${link.source.id}`)}
                  style={{ textAlign: 'left', fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, cursor: 'pointer' }}
                >
                  <span>
                    {link.source.code} — {link.source.title}
                  </span>
                  <StatusBadge label={STATUS_LABEL[link.source.status]} tone="default" />
                </button>
              ))}
            </div>
          )}
        </div>

        {request.categoryVersion.category.requiresAcceptance && request.status === 'concluida' && (
          <div>
            {request.requesterAcceptedAt ? (
              <p style={{ fontSize: 12, color: 'var(--success)' }}>Aceite do solicitante confirmado em {formatDateTime(request.requesterAcceptedAt)}.</p>
            ) : user?.collaboratorId === request.requesterId ? (
              <Button variant="positive" onClick={() => void run(() => requestsApi.accept(request.id))}>
                Confirmar aceite da entrega
              </Button>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aguardando aceite do solicitante antes de encerrar (categoria exige confirmação).</p>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canUpdate && request.status === 'enviada' && (
            <>
              <Button variant="positive" onClick={() => triage('aceitar')}>
                Aceitar triagem
              </Button>
              <Button variant="danger" onClick={() => triage('devolver')}>
                Devolver para ajuste
              </Button>
            </>
          )}
          {canApprove && request.status === 'aguardando_aprovacao' && (
            <>
              <Button variant="positive" onClick={() => decide('approve')}>
                Aprovar
              </Button>
              <Button variant="danger" onClick={() => decide('reject')}>
                Reprovar
              </Button>
            </>
          )}
          {canUpdate && ['aprovada', 'planejada'].includes(request.status) && (
            <Button variant="positive" onClick={() => void run(() => requestsApi.start(request.id))}>
              Iniciar atendimento
            </Button>
          )}
          {canUpdate && request.status === 'em_atendimento' && (
            <>
              <Button variant="secondary" onClick={requestInfo}>
                Pedir informação ao solicitante
              </Button>
              <Button variant="positive" onClick={complete}>
                Concluir
              </Button>
            </>
          )}
          {canUpdate && ['aguardando_solicitante', 'aguardando_terceiro'].includes(request.status) && (
            <Button variant="secondary" onClick={() => void run(() => requestsApi.resume(request.id))}>
              Retomar atendimento
            </Button>
          )}
          {canUpdate && request.status === 'concluida' && (
            <Button variant="positive" onClick={() => void run(() => requestsApi.close(request.id))}>
              Encerrar
            </Button>
          )}
          {canUpdate && ['concluida', 'encerrada', 'reprovada'].includes(request.status) && (
            <Button variant="secondary" onClick={reopen}>
              Reabrir
            </Button>
          )}
          {canCreate && !['concluida', 'encerrada', 'cancelada'].includes(request.status) && (
            <Button variant="danger" onClick={cancel}>
              Cancelar
            </Button>
          )}
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Comentários</div>
          {request.comments.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhum comentário.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
              {request.comments.map((c) => (
                <div key={c.id} style={{ fontSize: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>
                    {formatDateTime(c.createdAt)} {c.visibility === 'interno' && '· nota interna'}
                  </div>
                  {c.body}
                </div>
              ))}
            </div>
          )}
          <form onSubmit={addComment} style={{ display: 'flex', gap: 8 }}>
            <input placeholder="Adicionar comentário..." value={commentBody} onChange={(e) => setCommentBody(e.target.value)} style={{ flex: 1 }} />
            <Button type="submit" variant="secondary">
              Enviar
            </Button>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}
