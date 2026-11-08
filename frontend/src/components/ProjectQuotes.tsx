import { useCallback, useEffect, useState } from 'react';
import {
  projectsApi,
  PROJECT_QUOTE_STATUS_LABEL,
  type ProjectQuote,
  type ProjectQuotes as ProjectQuotesData,
  type ProjectQuoteStatus,
  type ProjectStatus,
} from '../api/projects';
import { useAuth } from '../context/AuthContext';
import { Button } from './Button';
import { StatusBadge } from './DataTable';
import { translateApiError } from '../utils/apiError';
import { formatDateTime } from '../utils/formatDate';
import { formatNumberBR } from '../utils/format';
import { formatIsoDate } from '../utils/purchaseDeliveries';
import { saveBlob } from '../utils/fileUpload';

const STATUS_TONE: Record<ProjectQuoteStatus, 'default' | 'success' | 'warning'> = {
  nao_solicitada: 'default',
  aguardando: 'warning',
  recebida: 'success',
};

interface Props {
  projectId: string;
  projectStatus: ProjectStatus | null;
}

/**
 * Cotação do projeto pelo Axis Financeiro. "Solicitar cotação" exige `project:update`, projeto em
 * proposta e SOW anexada (o servidor confere). Ver a cotação e baixar a Bid exige
 * `project:read_documents`. O Financeiro devolve uma cotação por revisão aprovada para envio.
 */
export function ProjectQuotes({ projectId, projectStatus }: Props) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('project:read_documents');
  const canRequest = hasPermission('project:update');
  const [data, setData] = useState<ProjectQuotesData | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!canRead) return Promise.resolve();
    return projectsApi
      .listQuotes(projectId)
      .then(setData)
      .catch((err) => setError(translateApiError(err, 'Erro ao carregar a cotação do projeto.')));
  }, [projectId, canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  const request = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await projectsApi.requestQuote(projectId, notes.trim() || undefined);
      setNotice(`Cotação solicitada ao Axis Financeiro com a SOW v${created.sowVersion} e o Bid Template v${created.bidTemplateVersion}.`);
      setNotes('');
      await load();
    } catch (err) {
      setError(translateApiError(err, 'Não foi possível solicitar a cotação.'));
    } finally {
      setBusy(false);
    }
  };

  const download = async (quote: ProjectQuote) => {
    if (!quote.bidFilename) return;
    setError(null);
    try {
      saveBlob(await projectsApi.downloadBid(projectId, quote.id), quote.bidFilename);
    } catch (err) {
      setError(translateApiError(err, `Não foi possível baixar "${quote.bidFilename}".`));
    }
  };

  if (!canRead && !canRequest) return null;
  const isProposal = projectStatus === 'proposta';
  const status = data?.status ?? null;
  const lastRequest = data?.requests[0] ?? null;

  return (
    <div className="project-quotes">
      {status && (
        <div className="project-quotes__status">
          <StatusBadge label={PROJECT_QUOTE_STATUS_LABEL[status]} tone={STATUS_TONE[status]} />
          {lastRequest && (
            <span className="project-quotes__hint">
              Último pedido em {formatDateTime(lastRequest.createdAt)} por {lastRequest.requestedByEmail}, com a SOW v{lastRequest.sowVersion}
              {lastRequest.bidTemplateVersion ? ` e o Bid Template v${lastRequest.bidTemplateVersion}` : ''}.
            </span>
          )}
        </div>
      )}

      {canRequest && isProposal && (
        <div className="project-quotes__request">
          <label>
            Recado para o orçamentista (opcional)
            <textarea value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
          </label>
          <div className="project-quotes__actions">
            <Button type="button" variant="positive" onClick={() => void request()} disabled={busy}>
              {busy ? 'Enviando…' : status === 'nao_solicitada' || !status ? 'Solicitar cotação' : 'Solicitar nova cotação'}
            </Button>
            <span className="project-quotes__hint">
              Exige a SOW e o Bid Template anexados acima. O Axis Financeiro devolve o Bid Template preenchido e a equipe orçada.
            </span>
          </div>
        </div>
      )}
      {canRequest && !isProposal && projectStatus && (
        <p className="project-quotes__hint">Só dá para solicitar cotação enquanto o projeto está em proposta.</p>
      )}

      {notice && <p className="project-quotes__notice" role="status">{notice}</p>}
      {error && <p className="project-quotes__error" role="alert">{error}</p>}

      {canRead && data && data.quotes.length === 0 && (
        <p className="project-quotes__hint">Nenhuma cotação recebida do Axis Financeiro ainda.</p>
      )}
      {canRead && data?.quotes.map((quote, index) => <QuoteCard key={quote.id} quote={quote} current={index === 0} onDownload={download} />)}

      {canRead && data && data.requests.length > 1 && (
        <details>
          <summary className="project-quotes__hint">Histórico de pedidos ({data.requests.length})</summary>
          <ul className="project-quote-history">
            {data.requests.map((r) => (
              <li key={r.id}>
                {formatDateTime(r.createdAt)} · {r.requestedByEmail} · SOW v{r.sowVersion}
                {r.bidTemplateVersion ? ` · Bid Template v${r.bidTemplateVersion}` : ''}
                {r.notes ? ` · “${r.notes}”` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!canRead && canRequest && (
        <p className="project-quotes__hint">Você pode solicitar a cotação, mas não tem permissão para ver o que o Financeiro devolveu.</p>
      )}
    </div>
  );
}

function QuoteCard({ quote, current, onDownload }: { quote: ProjectQuote; current: boolean; onDownload: (q: ProjectQuote) => void }) {
  return (
    <article className={`project-quote-card${current ? '' : ' project-quote-card--old'}`}>
      <div className="project-quote-card__head">
        <span className="project-quote-card__title">
          Revisão R{quote.revisionNumber} {current ? <StatusBadge label="Vigente" tone="success" /> : <StatusBadge label="Substituída" tone="default" />}
        </span>
        {quote.bidFilename ? (
          <Button type="button" variant="secondary" onClick={() => onDownload(quote)}>
            Baixar Bid
          </Button>
        ) : (
          <span className="project-quotes__hint">Sem Bid (orçamento genérico)</span>
        )}
      </div>
      <dl className="project-quote-card__grid">
        <div>
          <dt>Dias de trabalho</dt>
          <dd>{formatNumberBR(quote.workDays)}</dd>
        </div>
        <div>
          <dt>Pessoas em campo</dt>
          <dd>{quote.fieldPeople}</dd>
        </div>
        <div>
          <dt>Horas orçadas</dt>
          <dd>{formatNumberBR(quote.totalHours)}</dd>
        </div>
        <div>
          <dt>Execução prevista</dt>
          <dd>{quote.plannedStartDate || quote.plannedEndDate ? `${formatIsoDate(quote.plannedStartDate)} a ${formatIsoDate(quote.plannedEndDate)}` : '—'}</dd>
        </div>
      </dl>
      <div className="project-quote-team__scroll">
        <table className="project-quote-team">
          <thead>
            <tr>
              <th>Função</th>
              <th className="num">Pessoas</th>
              <th className="num">Dias</th>
              <th className="num">Horas</th>
            </tr>
          </thead>
          <tbody>
            {quote.team.map((line) => (
              <tr key={line.role_key}>
                <td>{line.role_name}{line.field_role ? '' : ' (horas)'}</td>
                <td className="num">{line.people ?? '—'}</td>
                <td className="num">{line.days !== null ? formatNumberBR(line.days) : '—'}</td>
                <td className="num">{formatNumberBR(line.hours)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">{quote.fieldPeople}</td>
              <td className="num">{formatNumberBR(quote.workDays)}</td>
              <td className="num">{formatNumberBR(quote.totalHours)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="project-quote-materials">
        <h4 className="project-quote-materials__title">Materiais ({quote.materials.length})</h4>
        {quote.materials.length === 0 ? (
          <p className="project-quotes__hint">Esta revisão não trouxe materiais.</p>
        ) : (
          <div className="project-quote-team__scroll">
            <table className="project-quote-team">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Unid.</th>
                  <th className="num">Quantidade</th>
                </tr>
              </thead>
              <tbody>
                {quote.materials.map((m) => (
                  <tr key={m.id}>
                    <td>{m.materialCode}</td>
                    <td>{m.description}</td>
                    <td>{m.unit}</td>
                    <td className="num">{formatNumberBR(m.quantity, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="project-quotes__hint">
        Recebida em {formatDateTime(quote.receivedAt)}
        {quote.approvedByEmail ? ` · envio aprovado por ${quote.approvedByEmail}` : ''}
        {quote.sowVersion ? ` · cotada com a SOW v${quote.sowVersion}` : ''} {quote.bidFilename ? ` · ${quote.bidFilename}` : ''}
      </p>
    </article>
  );
}
