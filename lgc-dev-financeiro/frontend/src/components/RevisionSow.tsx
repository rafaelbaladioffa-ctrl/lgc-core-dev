import { useState } from 'react';
import { getSowText, importSow, updateSowCables, type Revision, type RevisionSow, type SowCableLine } from '../lib/budgets';
import { formatDate, formatDateTime } from '../lib/format';
import { Badge, messageOf } from './ui';

const PLATFORM: Record<RevisionSow['header']['platform'], string> = {
  pedida: 'pedida na SOW',
  nao_precisa: 'a SOW diz que não precisa',
  nao_mencionada: 'não mencionada',
};

interface CableRow {
  uid: number;
  type: string;
  lengthM: string;
  quantity: string;
  fibers: string;
  kind: SowCableLine['kind'];
}

let uidSeq = 0;
const toRows = (cables: SowCableLine[]): CableRow[] =>
  cables.map((c) => ({ uid: ++uidSeq, type: c.type, lengthM: String(c.lengthM), quantity: String(c.quantity), fibers: String(c.fibers), kind: c.kind }));

/**
 * SOW da revisão (projetos-especificacao §7.1): o que foi lido, linha a linha, para conferir contra a SOW, e
 * correção das linhas de cabo. Só muda com a revisão em rascunho.
 */
export function RevisionSowSection({ rev, canWrite, initialError, onChange }: { rev: Revision; canWrite: boolean; initialError?: string | null; onChange: (sow: RevisionSow | null) => void }) {
  const sow = rev.sow;
  const editable = canWrite && rev.status === 'rascunho';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(initialError ? { tone: 'danger', text: `A SOW não foi importada: ${initialError}` } : null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<CableRow[]>(() => toRows(sow?.cables ?? []));
  const [rawText, setRawText] = useState<string | null>(null);

  async function run(fn: () => Promise<RevisionSow | null>, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      const next = await fn();
      onChange(next);
      setRows(toRows(next?.cables ?? []));
      setEditing(false);
      setPasting(false);
      setPasted('');
      setMessage({ tone: 'success', text: ok });
    } catch (e) {
      setMessage({ tone: 'danger', text: messageOf(e, 'Não foi possível concluir a ação.') });
    } finally {
      setBusy(false);
    }
  }

  function saveCables() {
    const cables: Array<{ type: string; lengthM: number; quantity: number; fibers?: number }> = [];
    for (const r of rows) {
      const lengthM = Number(r.lengthM.replace(',', '.'));
      const quantity = Number(r.quantity);
      if (!r.type.trim() || !(lengthM > 0) || !Number.isInteger(quantity) || quantity < 1) {
        setMessage({ tone: 'danger', text: 'Cada linha precisa de tipo, comprimento maior que zero e quantidade inteira.' });
        return;
      }
      cables.push({ type: r.type.trim(), lengthM, quantity, ...(r.kind === 'outro' ? { fibers: Number(r.fibers) || 0 } : {}) });
    }
    void run(() => updateSowCables(rev.id, cables), 'Cabos corrigidos.');
  }

  async function showText() {
    try {
      setRawText((await getSowText(rev.id)).text);
    } catch (e) {
      setMessage({ tone: 'danger', text: messageOf(e, 'Não foi possível abrir o texto da SOW.') });
    }
  }

  const h = sow?.header;
  return (
    <section className="card sow" aria-label="SOW do cliente">
      <div className="workflow-head">
        <h2>
          SOW do cliente {sow && <Badge tone="neutral">{sow.source === 'core_pdf' ? `PDF do Axis Core${sow.sowVersion ? ` · v${sow.sowVersion}` : ''}` : 'texto colado'}</Badge>}
          {sow?.edited && <Badge tone="warning">cabos corrigidos à mão</Badge>}
        </h2>
        {sow && <span className="muted">lida em {formatDateTime(sow.importedAt)}</span>}
      </div>

      {!sow && <p className="muted">Nenhuma SOW importada nesta revisão.</p>}

      {editable && !pasting && (
        <div className="workflow-actions">
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void run(() => importSow(rev.id, {}), 'SOW importada do Axis Core.')}>
            {sow ? 'Importar de novo do Axis Core' : 'Importar SOW do Axis Core'}
          </button>
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setPasting(true)}>
            Colar texto da SOW
          </button>
        </div>
      )}
      {editable && pasting && (
        <div className="workflow-reason">
          <label>
            Texto da SOW
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={8} disabled={busy} />
          </label>
          <div className="workflow-actions">
            <button className="btn btn-primary" type="button" disabled={busy || !pasted.trim()} onClick={() => void run(() => importSow(rev.id, { text: pasted }), 'SOW lida do texto colado.')}>
              Ler texto
            </button>
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setPasting(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className={`alert alert-${message.tone}`} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      {sow && h && (
        <>
          <dl className="sow-grid">
            <div><dt>FBN</dt><dd>{h.fbn ?? '—'}</dd></div>
            <div><dt>SOW UID</dt><dd>{h.sowUid ?? '—'}</dd></div>
            <div><dt>Site</dt><dd>{h.sites ?? '—'}</dd></div>
            <div><dt>Tipo</dt><dd>{h.projectType ?? '—'}</dd></div>
            <div><dt>Visita técnica</dt><dd>{h.walkthroughAt ?? '—'}</dd></div>
            <div><dt>Prazo de envio da proposta</dt><dd>{h.bidDueAt ?? '—'}</dd></div>
            <div><dt>Execução</dt><dd>{h.startDate || h.endDate ? `${formatDate(h.startDate)} a ${formatDate(h.endDate)}` : '—'}</dd></div>
            <div><dt>Plataforma elevatória</dt><dd>{PLATFORM[h.platform]}</dd></div>
            <div><dt>Racks e dispositivos</dt><dd>{sow.devices.total} ({sow.devices.live} live{sow.devices.live > 0 ? ', exige janela' : ''})</dd></div>
            <div className="sow-grid__full"><dt>Nome no cliente</dt><dd>{h.projectName ?? '—'}</dd></div>
          </dl>
          <p className="muted">Horários como estão na SOW (fuso informado pelo cliente).</p>

          {sow.warnings.length > 0 && (
            <ul className="warnings">
              {sow.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          <h3>Cabos por tipo</h3>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th className="num">Quantidade</th>
                  <th className="num">Metros</th>
                  <th className="num">Comprimento médio</th>
                  <th className="num">Portas</th>
                </tr>
              </thead>
              <tbody>
                {sow.types.map((t) => (
                  <tr key={t.type}>
                    <td>{t.type}{t.kind === 'outro' && <Badge tone="warning">não reconhecido</Badge>}</td>
                    <td className="num">{t.quantity}</td>
                    <td className="num">{t.meters}</td>
                    <td className="num">{t.averageLengthM} m</td>
                    <td className="num">{t.ports}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num">{sow.totals.cables}</td>
                  <td className="num">{sow.totals.meters}</td>
                  <td />
                  <td className="num">{sow.totals.ports}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <details open={editing}>
            <summary>Linhas lidas ({sow.cables.length}) — confira com a SOW</summary>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th className="num">Comprimento (m)</th>
                    <th className="num">Quantidade</th>
                    <th className="num">Fibras</th>
                    {editing && <th aria-label="Remover" />}
                  </tr>
                </thead>
                <tbody>
                  {(editing ? rows : toRows(sow.cables)).map((r) => (
                    <tr key={r.uid}>
                      {editing ? (
                        <>
                          <td><input value={r.type} aria-label="Tipo" onChange={(e) => setRows((rs) => rs.map((x) => (x.uid === r.uid ? { ...x, type: e.target.value, kind: 'outro' } : x)))} /></td>
                          <td className="num"><input inputMode="decimal" value={r.lengthM} aria-label="Comprimento" onChange={(e) => setRows((rs) => rs.map((x) => (x.uid === r.uid ? { ...x, lengthM: e.target.value } : x)))} /></td>
                          <td className="num"><input inputMode="numeric" value={r.quantity} aria-label="Quantidade" onChange={(e) => setRows((rs) => rs.map((x) => (x.uid === r.uid ? { ...x, quantity: e.target.value } : x)))} /></td>
                          <td className="num"><input inputMode="numeric" value={r.fibers} aria-label="Fibras (só tipo não reconhecido)" onChange={(e) => setRows((rs) => rs.map((x) => (x.uid === r.uid ? { ...x, fibers: e.target.value } : x)))} /></td>
                          <td><button className="btn btn-ghost btn-sm" type="button" onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}>Remover</button></td>
                        </>
                      ) : (
                        <>
                          <td>{r.type}</td>
                          <td className="num">{r.lengthM}</td>
                          <td className="num">{r.quantity}</td>
                          <td className="num">{r.fibers}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {editable && !editing && (
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setRows(toRows(sow.cables)); setEditing(true); }}>
                Corrigir linhas
              </button>
            )}
            {editing && (
              <div className="workflow-actions">
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setRows((rs) => [...rs, { uid: ++uidSeq, type: '', lengthM: '', quantity: '1', fibers: '0', kind: 'outro' }])}>
                  Incluir linha
                </button>
                <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={saveCables}>
                  Salvar cabos
                </button>
                <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => setEditing(false)}>
                  Cancelar
                </button>
              </div>
            )}
            <p className="muted">O tipo é normalizado ao salvar (ex.: "8F MPO-4LC" e "8F 4LC-MPO" são o mesmo cabo). Fibras só valem para tipo não reconhecido.</p>
          </details>

          {canWrite && (
            <details onToggle={(e) => (e.currentTarget.open && rawText === null ? void showText() : undefined)}>
              <summary>Texto original da SOW</summary>
              {rawText === null ? <p className="muted">Carregando…</p> : <pre className="sow-text">{rawText}</pre>}
            </details>
          )}
        </>
      )}
    </section>
  );
}
