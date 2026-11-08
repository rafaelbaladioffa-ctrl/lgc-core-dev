import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { projectsApi, type ProjectAcceptance, type ProjectQuote, type ProjectStatus } from '../api/projects';
import { formatSiteAddress, sitesApi, type Site } from '../api/sites';
import { useAuth } from '../context/AuthContext';
import { Button } from './Button';
import { ProjectDocuments } from './ProjectDocuments';
import { translateApiError } from '../utils/apiError';
import { formatDateTime } from '../utils/formatDate';
import { formatBRL } from '../utils/format';
import { DOCUMENT_ACCEPT, readFileAsBase64 } from '../utils/fileUpload';
import { formatIsoDate } from '../utils/purchaseDeliveries';

interface Props {
  projectId: string;
  status: ProjectStatus | null;
  siteId: string | null;
  /** Abre o diálogo "Aprovar projeto" ao montar (vindo do seletor de status da lista de projetos). */
  autoOpen?: boolean;
  /** O status do projeto mudou: a tela de edição recarrega o projeto. */
  onApproved: () => void;
}

/**
 * Aprovação do projeto (PT-06, PA-07): o comercial muda o projeto de proposta para aprovado informando a revisão da
 * cotação que o cliente aceitou (padrão: a vigente), o nº do PO e, opcionalmente, o arquivo do PO. O servidor exige
 * site e cotação recebida e, na mesma transação, cria o aceite e a requisição de envio de material para o site.
 * Depois da aprovação a seção mostra o aceite e o link para a requisição gerada.
 */
export function ProjectApproval({ projectId, status, siteId, autoOpen = false, onApproved }: Props) {
  const { hasPermission } = useAuth();
  const canApprove = hasPermission('project:update');
  const canReadQuotes = hasPermission('project:read_documents');
  const canReadSite = hasPermission('site:read');
  const [acceptance, setAcceptance] = useState<ProjectAcceptance | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // `null` = ainda não mexeram: segue `autoOpen` (que só vale enquanto o projeto é proposta e a pessoa pode aprovar).
  const [opened, setOpened] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAcceptance = useCallback(() => {
    if (!hasPermission('project:read')) return Promise.resolve();
    return projectsApi
      .getAcceptance(projectId)
      .then(setAcceptance)
      .catch((err) => setLoadError(translateApiError(err, 'Erro ao carregar o aceite do projeto.')));
  }, [projectId, hasPermission]);

  useEffect(() => {
    void loadAcceptance();
  }, [loadAcceptance, status]);

  const open = opened ?? (autoOpen && status === 'proposta' && canApprove);
  const setOpen = setOpened;

  const approved = status !== null && status !== 'proposta';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {notice && <p role="status" style={{ color: 'var(--success)', fontSize: 13, margin: 0 }}>{notice}</p>}
      {loadError && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{loadError}</p>}

      {status === 'proposta' && (
        <>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            Quando o cliente aprovar o orçamento, aprove o projeto aqui: o Axis registra a revisão aceita e o PO, avisa o Financeiro e o
            Campo e cria a requisição de envio dos materiais ao site, que o responsável pelo centro de custo aprova.
          </p>
          {canApprove ? (
            <div>
              <Button type="button" variant="positive" onClick={() => setOpen(true)} disabled={!siteId} title={siteId ? undefined : 'Escolha o site do projeto e salve antes de aprovar.'}>
                Aprovar projeto
              </Button>
              {!siteId && <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--warning)' }}>Escolha o site do projeto e salve antes de aprovar.</span>}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Você não tem permissão para aprovar projetos.</p>
          )}
        </>
      )}

      {approved && acceptance?.acceptance && (
        <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Revisão aceita:</span> {acceptance.acceptance.revisionNumber}
            {acceptance.acceptance.clientPoNumber && (
              <>
                {' · '}
                <span style={{ color: 'var(--text-muted)' }}>PO:</span> {acceptance.acceptance.clientPoNumber}
              </>
            )}
          </div>
          <div style={{ color: 'var(--text-muted)' }}>
            Aprovado por {acceptance.acceptance.acceptedByEmail} em {formatDateTime(acceptance.acceptance.acceptedAt)}
          </div>
          {acceptance.materialRequest ? (
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Envio de material:</span>{' '}
              <Link to={`/requests/${acceptance.materialRequest.id}`}>{acceptance.materialRequest.code}</Link>
              {acceptance.materialRequest.estimatedValue !== null && <> · valor estimado {formatBRL(acceptance.materialRequest.estimatedValue)}</>}
              {acceptance.materialRequest.neededBy && <> · necessário até {formatIsoDate(acceptance.materialRequest.neededBy)}</>}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>A cotação aceita não tem materiais: nenhuma requisição de envio foi criada.</div>
          )}
        </div>
      )}
      {approved && acceptance && !acceptance.acceptance && !loadError && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Projeto aprovado antes do registro de aceite: não há revisão nem PO guardados.</p>
      )}
      {approved && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>PO do cliente</div>
          <ProjectDocuments projectId={projectId} kind="po" />
        </div>
      )}

      {open && (
        <ApproveProjectDialog
          projectId={projectId}
          siteId={siteId}
          canReadQuotes={canReadQuotes}
          canReadSite={canReadSite}
          onClose={() => setOpen(false)}
          onApproved={(message) => {
            setOpen(false);
            setNotice(message);
            void loadAcceptance();
            onApproved();
          }}
        />
      )}
    </div>
  );
}

interface DialogProps {
  projectId: string;
  siteId: string | null;
  canReadQuotes: boolean;
  canReadSite: boolean;
  onClose: () => void;
  onApproved: (message: string) => void;
}

function ApproveProjectDialog({ projectId, siteId, canReadQuotes, canReadSite, onClose, onApproved }: DialogProps) {
  const [quotes, setQuotes] = useState<ProjectQuote[] | null>(canReadQuotes ? null : []);
  const [quoteId, setQuoteId] = useState('');
  const [site, setSite] = useState<Site | null>(null);
  const [po, setPo] = useState('');
  const [poFile, setPoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canReadQuotes) return;
    projectsApi
      .listQuotes(projectId)
      .then((data) => {
        const sorted = [...data.quotes].sort((a, b) => b.revisionNumber - a.revisionNumber);
        setQuotes(sorted);
        setQuoteId(sorted[0]?.id ?? '');
      })
      .catch((err) => {
        setQuotes([]);
        setError(translateApiError(err, 'Erro ao carregar as cotações do projeto.'));
      });
  }, [projectId, canReadQuotes]);

  useEffect(() => {
    if (!siteId || !canReadSite) return;
    sitesApi
      .get(siteId)
      .then(setSite)
      .catch((err) => setError(translateApiError(err, 'Erro ao carregar o site do projeto.')));
  }, [siteId, canReadSite]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const selected = quotes?.find((q) => q.id === quoteId) ?? null;
  const noQuotes = quotes !== null && canReadQuotes && quotes.length === 0;
  const withoutMaterials = selected !== null && selected.materials.length === 0;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    let approvedMessage: string;
    try {
      const result = await projectsApi.approve(projectId, { acceptedQuoteId: quoteId || undefined, clientPoNumber: po.trim() || undefined });
      approvedMessage = result.materialRequest
        ? `Projeto aprovado. A requisição ${result.materialRequest.code} (envio de material) foi criada e aguarda a aprovação do responsável pelo centro de custo.`
        : 'Projeto aprovado. A cotação aceita não tem materiais, então nenhuma requisição de envio foi criada.';
    } catch (err) {
      setError(translateApiError(err, 'Não foi possível aprovar o projeto.'));
      setBusy(false);
      return;
    }
    // O projeto já está aprovado: falha ao anexar o PO não desfaz nada, só avisa.
    if (poFile) {
      try {
        const contentBase64 = await readFileAsBase64(poFile);
        await projectsApi.addDocument(projectId, { kind: 'po', filename: poFile.name, contentBase64 });
      } catch (err) {
        approvedMessage += ` Atenção: o arquivo do PO não foi anexado (${translateApiError(err, 'erro ao anexar')}). Anexe-o na seção "PO do cliente".`;
      }
    }
    setBusy(false);
    onApproved(approvedMessage);
  };

  // Portal: o diálogo não pode ficar dentro do <form> da tela de edição (Enter nos campos enviaria o formulário).
  return createPortal(
    <div className="axis-dialog-overlay" onClick={() => !busy && onClose()}>
      <div
        className="axis-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approve-project-title"
        style={{ maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="approve-project-title">Aprovar projeto</h3>
        <p>
          Confirme o que o cliente aprovou. Ao aprovar, o projeto passa a "Aprovado", o Financeiro e o Campo são avisados e os materiais da
          cotação viram uma requisição de envio ao site.
        </p>

        <div className="axis-dialog-field">
          <span style={{ fontSize: 13 }}>Site da obra</span>
          {siteId ? (
            <strong style={{ fontSize: 13 }}>{site ? `${site.code} — ${site.name}${formatSiteAddress(site) ? ` (${formatSiteAddress(site)})` : ''}` : 'Site do projeto'}</strong>
          ) : (
            <span role="alert" style={{ fontSize: 13, color: 'var(--danger)' }}>O projeto não tem site. Escolha o site no formulário e salve antes de aprovar.</span>
          )}
        </div>

        <div className="axis-dialog-field">
          <label htmlFor="approve-quote">Revisão da cotação aceita</label>
          {!canReadQuotes ? (
            <span style={{ fontSize: 13 }}>Será aceita a cotação vigente (a maior revisão recebida do Financeiro).</span>
          ) : quotes === null ? (
            <span style={{ fontSize: 13 }}>Carregando cotações…</span>
          ) : noQuotes ? (
            <span role="alert" style={{ fontSize: 13, color: 'var(--danger)' }}>
              O projeto não tem cotação recebida do Financeiro. Solicite a cotação antes de aprovar.
            </span>
          ) : (
            <select id="approve-quote" value={quoteId} onChange={(e) => setQuoteId(e.target.value)} disabled={busy}>
              {quotes.map((q, index) => (
                <option key={q.id} value={q.id}>
                  Revisão {q.revisionNumber}
                  {index === 0 ? ' (vigente)' : ''} — {q.materials.length} {q.materials.length === 1 ? 'material' : 'materiais'}, recebida em {formatIsoDate(q.receivedAt)}
                </option>
              ))}
            </select>
          )}
        </div>

        {withoutMaterials && (
          <p role="note" style={{ color: 'var(--warning)', background: 'var(--warning-soft)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius)' }}>
            Esta cotação não tem materiais: o projeto será aprovado, mas nenhuma requisição de envio de material será criada.
          </p>
        )}

        <div className="axis-dialog-field">
          <label htmlFor="approve-po">Número do PO do cliente (opcional)</label>
          <input id="approve-po" value={po} maxLength={60} onChange={(e) => setPo(e.target.value)} disabled={busy} />
        </div>
        <div className="axis-dialog-field">
          <label htmlFor="approve-po-file">Arquivo do PO (opcional)</label>
          <input id="approve-po-file" type="file" accept={DOCUMENT_ACCEPT} onChange={(e) => setPoFile(e.target.files?.[0] ?? null)} disabled={busy} />
        </div>

        {error && <p role="alert" className="axis-dialog-error">{error}</p>}
        <div className="axis-dialog-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="button" variant="positive" onClick={() => void confirm()} disabled={busy || !siteId || noQuotes || quotes === null}>
            {busy ? 'Aprovando…' : 'Aprovar projeto'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
