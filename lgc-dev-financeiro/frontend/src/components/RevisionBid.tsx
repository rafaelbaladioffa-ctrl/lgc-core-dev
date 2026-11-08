import { useEffect, useMemo, useState } from 'react';
import {
  downloadBidOutput,
  downloadBidPreview,
  getBidLines,
  getBidPlan,
  getBidProfile,
  updateBidProfile,
  type BidCableLineProfile,
  type BidPlanStatus,
  type BidProfile,
  type BidTemplateLine,
  type Revision,
} from '../lib/budgets';
import { Badge, messageOf } from './ui';

const SENT = ['enviada', 'ganha', 'perdida', 'substituida'];

const optionLabel = (l: BidTemplateLine) => `${l.subcategory} · ${l.code}${l.supplier && l.supplier !== 'Select' ? ` · ${l.supplier}` : ''} — ${l.description}`.slice(0, 140);

/** Linha da tabela de mapeamento: rascunho local até salvar. */
function CableRow({
  type,
  current,
  options,
  editable,
  busy,
  onSave,
}: {
  type: string;
  current: BidCableLineProfile | null;
  options: BidTemplateLine[];
  editable: boolean;
  busy: boolean;
  onSave: (value: BidCableLineProfile) => void;
}) {
  const [draft, setDraft] = useState<BidCableLineProfile>(current ?? { code: '' });
  const free = draft.code.startsWith('free_');
  const dirty = JSON.stringify(draft) !== JSON.stringify(current ?? { code: '' });
  return (
    <tr>
      <td>{type}</td>
      <td>
        <select value={draft.code} disabled={!editable || busy} aria-label={`Linha do Bid Template para ${type}`} onChange={(e) => setDraft({ ...draft, code: e.target.value })}>
          <option value="">— escolher —</option>
          {options.map((l) => (
            <option key={l.row} value={l.code}>
              {optionLabel(l)}
            </option>
          ))}
        </select>
        {free && (
          <div className="workflow-actions">
            <input placeholder="Descrição" aria-label="Descrição" value={draft.description ?? ''} disabled={!editable} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            <input placeholder="Fornecedor (ex.: AWS Internal)" aria-label="Fornecedor" value={draft.supplier ?? ''} disabled={!editable} onChange={(e) => setDraft({ ...draft, supplier: e.target.value })} />
            <input placeholder="Código" aria-label="Código do fabricante" value={draft.partNumber ?? ''} disabled={!editable} onChange={(e) => setDraft({ ...draft, partNumber: e.target.value })} />
            <input placeholder="Unidade (m)" aria-label="Unidade" value={draft.unit ?? ''} disabled={!editable} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
          </div>
        )}
        {!free && draft.code && (
          <input placeholder="Fornecedor, se a linha estiver em Select" aria-label="Fornecedor do cabo" value={draft.supplier ?? ''} disabled={!editable} onChange={(e) => setDraft({ ...draft, supplier: e.target.value })} />
        )}
      </td>
      <td>
        {editable && dirty && draft.code && (
          <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => onSave(draft)}>
            Salvar
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * Bid do cliente (PJ7, §7.4): perfil do fornecedor, linha do Bid Template de cada tipo de cabo e função,
 * situação (pronta ou o que falta) e downloads. O mapeamento fica salvo e vale para as próximas cotações.
 * A Bid definitiva é gerada ao aprovar o envio e vai para o Axis Core.
 */
export function RevisionBidSection({ rev, canWrite }: { rev: Revision; canWrite: boolean }) {
  const quote = rev.aws?.quote ?? null;
  const editable = canWrite && (rev.status === 'rascunho' || rev.status === 'em_aprovacao');
  const [profile, setProfile] = useState<BidProfile | null>(null);
  const [lines, setLines] = useState<BidTemplateLine[]>([]);
  const [status, setStatus] = useState<BidPlanStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [header, setHeader] = useState({ vendorName: '', pocName: '', pocEmail: '', leadTimeDays: '0' });

  const hasTemplate = !!rev.aws?.bidTemplate;
  useEffect(() => {
    let alive = true;
    Promise.all([getBidProfile(), hasTemplate ? getBidLines(rev.id) : Promise.resolve([]), hasTemplate && quote ? getBidPlan(rev.id) : Promise.resolve(null)])
      .then(([p, l, s]) => {
        if (!alive) return;
        setProfile(p);
        setLines(l);
        setStatus(s);
        setHeader({ vendorName: p.header.vendorName ?? '', pocName: p.header.pocName ?? '', pocEmail: p.header.pocEmail ?? '', leadTimeDays: String(p.header.leadTimeDays ?? 0) });
      })
      .catch((e) => alive && setMessage({ tone: 'danger', text: messageOf(e, 'Não foi possível carregar o perfil da Bid.') }));
    return () => {
      alive = false;
    };
  }, [rev.id, rev.updatedAt, hasTemplate, quote]);

  const cableOptions = useMemo(() => lines.filter((l) => l.category === 'Fiber' || l.category === 'Wire and Cable'), [lines]);
  const laborOptions = useMemo(() => lines.filter((l) => l.category === 'Labor'), [lines]);
  const roles = (rev.result?.labor ?? []).filter((l) => Number(l.hours) > 0);

  async function save(body: Parameters<typeof updateBidProfile>[0], ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      setProfile(await updateBidProfile(body));
      if (hasTemplate && quote) setStatus(await getBidPlan(rev.id));
      setMessage({ tone: 'success', text: ok });
    } catch (e) {
      setMessage({ tone: 'danger', text: messageOf(e, 'Não foi possível salvar o perfil da Bid.') });
    } finally {
      setBusy(false);
    }
  }

  async function download(fn: () => Promise<void>) {
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ tone: 'danger', text: messageOf(e, 'Não foi possível baixar a Bid.') });
    }
  }

  return (
    <div className="workflow-reason">
      <h3>
        Bid para a AWS{' '}
        {status ? status.ready ? <Badge tone="success">pronta para gerar</Badge> : <Badge tone="warning">faltam itens</Badge> : null}
      </h3>
      {message && (
        <p className={`alert alert-${message.tone}`} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      {status && !status.ready && (
        <ul className="warnings">
          {status.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      {profile && (
        <details open={!profile.header.vendorName || editingHeader}>
          <summary>Fornecedor na Bid: {profile.header.vendorName ?? '—'} · {profile.header.pocName ?? '—'} · {profile.header.pocEmail ?? '—'}</summary>
          <div className="sow-grid">
            <label>
              Fornecedor (como na lista da AWS)
              <input value={header.vendorName} disabled={!canWrite || busy} onChange={(e) => { setEditingHeader(true); setHeader({ ...header, vendorName: e.target.value }); }} />
            </label>
            <label>
              Contato da proposta
              <input value={header.pocName} disabled={!canWrite || busy} onChange={(e) => { setEditingHeader(true); setHeader({ ...header, pocName: e.target.value }); }} />
            </label>
            <label>
              E-mail do contato
              <input type="email" value={header.pocEmail} disabled={!canWrite || busy} onChange={(e) => { setEditingHeader(true); setHeader({ ...header, pocEmail: e.target.value }); }} />
            </label>
            <label>
              Lead time do fabricante (dias)
              <input inputMode="numeric" value={header.leadTimeDays} disabled={!canWrite || busy} onChange={(e) => { setEditingHeader(true); setHeader({ ...header, leadTimeDays: e.target.value }); }} />
            </label>
          </div>
          {canWrite && (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={busy}
              onClick={() =>
                void save(
                  { header: { vendorName: header.vendorName.trim() || null, pocName: header.pocName.trim() || null, pocEmail: header.pocEmail.trim() || null, leadTimeDays: Number(header.leadTimeDays) || 0 } },
                  'Fornecedor da Bid salvo.',
                ).then(() => setEditingHeader(false))
              }
            >
              Salvar fornecedor
            </button>
          )}
        </details>
      )}

      {quote && hasTemplate && profile && (
        <>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo de cabo (SOW)</th>
                  <th>Linha do Bid Template</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {quote.perType.map((t) => (
                  <CableRow
                    key={`${t.type}-${profile.cables[t.type]?.code ?? ''}`}
                    type={t.type}
                    current={profile.cables[t.type] ?? null}
                    options={cableOptions}
                    editable={editable}
                    busy={busy}
                    onSave={(value) => void save({ cables: { [t.type]: value } }, `Linha de ${t.type} salva.`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">Tipos que caem na mesma linha são somados (ex.: Cat6 de cores diferentes numa linha livre de cobre). O mapeamento vale para as próximas cotações.</p>

          {roles.length > 0 && (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Função</th>
                    <th>Linha de mão de obra</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.roleKey}>
                      <td>{r.label}</td>
                      <td>
                        <select
                          value={profile.roles[r.roleKey] ?? ''}
                          disabled={!editable || busy}
                          aria-label={`Linha de mão de obra para ${r.label}`}
                          onChange={(e) => void save({ roles: { [r.roleKey]: e.target.value || null } }, `Linha de ${r.label} salva.`)}
                        >
                          <option value="">— escolher —</option>
                          {laborOptions.map((l) => (
                            <option key={l.row} value={l.code}>
                              {l.description}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted">Materiais da LGC entram pela "referência no formulário do cliente" do catálogo de materiais (código da linha no Bid Template).</p>
        </>
      )}

      <div className="workflow-actions">
        {canWrite && status?.ready && !SENT.includes(rev.status) && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void download(() => downloadBidPreview(rev.id))}>
            Baixar prévia da Bid
          </button>
        )}
        {SENT.includes(rev.status) && (
          <button className="btn btn-primary btn-sm" type="button" onClick={() => void download(() => downloadBidOutput(rev.id))}>
            Baixar Bid enviada
          </button>
        )}
      </div>
      {rev.status === 'em_aprovacao' && <p className="muted">Ao aprovar o envio, a Bid é gerada, guardada nesta revisão e enviada ao Axis Core com a equipe e os dias.</p>}
    </div>
  );
}
