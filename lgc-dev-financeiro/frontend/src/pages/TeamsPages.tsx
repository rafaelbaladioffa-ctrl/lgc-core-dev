import { useState, type FormEvent, type ReactNode } from 'react';
import {
  ACTIVITIES,
  ACTIVITY_LABEL,
  ADVANCE_STATUS_LABEL,
  ccLabel,
  createTeamLog,
  deleteTeamLog,
  formatPeriodLabel,
  getTeamPanel,
  labelOf,
  listTeamLogs,
  listTeams,
  today,
  validateTeamLog,
  withPeriod,
  type Period,
  type TeamActivity,
  type TeamLog,
  type TeamLogErrors,
  type TeamLogForm,
  type TeamPanel,
} from '../lib/costCenters';
import { formatNumber, formatPercent } from '../lib/decimal';
import { formatBRL, formatDate } from '../lib/format';
import { navigate } from '../lib/router';
import { Badge, ErrorAlert, Field, messageOf, PageHeader, useLoad } from '../components/ui';
import { Amount, Notice, PeriodPicker, useProjectOptions } from '../components/costCenterUi';

const teamHref = (id: string, p: Period) => withPeriod(`/equipes/${encodeURIComponent(id)}`, p);

// ================================================================ Comparativo

export function TeamsPage({ period }: { period: Period }) {
  const { data, error, loading, reload } = useLoad(() => listTeams(period), [period.from, period.to], 'Não foi possível carregar as equipes.');

  return (
    <>
      <PageHeader title="Equipes técnicas">
        <p className="muted">Comparativo das equipes (centros de custo do tipo equipe técnica) em {formatPeriodLabel(period)}.</p>
      </PageHeader>
      <PeriodPicker key={`${period.from}-${period.to}`} period={period} base="/equipes" />
      {error && <ErrorAlert message={error} onRetry={reload} />}
      {loading && !data && <p className="muted">Carregando…</p>}
      {data && (
        <div className="card table-card table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Equipe</th>
                <th className="num">Pessoas</th>
                <th className="num">Horas disponíveis</th>
                <th className="num">Horas em projeto</th>
                <th className="num">Utilização</th>
                <th className="num">Custo direto</th>
                <th className="num">Receita atribuída</th>
                <th className="num">Margem de contribuição</th>
                <th className="num">Custo por hora produtiva</th>
                <th className="num">Custo hora cotado</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted empty">
                    Nenhuma equipe técnica visível para você.
                  </td>
                </tr>
              )}
              {data.map((t) => (
                <tr key={t.id} className="row-link" onClick={() => navigate(teamHref(t.id, period))}>
                  <td>
                    <a href={`#${teamHref(t.id, period)}`}>{t.shortCode ?? t.code ?? '—'}</a>
                    {t.name && <div className="cell-sub">{t.name}</div>}
                  </td>
                  <td className="num">{t.headcount}</td>
                  <td className="num">{formatNumber(t.availableHours)}</td>
                  <td className="num">{formatNumber(t.projectHours)}</td>
                  <td className="num">{formatPercent(t.utilization)}</td>
                  <td className="num">{formatBRL(t.directCost)}</td>
                  <td className="num">{formatBRL(t.attributedRevenue)}</td>
                  <td className="num">
                    <Amount value={t.margin} />
                    <div className="cell-sub">{formatPercent(t.marginPct)}</div>
                  </td>
                  <td className="num">{formatBRL(t.costPerProjectHour)}</td>
                  <td className="num">{formatBRL(t.quotedCostPerHour)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ================================================================ Painel da equipe

function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'danger' | 'warning' }) {
  return (
    <div className={`axis-kpi${tone ? ` kpi-${tone}` : ''}`}>
      <div>
        <div className="axis-kpi__label">{label}</div>
        <div className="axis-kpi__value">{value}</div>
        {hint && <span className="kpi-hint">{hint}</span>}
      </div>
    </div>
  );
}

export function TeamPage({ id, period, canLog }: { id: string; period: Period; canLog: boolean }) {
  const panel = useLoad(() => getTeamPanel(id, period), [id, period.from, period.to], 'Não foi possível carregar o painel da equipe.');
  const logs = useLoad(() => listTeamLogs(id, period), [id, period.from, period.to], 'Não foi possível carregar o diário da equipe.');
  const t = panel.data;
  const back = { href: withPeriod('/equipes', period), label: 'Equipes técnicas' };

  if (panel.error && !t) {
    return (
      <>
        <PageHeader title="Painel da equipe" back={back} />
        <ErrorAlert message={panel.error} onRetry={panel.reload} />
      </>
    );
  }
  if (!t) return <p className="muted">Carregando…</p>;

  return (
    <>
      <PageHeader
        title={ccLabel(t)}
        back={back}
        actions={
          <a className="btn btn-ghost" href={`#${withPeriod(`/centros-de-custo/${encodeURIComponent(id)}`, period)}`}>
            Centro de custo
          </a>
        }
      >
        <p className="muted">Painel da equipe técnica · {formatPeriodLabel(t.period ?? period)} · dias úteis (segunda a sexta) até hoje.</p>
      </PageHeader>
      <PeriodPicker key={`${period.from}-${period.to}`} period={period} base={`/equipes/${encodeURIComponent(id)}`} />
      {panel.error && <ErrorAlert message={panel.error} onRetry={panel.reload} />}
      {t.warnings.length > 0 && (
        <div className="alert alert-warning" role="status">
          <ul className="plain-list">
            {t.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <Indicators t={t} />

      <div className="cc-columns">
        <section className="card">
          <h2>Horas por atividade</h2>
          <table className="table">
            <tbody>
              {t.hoursByActivity.length === 0 && (
                <tr>
                  <td className="muted empty">Nada lançado no diário no período.</td>
                </tr>
              )}
              {t.hoursByActivity.map((h) => (
                <tr key={h.activity}>
                  <td>{labelOf(ACTIVITY_LABEL, h.activity)}</td>
                  <td className="num">{formatNumber(h.hours)} h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2>Produção</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Unidade</th>
                <th className="num">Quantidade</th>
                <th className="num">Custo por unidade</th>
              </tr>
            </thead>
            <tbody>
              {t.production.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted empty">
                    Nenhuma produção lançada.
                  </td>
                </tr>
              )}
              {t.production.map((p) => (
                <tr key={p.unit}>
                  <td>{p.unit}</td>
                  <td className="num">{formatNumber(p.quantity)}</td>
                  <td className="num">{formatBRL(p.costPerUnit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card table-card table-scroll">
        <h2 className="card-pad">Receita por projeto</h2>
        <p className="muted section-hint card-pad">Receita do projeto no período × horas da equipe ÷ horas de todas as equipes no projeto.</p>
        <table className="table">
          <thead>
            <tr>
              <th>Projeto</th>
              <th className="num">Horas da equipe</th>
              <th className="num">Participação</th>
              <th className="num">Receita atribuída</th>
            </tr>
          </thead>
          <tbody>
            {t.revenueByProject.length === 0 && (
              <tr>
                <td colSpan={4} className="muted empty">
                  Nenhuma hora em projeto no período.
                </td>
              </tr>
            )}
            {t.revenueByProject.map((p) => (
              <tr key={p.projectId}>
                <td>
                  <a href={`#/projetos/${encodeURIComponent(p.projectId)}`}>{p.code ?? 'Projeto'}</a>
                </td>
                <td className="num">{formatNumber(p.teamHours)}</td>
                <td className="num">{formatPercent(p.share)}</td>
                <td className="num">{formatBRL(p.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="cc-columns">
        <section className="card">
          <h2>Despesas de campo</h2>
          {t.fieldExpenses.overLimit && (
            <p className="alert alert-danger" role="alert">
              Despesa por pessoa-dia acima do limite do centro de custo.
            </p>
          )}
          <dl className="kv kv-compact">
            <dt>Total no período</dt>
            <dd>{formatBRL(t.fieldExpenses.total)}</dd>
            <dt>Pessoas-dia (projeto e deslocamento)</dt>
            <dd>{t.fieldExpenses.personDays}</dd>
            <dt>Por pessoa-dia</dt>
            <dd>{formatBRL(t.fieldExpenses.perPersonDay)}</dd>
            <dt>Limite</dt>
            <dd>{t.fieldExpenses.limit ? formatBRL(t.fieldExpenses.limit) : 'sem limite'}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>Frota</h2>
          <dl className="kv kv-compact">
            <dt>Custo de frota</dt>
            <dd>{formatBRL(t.fleet.cost)}</dd>
            <dt>Km lançados</dt>
            <dd>{formatNumber(t.fleet.km)}</dd>
            <dt>Custo por km</dt>
            <dd>{formatBRL(t.fleet.costPerKm)}</dd>
            <dt>R$/km dos parâmetros</dt>
            <dd>{formatBRL(t.fleet.paramKmRate)}</dd>
          </dl>
          {t.fleet.costPerKm && t.fleet.paramKmRate && Number(t.fleet.costPerKm) > Number(t.fleet.paramKmRate) && <Badge tone="warning">acima do R$/km cotado</Badge>}
        </section>
      </div>

      <section className="card table-card table-scroll">
        <h2 className="card-pad">Membros alocados hoje</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Cargo</th>
              <th>Função no orçamento</th>
              <th>Desde</th>
            </tr>
          </thead>
          <tbody>
            {t.members.length === 0 && (
              <tr>
                <td colSpan={4} className="muted empty">
                  Ninguém alocado neste centro de custo.
                </td>
              </tr>
            )}
            {t.members.map((m) => (
              <tr key={m.collaboratorId}>
                <td>{m.name ?? m.collaboratorId}</td>
                <td>{m.jobTitleName ?? '—'}</td>
                <td>{m.roleKey ?? <Badge tone="warning">cargo sem função</Badge>}</td>
                <td className="nowrap">{formatDate(m.since)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="cc-columns">
        <section className="card">
          <h2>Adiantamentos em aberto</h2>
          <table className="table">
            <tbody>
              {t.advances.length === 0 && (
                <tr>
                  <td className="muted empty">Nenhum adiantamento em aberto.</td>
                </tr>
              )}
              {t.advances.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.collaboratorName ?? a.collaboratorId}
                    <div className="cell-sub muted">
                      {a.requestCode} · aprovado em {formatDate(a.approvedAt)} · {ADVANCE_STATUS_LABEL[a.status]}
                    </div>
                  </td>
                  <td className="num">{formatBRL(a.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2>Bens em custódia</h2>
          {t.custody.error && (
            <p className="alert alert-warning" role="status">
              {t.custody.error}
            </p>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>Custodiante</th>
                <th className="num">Itens</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {t.custody.items.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted empty">
                    {t.custody.error ? 'Dados da Logística indisponíveis.' : 'Nenhum bem em custódia dos alocados.'}
                  </td>
                </tr>
              )}
              {t.custody.items.map((c) => (
                <tr key={c.collaboratorId}>
                  <td>{c.name ?? c.collaboratorId}</td>
                  <td className="num">{c.items}</td>
                  <td className="num">{formatBRL(c.value)}</td>
                </tr>
              ))}
            </tbody>
            {t.custody.items.length > 0 && (
              <tfoot>
                <tr className="total-row">
                  <td>Total</td>
                  <td />
                  <td className="num">{formatBRL(t.custody.total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </section>
      </div>

      <TeamDiary
        id={id}
        state={logs}
        canLog={canLog}
        known={t.revenueByProject.map((p) => ({ id: p.projectId, label: p.code ?? p.projectId }))}
        onChanged={() => {
          logs.reload();
          panel.reload();
        }}
      />
    </>
  );
}

function Indicators({ t }: { t: TeamPanel }) {
  return (
    <section className="kpi-grid" aria-label="Indicadores do período">
      <Kpi label="Pessoas alocadas" value={t.headcount} />
      <Kpi label="Horas disponíveis" value={formatNumber(t.availableHours)} />
      <Kpi label="Horas em projeto" value={formatNumber(t.projectHours)} />
      <Kpi label="Utilização" value={formatPercent(t.utilization)} hint="horas em projeto ÷ disponíveis" />
      <Kpi label="Horas ociosas" value={formatNumber(t.idleHours)} />
      <Kpi label="Custo da ociosidade" value={formatBRL(t.idleCost)} tone={Number(t.idleCost) > 0 ? 'warning' : undefined} />
      <Kpi label="Custo direto" value={formatBRL(t.directCost)} />
      <Kpi label="Custo por hora disponível" value={formatBRL(t.costPerAvailableHour)} />
      <Kpi label="Custo por hora produtiva" value={formatBRL(t.costPerProjectHour)} />
      <Kpi label="Custo hora cotado" value={formatBRL(t.quotedCostPerHour)} hint="média das funções dos alocados" />
      <Kpi label="Receita atribuída" value={formatBRL(t.attributedRevenue)} />
      <Kpi label="Margem de contribuição" value={<Amount value={t.margin} />} hint={formatPercent(t.marginPct)} tone={t.margin.startsWith('-') ? 'danger' : undefined} />
      <Kpi label="Faturamento mínimo mensal" value={formatBRL(t.breakEvenMonthly)} hint="custo direto ÷ meses do período" />
    </section>
  );
}

// ---------------------------------------------------------------- Diário

const EMPTY_LOG = (): TeamLogForm => ({ date: today(), activity: 'projeto', projectId: '', people: '', hoursPerPerson: '8', km: '', producedQuantity: '', producedUnit: '', notes: '' });

function TeamDiary({ id, state, canLog, known, onChanged }: { id: string; state: ReturnType<typeof useLoad<TeamLog[]>>; canLog: boolean; known: { id: string; label: string }[]; onChanged: () => void }) {
  const [form, setForm] = useState<TeamLogForm | null>(null);
  const [errors, setErrors] = useState<TeamLogErrors & { form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const projects = useProjectOptions(known);

  const set = <K extends keyof TeamLogForm>(k: K, v: TeamLogForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const v = validateTeamLog(form);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setBusy(true);
    try {
      await createTeamLog(id, v.body);
      setForm(null);
      setNotice({ tone: 'success', text: 'Lançamento do diário registrado.' });
      onChanged();
    } catch (err) {
      setErrors({ form: messageOf(err, 'Não foi possível registrar no diário.') });
    } finally {
      setBusy(false);
    }
  }

  async function remove(log: TeamLog) {
    if (!window.confirm(`Excluir o lançamento de ${formatDate(log.date)} (${labelOf(ACTIVITY_LABEL, log.activity)})?`)) return;
    setBusy(true);
    setNotice(null);
    try {
      await deleteTeamLog(log.id);
      setNotice({ tone: 'success', text: 'Lançamento excluído do diário.' });
      onChanged();
    } catch (err) {
      setNotice({ tone: 'danger', text: messageOf(err, 'Não foi possível excluir o lançamento.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card table-card">
      <div className="card-pad cc-section-head">
        <h2>Diário da equipe</h2>
        {canLog && !form && (
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setForm(EMPTY_LOG());
              setErrors({});
              setNotice(null);
            }}
          >
            Lançar no diário
          </button>
        )}
      </div>
      <div className="card-pad">
        <Notice notice={notice} />
        {form && (
          <form className="cc-form" onSubmit={submit} noValidate>
            <div className="grid-3">
              <Field label="Data" required error={errors.date}>
                <input type="date" value={form.date} max={today()} onChange={(e) => set('date', e.target.value)} aria-invalid={!!errors.date} />
              </Field>
              <Field label="Atividade" required>
                <select value={form.activity} onChange={(e) => set('activity', e.target.value as TeamActivity)}>
                  {ACTIVITIES.map((a) => (
                    <option key={a} value={a}>
                      {ACTIVITY_LABEL[a]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Projeto" required={form.activity === 'projeto'} error={errors.projectId} hint={projects.error ? `Lista de projetos indisponível: ${projects.error}` : undefined}>
                <select value={form.projectId} onChange={(e) => set('projectId', e.target.value)} aria-invalid={!!errors.projectId}>
                  <option value="">{form.activity === 'projeto' ? 'Escolha o projeto' : 'Sem projeto'}</option>
                  {projects.options.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Pessoas" required error={errors.people}>
                <input inputMode="numeric" value={form.people} onChange={(e) => set('people', e.target.value)} aria-invalid={!!errors.people} />
              </Field>
              <Field label="Horas por pessoa" required error={errors.hoursPerPerson}>
                <input inputMode="decimal" value={form.hoursPerPerson} onChange={(e) => set('hoursPerPerson', e.target.value)} aria-invalid={!!errors.hoursPerPerson} />
              </Field>
              <Field label="Km rodados" error={errors.km}>
                <input inputMode="decimal" value={form.km} onChange={(e) => set('km', e.target.value)} aria-invalid={!!errors.km} />
              </Field>
              <Field label="Quantidade produzida" error={errors.producedQuantity}>
                <input inputMode="decimal" value={form.producedQuantity} onChange={(e) => set('producedQuantity', e.target.value)} aria-invalid={!!errors.producedQuantity} />
              </Field>
              <Field label="Unidade" hint="Ex.: km de fibra, pontos, racks." error={errors.producedUnit}>
                <input value={form.producedUnit} maxLength={40} list="team-log-units" onChange={(e) => set('producedUnit', e.target.value)} aria-invalid={!!errors.producedUnit} />
              </Field>
            </div>
            <datalist id="team-log-units">
              <option value="km de fibra" />
              <option value="pontos" />
              <option value="racks" />
            </datalist>
            <Field label="Observação">
              <textarea className="textarea" rows={2} maxLength={500} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
            {errors.form && <ErrorAlert message={errors.form} />}
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? 'Salvando…' : 'Registrar'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setForm(null)} disabled={busy}>
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
      {state.error && (
        <div className="card-pad">
          <ErrorAlert message={state.error} onRetry={state.reload} />
        </div>
      )}
      {state.loading && !state.data && <p className="muted card-pad">Carregando…</p>}
      {state.data && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Atividade</th>
                <th className="num">Pessoas</th>
                <th className="num">Horas/pessoa</th>
                <th className="num">Km</th>
                <th>Produção</th>
                <th>Observação</th>
                {canLog && <th aria-label="Ações" />}
              </tr>
            </thead>
            <tbody>
              {state.data.length === 0 && (
                <tr>
                  <td colSpan={canLog ? 8 : 7} className="muted empty">
                    Nada lançado no diário no período.
                  </td>
                </tr>
              )}
              {state.data.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{formatDate(l.date)}</td>
                  <td>
                    {labelOf(ACTIVITY_LABEL, l.activity)}
                    {l.projectCode && <div className="cell-sub">{l.projectCode}</div>}
                  </td>
                  <td className="num">{l.people}</td>
                  <td className="num">{formatNumber(l.hoursPerPerson)}</td>
                  <td className="num">{formatNumber(l.km)}</td>
                  <td>{l.producedQuantity ? `${formatNumber(l.producedQuantity)} ${l.producedUnit ?? ''}` : '—'}</td>
                  <td>
                    {l.notes ?? '—'}
                    {l.createdByName && <div className="cell-sub muted">por {l.createdByName}</div>}
                  </td>
                  {canLog && (
                    <td>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => remove(l)} disabled={busy}>
                        Excluir
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
