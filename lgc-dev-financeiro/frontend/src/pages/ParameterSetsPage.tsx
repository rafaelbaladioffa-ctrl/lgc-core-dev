import { useState } from 'react';
import { createParameterDraft, listParameterSets, STATUS_LABEL, type ParameterSetStatus } from '../lib/budgetParams';
import { formatDate, formatDateTime } from '../lib/format';
import { navigate } from '../lib/router';
import { Badge, ErrorAlert, messageOf, PageHeader, useLoad } from '../components/ui';

const TONE: Record<ParameterSetStatus, 'success' | 'warning' | 'neutral'> = { vigente: 'success', rascunho: 'warning', arquivado: 'neutral' };

export function ParameterSetsPage({ canWrite }: { canWrite: boolean }) {
  const { data, error, loading, reload } = useLoad(listParameterSets, [], 'Não foi possível carregar os parâmetros.');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const draft = data?.find((s) => s.status === 'rascunho');

  async function newDraft() {
    setBusy(true);
    setActionError(null);
    try {
      const { id } = await createParameterDraft();
      navigate(`/parametros/${id}`);
    } catch (e) {
      setActionError(messageOf(e, 'Não foi possível criar o rascunho.'));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Parâmetros de orçamento"
        actions={
          canWrite &&
          (draft ? (
            <a className="btn btn-primary" href={`#/parametros/${draft.id}`}>
              Continuar rascunho {draft.code}
            </a>
          ) : (
            <button className="btn btn-primary" type="button" onClick={newDraft} disabled={busy}>
              {busy ? 'Criando…' : 'Novo rascunho'}
            </button>
          ))
        }
      >
        <p className="muted">Custos da equipe, impostos, veículo e metas. Cada orçamento guarda a versão que usou; publicar uma nova não muda orçamentos antigos.</p>
      </PageHeader>
      {actionError && <ErrorAlert message={actionError} />}
      {error && <ErrorAlert message={error} onRetry={reload} />}
      {loading && !data && <p className="muted">Carregando…</p>}
      {data && (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Situação</th>
                <th>Vigência</th>
                <th>Publicado em</th>
                <th>Última alteração</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted empty">
                    Nenhum conjunto de parâmetros ainda.{canWrite ? ' Crie o primeiro rascunho.' : ''}
                  </td>
                </tr>
              )}
              {data.map((s) => (
                <tr key={s.id} className="row-link" onClick={() => navigate(`/parametros/${s.id}`)}>
                  <td>
                    <a href={`#/parametros/${s.id}`}>{s.code}</a>
                  </td>
                  <td>
                    <Badge tone={TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                  </td>
                  <td>{s.effectiveFrom ? `a partir de ${formatDate(s.effectiveFrom)}` : '—'}</td>
                  <td>{formatDateTime(s.publishedAt)}</td>
                  <td>{formatDateTime(s.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
