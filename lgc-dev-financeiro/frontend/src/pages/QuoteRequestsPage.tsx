import { useState } from 'react';
import { listQuoteRequests, REVISION_STATUS, startQuote, type QuoteRequestStatus } from '../lib/budgets';
import { formatDateTime } from '../lib/format';
import { navigate } from '../lib/router';
import { Badge, ErrorAlert, messageOf, PageHeader, useLoad } from '../components/ui';

const STATUS: Record<QuoteRequestStatus, { label: string; tone: 'warning' | 'neutral' | 'success' }> = {
  pendente: { label: 'Pendente', tone: 'warning' },
  em_cotacao: { label: 'Em cotação', tone: 'neutral' },
  respondida: { label: 'Envio aprovado', tone: 'success' },
};

/**
 * Fila de pedidos de cotação vindos do Axis Core ("Solicitar cotação" no projeto). "Iniciar cotação" abre o
 * orçamento aws_sow do projeto (cria na primeira vez) e importa a SOW em PDF e o Bid Template do pedido.
 */
export function QuoteRequestsPage({ canWrite }: { canWrite: boolean }) {
  const { data, error, loading, reload } = useLoad(listQuoteRequests, [], 'Não foi possível carregar os pedidos de cotação.');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function start(id: string) {
    setBusy(id);
    setActionError(null);
    try {
      const out = await startQuote(id);
      const query = new URLSearchParams();
      if (!out.sowImported) query.set('sowError', out.sowError ?? '');
      if (!out.bidTemplateImported) query.set('bidTemplateError', out.bidTemplateError ?? '');
      navigate(`/revisoes/${out.revisionId}${query.size ? `?${query.toString()}` : ''}`);
    } catch (e) {
      setActionError(messageOf(e, 'Não foi possível iniciar a cotação.'));
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Pedidos de cotação">
        <p className="muted">Pedidos feitos no Axis Core com a SOW e o Bid Template do cliente. A cotação aprovada para envio volta para o projeto no Core.</p>
      </PageHeader>
      {actionError && <ErrorAlert message={actionError} />}
      {error && <ErrorAlert message={error} onRetry={reload} />}
      {loading && !data && <p className="muted">Carregando…</p>}
      {data && (
        <div className="card table-card table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Projeto</th>
                <th>Pedido</th>
                <th>Documentos</th>
                <th>Situação</th>
                <th>Revisão</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted empty">
                    Nenhum pedido de cotação. Eles chegam quando alguém clica em "Solicitar cotação" no projeto do Axis Core.
                  </td>
                </tr>
              )}
              {data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`#/projetos/${encodeURIComponent(r.axisProjectId)}`}>{r.projectCode}</a>
                    <div className="cell-sub">{r.projectName ?? <span className="muted">Sem nome no Axis Core</span>}</div>
                  </td>
                  <td>
                    {formatDateTime(r.requestedAt)}
                    <div className="cell-sub">{r.requestedByEmail ?? '—'}</div>
                    {r.notes && <div className="cell-sub">“{r.notes}”</div>}
                  </td>
                  <td>
                    SOW v{r.sowVersion}
                    <div className="cell-sub">{r.bidTemplateVersion ? `Bid Template v${r.bidTemplateVersion}` : 'sem Bid Template'}</div>
                  </td>
                  <td>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  </td>
                  <td>
                    {r.currentRevision ? (
                      <a href={`#/revisoes/${r.currentRevision.id}`}>
                        R{r.currentRevision.number} · {REVISION_STATUS[r.currentRevision.status].label}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="nowrap">
                    {canWrite && r.status !== 'respondida' && (
                      <button className="btn btn-primary btn-sm" type="button" disabled={busy !== null} onClick={() => void start(r.id)}>
                        {busy === r.id ? 'Abrindo…' : r.draftRevisionId ? 'Continuar cotação' : 'Iniciar cotação'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
