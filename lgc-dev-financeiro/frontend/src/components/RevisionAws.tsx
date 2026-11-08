import { useState } from 'react';
import { applySuggestedTeam, importBidTemplate, updateHoursT, updateKpiJustifications, type KpiKey, type Revision } from '../lib/budgets';
import { formatPercent, formatNumber } from '../lib/decimal';
import { formatBRL, formatDate, formatDateTime } from '../lib/format';
import { Badge, messageOf } from './ui';
import { RevisionBidSection } from './RevisionBid';

/** Indicadores em dinheiro (moeda da proposta); os outros são horas ou razão. */
const MONEY_KPIS: KpiKey[] = ['costPerPort', 'laborCostPerPort'];

/**
 * Cotação no modelo aws_sow (projetos-especificacao §7.2–§7.4): Bid Template do RFQ e metas do cluster,
 * horas-meta, horas T por tipo de cabo, indicadores com justificativa e os valores que vão para a Bid.
 * Os números vêm do servidor; a tela só envia horas T e justificativas.
 */
export function RevisionAwsSection({ rev, canWrite, initialError, onChange }: { rev: Revision; canWrite: boolean; initialError?: string | null; onChange: (r: Revision) => void }) {
  const aws = rev.aws;
  const editable = canWrite && rev.status === 'rascunho';
  const quote = aws?.quote ?? null;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(initialError ? { tone: 'danger', text: `O Bid Template não foi importado: ${initialError}` } : null);
  const [hours, setHours] = useState<Record<string, string>>(() => Object.fromEntries((quote?.perType ?? []).filter((t) => t.overridden).map((t) => [t.type, String(t.hoursT)])));
  const [notes, setNotes] = useState<Record<string, string>>(() => Object.fromEntries((quote?.kpis ?? []).map((k) => [k.key, k.justification ?? ''])));

  if (!aws) return null;

  async function run(fn: () => Promise<Revision>, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fn();
      onChange(r);
      setMessage({ tone: 'success', text: ok });
    } catch (e) {
      setMessage({ tone: 'danger', text: messageOf(e, 'Não foi possível concluir a ação.') });
    } finally {
      setBusy(false);
    }
  }

  function saveHours() {
    const payload: Record<string, number | null> = {};
    for (const t of quote?.perType ?? []) {
      const raw = (hours[t.type] ?? '').trim();
      if (!raw) {
        payload[t.type] = null;
        continue;
      }
      const n = Number(raw.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) {
        setMessage({ tone: 'danger', text: `Horas inválidas para ${t.type}.` });
        return;
      }
      payload[t.type] = n;
    }
    void run(() => updateHoursT(rev.id, payload), 'Horas por tipo de cabo salvas.');
  }

  const targets = aws.targets;
  return (
    <section className="card sow" aria-label="Cotação AWS">
      <div className="workflow-head">
        <h2>
          Cotação AWS {aws.bidTemplate ? <Badge tone="neutral">{`Bid Template v${aws.bidTemplate.version}`}</Badge> : <Badge tone="warning">sem Bid Template</Badge>}
        </h2>
        {aws.bidTemplate && <span className="muted">lido em {formatDateTime(aws.bidTemplate.importedAt)}</span>}
      </div>

      {editable && (
        <div className="workflow-actions">
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void run(() => importBidTemplate(rev.id), 'Bid Template importado do Axis Core.')}>
            {aws.bidTemplate ? 'Importar de novo o Bid Template' : 'Importar Bid Template do Axis Core'}
          </button>
        </div>
      )}
      {message && (
        <p className={`alert alert-${message.tone}`} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      {targets && (
        <>
          <dl className="sow-grid">
            <div><dt>Cluster / moeda</dt><dd>{targets.cluster ?? '—'} · {targets.currency ?? '—'}{targets.fx ? ` (câmbio ${formatNumber(targets.fx)} por USD)` : ''}</dd></div>
            <div><dt>Meta horas por metro</dt><dd>{formatNumber(targets.targets.hoursPerMeter)}</dd></div>
            <div><dt>Meta horas por porta</dt><dd>{formatNumber(targets.targets.hoursPerPort)}</dd></div>
            <div><dt>Meta custo por porta</dt><dd>{formatBRL(targets.converted.costPerPort)}</dd></div>
            <div><dt>Meta mão de obra por porta</dt><dd>{formatBRL(targets.converted.laborCostPerPort)}</dd></div>
            <div><dt>Pesos (metro / porta)</dt><dd>{formatNumber(targets.weights.meters)} / {formatNumber(targets.weights.ports)}</dd></div>
            <div><dt>Versão do modelo</dt><dd>{targets.templateVersion ?? '—'}</dd></div>
          </dl>
          {targets.warnings.length > 0 && (
            <ul className="warnings">
              {targets.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {aws.missing.length > 0 && <p className="muted">Para calcular horas-meta e indicadores, importe {aws.missing.map((m) => (m === 'sow' ? 'a SOW' : 'o Bid Template')).join(' e ')}.</p>}

      {quote && (
        <>
          <dl className="sow-grid">
            <div><dt>Horas-meta do cliente</dt><dd>{formatNumber(quote.totals.targetHours)} h</dd></div>
            <div><dt>Horas de campo orçadas</dt><dd>{formatNumber(quote.totals.fieldHours)} h ({quote.totals.fieldPeople} pessoas)</dd></div>
            <div><dt>Horas de mão de obra (todas as funções)</dt><dd>{formatNumber(quote.totals.totalLaborHours)} h</dd></div>
            <div><dt>Dias sugeridos</dt><dd>{quote.suggestedDays ?? '—'} (orçado: {quote.workDays})</dd></div>
            <div>
              <dt>Janela da SOW</dt>
              <dd>
                {quote.windowBusinessDays ?? '—'} dias úteis{' '}
                {quote.fitsWindow === false ? <Badge tone="danger">não cabe</Badge> : quote.fitsWindow ? <Badge tone="success">cabe</Badge> : null}
              </dd>
            </div>
          </dl>
          {quote.warnings.length > 0 && <p className="muted">{quote.warnings.join(' ')}</p>}

          {quote.suggestedTeam && (
            <div className="workflow-actions">
              <span>
                Equipe pelas horas-meta da AWS: <strong>{quote.suggestedTeam.foremen} encarregado + {quote.suggestedTeam.technicians} técnico(s) × {quote.suggestedTeam.days} dia(s)</strong>
                {(() => {
                  const people = (key: string) => rev.inputs.team.find((t) => t.roleKey === key)?.people ?? 0;
                  const same = rev.inputs.workDays === quote.suggestedTeam.days && people('tecnico') === quote.suggestedTeam.technicians && people('encarregado') === quote.suggestedTeam.foremen;
                  return same ? <> <Badge tone="success">aplicada</Badge></> : <> <Badge tone="warning">diferente da orçada</Badge></>;
                })()}
              </span>
              {editable && (
                <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void run(() => applySuggestedTeam(rev.id), 'Equipe recalculada pelas horas-meta da AWS.')}>
                  Aplicar equipe sugerida
                </button>
              )}
            </div>
          )}

          <h3>Horas por tipo de cabo (horas T)</h3>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th className="num">Qtd.</th>
                  <th className="num">Comp. médio</th>
                  <th className="num">Metros</th>
                  <th className="num">Portas</th>
                  <th className="num">Horas-meta</th>
                  <th className="num">Horas T</th>
                </tr>
              </thead>
              <tbody>
                {quote.perType.map((t) => (
                  <tr key={t.type}>
                    <td>{t.type}</td>
                    <td className="num">{t.quantity}</td>
                    <td className="num">{t.averageLengthM} m</td>
                    <td className="num">{formatNumber(t.consideredMeters)}</td>
                    <td className="num">{formatNumber(t.ports)}</td>
                    <td className="num">{formatNumber(t.targetHours)}</td>
                    <td className="num">
                      {editable ? (
                        <input inputMode="decimal" aria-label={`Horas T de ${t.type}`} placeholder={String(t.hoursTAuto)} value={hours[t.type] ?? ''} onChange={(e) => setHours((h) => ({ ...h, [t.type]: e.target.value }))} />
                      ) : (
                        <>
                          {formatNumber(t.hoursT)}
                          {t.overridden && <Badge tone="neutral">à mão</Badge>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Total</td>
                  <td className="num">{formatNumber(quote.totals.targetHours)}</td>
                  <td className="num">
                    {formatNumber(quote.hoursTSum)} {quote.hoursTMatches ? <Badge tone="success">= horas de campo</Badge> : <Badge tone="danger">{`≠ ${formatNumber(quote.totals.fieldHours)}`}</Badge>}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {editable && (
            <div className="workflow-actions">
              <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={saveHours}>
                Salvar horas T
              </button>
              <span className="muted">Em branco = proporcional às horas-meta (o valor sugerido aparece no campo).</span>
            </div>
          )}

          <h3>Indicadores do cliente (Bid KPIs)</h3>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Indicador</th>
                  <th className="num">Cotação</th>
                  <th className="num">Meta</th>
                  <th className="num">Desvio</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {quote.kpis.map((k) => {
                  const fmt = MONEY_KPIS.includes(k.key) ? formatBRL : formatNumber;
                  return (
                    <tr key={k.key}>
                      <td>{k.label}</td>
                      <td className="num">{k.value === null ? '—' : fmt(k.value)}</td>
                      <td className="num">{k.target === null ? '—' : fmt(k.target)}</td>
                      <td className="num">{k.delta === null ? '—' : formatPercent(k.delta)}</td>
                      <td>
                        {!k.flagged ? <Badge tone="success">dentro da meta</Badge> : k.justification ? <Badge tone="warning">justificado</Badge> : <Badge tone="danger">precisa justificar</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {quote.kpis.some((k) => k.flagged) && (
            <div className="workflow-reason">
              <p className="muted">Fora da meta, a AWS pede "Yes" e uma justificativa em inglês na aba Bid KPIs.</p>
              {quote.kpis
                .filter((k) => k.flagged)
                .map((k) => (
                  <label key={k.key}>
                    Justificativa (inglês) — {k.label}
                    <textarea value={notes[k.key] ?? ''} maxLength={2000} disabled={!editable || busy} onChange={(e) => setNotes((n) => ({ ...n, [k.key]: e.target.value }))} />
                  </label>
                ))}
              {editable && (
                <div className="workflow-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => updateKpiJustifications(rev.id, Object.fromEntries(quote.kpis.filter((k) => k.flagged).map((k) => [k.key, notes[k.key]?.trim() || null]))),
                        'Justificativas salvas.',
                      )
                    }
                  >
                    Salvar justificativas
                  </button>
                </div>
              )}
            </div>
          )}

          <details>
            <summary>Valores para a Bid</summary>
            <dl className="sow-grid">
              <div><dt>Nome da proposta</dt><dd>{quote.bidValues.proposalName}</dd></div>
              <div><dt>Início e conclusão</dt><dd>{formatDate(quote.bidValues.start)} a {formatDate(quote.bidValues.end)}</dd></div>
              <div><dt>Deslocamento</dt><dd>{quote.bidValues.travel.perCarDay !== null ? `${formatBRL(quote.bidValues.travel.perCarDay)} por carro/dia × ${quote.bidValues.travel.vehicleDays} diárias` : '—'}</dd></div>
              <div><dt>Plataforma</dt><dd>{quote.bidValues.platform.days ? `${formatBRL(quote.bidValues.platform.daily)} × ${quote.bidValues.platform.days} dias` : '—'}</dd></div>
            </dl>
            <ul className="workflow-history">
              {quote.bidValues.labor.map((l) => (
                <li key={l.roleKey}>
                  {l.label}: {formatBRL(l.rate)}/h × {formatNumber(l.hours)} h
                </li>
              ))}
            </ul>
            <p className="muted">Estes valores são escritos no próprio Bid Template ao aprovar o envio.</p>
          </details>
        </>
      )}

      {aws.bidTemplate && <RevisionBidSection rev={rev} canWrite={canWrite} />}
    </section>
  );
}
