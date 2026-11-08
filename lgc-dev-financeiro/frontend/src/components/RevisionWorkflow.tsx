import { useState } from 'react';
import { REVISION_STATUS, transitionRevision, type Revision, type WorkflowAction } from '../lib/budgets';
import { formatDateTime } from '../lib/format';
import { Badge, messageOf } from './ui';

/** Botões e textos de cada passo (projetos-especificacao §3.1). Quais aparecem vem do servidor. */
const ACTIONS: Record<Exclude<WorkflowAction, 'discard'>, { label: string; className: string; reason: 'required' | 'optional' | 'none'; confirm?: string; done: string }> = {
  submit: { label: 'Submeter para aprovação', className: 'btn btn-primary', reason: 'none', done: 'Revisão enviada para aprovação.' },
  approve_send: {
    label: 'Aprovar envio',
    className: 'btn btn-primary',
    reason: 'none',
    confirm: 'Aprovar o envio desta revisão ao cliente? Ela fica congelada e a revisão enviada anterior, se houver, passa a substituída.',
    done: 'Envio aprovado.',
  },
  return: { label: 'Devolver para ajuste', className: 'btn btn-ghost', reason: 'required', done: 'Revisão devolvida para ajuste.' },
  won: { label: 'Cliente aceitou', className: 'btn btn-primary', reason: 'optional', done: 'Revisão marcada como ganha. Ela é a linha de base do realizado.' },
  lost: { label: 'Cliente recusou', className: 'btn btn-ghost', reason: 'required', done: 'Revisão marcada como perdida.' },
};

/**
 * Fluxo da revisão: o que fazer agora, por que ainda não dá para submeter e o histórico de quem fez o quê.
 * Rascunho com alterações não salvas não submete (o servidor usaria a versão salva).
 */
export function RevisionWorkflow({ rev, dirty, onChange }: { rev: Revision; dirty: boolean; onChange: (r: Revision) => void }) {
  const [pending, setPending] = useState<Exclude<WorkflowAction, 'discard'> | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const wf = rev.workflow;
  const actions = wf.allowedActions.filter((a): a is Exclude<WorkflowAction, 'discard'> => a !== 'discard');

  async function run(action: Exclude<WorkflowAction, 'discard'>, why?: string) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await transitionRevision(rev.id, action, why?.trim() || undefined);
      setPending(null);
      setReason('');
      setMessage({ tone: 'success', text: ACTIONS[action].done });
      onChange(r);
    } catch (e) {
      setMessage({ tone: 'danger', text: messageOf(e, 'Não foi possível concluir a ação.') });
    } finally {
      setBusy(false);
    }
  }

  function start(action: Exclude<WorkflowAction, 'discard'>) {
    const a = ACTIONS[action];
    if (a.reason !== 'none') {
      setPending(action);
      setReason('');
      return;
    }
    if (a.confirm && !window.confirm(a.confirm)) return;
    void run(action);
  }

  const blocked = rev.status === 'rascunho' && (wf.submitBlockers.length > 0 || dirty);
  const reasonOk = pending ? ACTIONS[pending].reason !== 'required' || reason.trim().length >= 3 : false;

  return (
    <section className="card workflow" aria-label="Fluxo da revisão">
      <div className="workflow-head">
        <h2>
          Aprovação <Badge tone={REVISION_STATUS[rev.status].tone}>{REVISION_STATUS[rev.status].label}</Badge>
        </h2>
        {wf.approvedAt && (
          <span className="muted">
            Envio aprovado por {wf.approvedByEmail ?? '—'} em {formatDateTime(wf.approvedAt)}
          </span>
        )}
      </div>

      {rev.status === 'rascunho' && wf.submitBlockers.length > 0 && (
        <ul className="warnings">
          {wf.submitBlockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {rev.status === 'rascunho' && dirty && actions.includes('submit') && <p className="muted">Salve as alterações antes de submeter.</p>}
      {rev.status === 'em_aprovacao' && actions.length === 0 && <p className="muted">Aguardando quem aprova o envio (permissão de aprovação de orçamento).</p>}
      {rev.status === 'enviada' && actions.length === 0 && <p className="muted">Proposta enviada. Quem tem permissão de aprovação registra a resposta do cliente.</p>}

      {actions.length > 0 && !pending && (
        <div className="workflow-actions">
          {actions.map((a) => (
            <button key={a} type="button" className={ACTIONS[a].className} disabled={busy || (a === 'submit' && blocked)} onClick={() => start(a)}>
              {ACTIONS[a].label}
            </button>
          ))}
        </div>
      )}

      {pending && (
        <div className="workflow-reason">
          <label>
            {ACTIONS[pending].reason === 'required' ? 'Motivo (obrigatório)' : 'Observação (opcional)'}
            <textarea value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} disabled={busy} autoFocus />
          </label>
          <div className="workflow-actions">
            <button type="button" className="btn btn-primary" disabled={busy || !reasonOk} onClick={() => void run(pending, reason)}>
              {busy ? 'Enviando…' : ACTIONS[pending].label}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setPending(null)}>
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

      {wf.events.length > 0 && (
        <details open={rev.status !== 'rascunho'}>
          <summary>Histórico ({wf.events.length})</summary>
          <ol className="workflow-history">
            {wf.events.map((e) => (
              <li key={e.id}>
                <strong>{e.label}</strong> · {e.actorEmail ?? '—'} · {formatDateTime(e.createdAt)}
                {e.reason && <div className="muted">“{e.reason}”</div>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
