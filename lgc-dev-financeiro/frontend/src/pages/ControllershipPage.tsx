import { Fragment, useState, type FormEvent } from 'react';
import {
  ADVANCE_STATUS_LABEL,
  ccLabel,
  currentMonth,
  defaultPeriod,
  deleteOverheadRule,
  DRIVER_LABEL,
  DRIVERS,
  formatMonth,
  generatePayroll,
  getJobTitleMaps,
  importFieldLabor,
  importLogistics,
  listAdvances,
  listCostCenters,
  listOverheadRules,
  logisticsImportWarning,
  percentTargetsComplete,
  saveJobTitleMap,
  saveOverheadRule,
  settleAdvance,
  today,
  validateDayRange,
  validateMonth,
  type Advance,
  type FieldLaborImportResult,
  type CcSummary,
  type LogisticsImportResult,
  type OverheadDriver,
  type OverheadRule,
  type PayrollResult,
} from '../lib/costCenters';
import { formatPercent, fractionToPercentInput, parseDecimal, parsePercent } from '../lib/decimal';
import { formatBRL, formatDate } from '../lib/format';
import { Badge, ErrorAlert, Field, messageOf, PageHeader, useLoad } from '../components/ui';
import { Notice } from '../components/costCenterUi';

/** Controladoria (`cost_center:write`): rateio, cargos × funções, folha, importação da Logística e adiantamentos. */
export function ControllershipPage() {
  const ccs = useLoad(() => listCostCenters(defaultPeriod()), [], 'Não foi possível carregar os centros de custo.');
  const centers = ccs.data?.items ?? [];

  return (
    <>
      <PageHeader title="Controladoria">
        <p className="muted">Fechamento da competência, rateio do overhead, cargos × funções e prestação de contas dos adiantamentos.</p>
      </PageHeader>
      {ccs.error && <ErrorAlert message={ccs.error} onRetry={ccs.reload} />}
      <Closing />
      <FieldLabor />
      <OverheadRules centers={centers} centersLoading={ccs.loading} />
      <JobTitles />
      <Advances centers={centers} />
    </>
  );
}

const nameOf = (centers: CcSummary[], id: string, fallback?: string | null) => {
  const cc = centers.find((c) => c.id === id);
  return cc ? ccLabel(cc) : (fallback ?? 'Centro não encontrado');
};

// ================================================================ Folha e Logística

function Closing() {
  const [month, setMonth] = useState(currentMonth());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'folha' | 'logistica' | null>(null);
  const [payroll, setPayroll] = useState<PayrollResult | null>(null);
  const [logistics, setLogistics] = useState<LogisticsImportResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function run(kind: 'folha' | 'logistica', e?: FormEvent) {
    e?.preventDefault();
    const err = validateMonth(month);
    setError(err);
    if (err) return;
    setBusy(kind);
    setFailure(null);
    try {
      if (kind === 'folha') setPayroll(await generatePayroll(month.trim()));
      else setLogistics(await importLogistics(month.trim()));
    } catch (ex) {
      setFailure(messageOf(ex, kind === 'folha' ? 'Não foi possível gerar a folha.' : 'Não foi possível importar o consumo da Logística.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card">
      <h2>Fechamento da competência</h2>
      <p className="muted section-hint">
        Gerar de novo a mesma competência compara com o que já foi lançado: o que mudou é estornado e lançado outra vez; o que é igual fica.
      </p>
      <form className="inline-form" onSubmit={(e) => run('folha', e)} noValidate>
        <Field label="Competência (AAAA-MM)" required error={error ?? undefined}>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-invalid={!!error} />
        </Field>
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy !== null}>
            {busy === 'folha' ? 'Gerando…' : 'Gerar folha'}
          </button>
          <button className="btn btn-ghost" type="button" disabled={busy !== null} onClick={() => run('logistica')}>
            {busy === 'logistica' ? 'Importando…' : 'Importar da Logística'}
          </button>
        </div>
      </form>
      {failure && <ErrorAlert message={failure} />}
      {payroll && (
        <div className="cc-subsection">
          <h3>Folha de {formatMonth(payroll.month)}</h3>
          <p>
            {payroll.created} lançamentos novos · {payroll.replaced} substituídos · {payroll.unchanged} sem alteração.
          </p>
          {payroll.unmapped.length > 0 && (
            <>
              <p className="alert alert-warning" role="status">
                {payroll.unmapped.length} {payroll.unmapped.length === 1 ? 'colaborador ficou' : 'colaboradores ficaram'} fora da folha por não ter cargo mapeado para uma função. Mapeie em
                "Cargos × funções" e gere de novo.
              </p>
              <table className="table">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Cargo no Axis Core</th>
                  </tr>
                </thead>
                <tbody>
                  {payroll.unmapped.map((u) => (
                    <tr key={u.collaboratorId}>
                      <td>{u.name ?? u.collaboratorId}</td>
                      <td>{u.jobTitleName ?? <span className="muted">sem cargo</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
      {logistics && (
        <div className="cc-subsection">
          <h3>Consumo da Logística em {formatMonth(logistics.month)}</h3>
          <p>
            {logistics.created} lançamentos novos · {logistics.replaced} substituídos · {logistics.unchanged} sem alteração.
          </p>
          {logisticsImportWarning(logistics) && (
            <p className="alert alert-warning" role="status">
              {logisticsImportWarning(logistics)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ================================================================ Mão de obra (horas do Field)

function FieldLabor() {
  const [from, setFrom] = useState(`${currentMonth()}-01`);
  const [to, setTo] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FieldLaborImportResult | null>(null);

  async function run(e: FormEvent) {
    e.preventDefault();
    const err = validateDayRange(from, to);
    setError(err);
    if (err) return;
    setBusy(true);
    setFailure(null);
    try {
      setResult(await importFieldLabor(from, to));
    } catch (ex) {
      setFailure(messageOf(ex, 'Não foi possível importar as horas do Field.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Mão de obra dos projetos (horas do Field)</h2>
      <p className="muted section-hint">
        Horas reais dos técnicos × custo hora médio da função. Cada dia vira um custo no centro de custo do projeto e um crédito de mão de obra transferida no centro de origem do técnico. A rotina
        diária faz isso sozinha; use o botão para um período específico (até 62 dias). Reimportar compara com o que já foi lançado: o que mudou é estornado e lançado outra vez.
      </p>
      <form className="inline-form" onSubmit={run} noValidate>
        <Field label="De" required error={error ?? undefined}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-invalid={!!error} />
        </Field>
        <Field label="Até" required>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!!error} />
        </Field>
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Importando…' : 'Importar horas do Field'}
          </button>
        </div>
      </form>
      {failure && <ErrorAlert message={failure} />}
      {result && (
        <div className="cc-subsection">
          <h3>
            Horas do Field de {formatDate(result.from)} a {formatDate(result.to)}
          </h3>
          <p>
            {result.launchedHours} h lançadas de {result.hours} h · {result.created} lançamentos novos · {result.replaced} substituídos · {result.unchanged} sem alteração.
          </p>
          {result.invalidRows > 0 && (
            <p className="alert alert-warning" role="status">
              {result.invalidRows} linha(s) do Field fora do contrato foram ignoradas.
            </p>
          )}
          {result.pending.length > 0 && (
            <>
              <p className="alert alert-warning" role="status">
                {result.pending.length} {result.pending.length === 1 ? 'pendência' : 'pendências'}: horas que não viraram lançamento. Corrija (por exemplo, em "Cargos × funções") e importe de novo.
              </p>
              <table className="table">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Projeto</th>
                    <th>Motivo</th>
                    <th>Dias</th>
                    <th>Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {result.pending.map((p) => (
                    <tr key={`${p.collaboratorId}-${p.projectId}-${p.reason}`}>
                      <td>{p.collaboratorName ?? p.collaboratorId}</td>
                      <td>{p.projectCode ?? p.projectId}</td>
                      <td>{p.reasonLabel}</td>
                      <td>{p.days}</td>
                      <td>{p.hours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ================================================================ Rateio

type TargetRow = { costCenterId: string; percent: string };
type RuleForm = { sourceId: string; driver: OverheadDriver; active: boolean; notes: string; targets: TargetRow[]; existing: boolean };

const emptyRule = (): RuleForm => ({ sourceId: '', driver: 'headcount', active: true, notes: '', targets: [{ costCenterId: '', percent: '' }], existing: false });
const ruleToForm = (r: OverheadRule): RuleForm => ({
  sourceId: r.sourceCostCenterId,
  driver: r.driver,
  active: r.active,
  notes: r.notes ?? '',
  targets: r.targets.map((t) => ({ costCenterId: t.costCenterId, percent: fractionToPercentInput(t.percent) })),
  existing: true,
});

function OverheadRules({ centers, centersLoading }: { centers: CcSummary[]; centersLoading: boolean }) {
  const rules = useLoad(listOverheadRules, [], 'Não foi possível carregar as regras de rateio.');
  const [form, setForm] = useState<RuleForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const sorted = [...centers].sort((a, b) => ccLabel(a).localeCompare(ccLabel(b), 'pt-BR'));

  const patch = (p: Partial<RuleForm>) => setForm((f) => (f ? { ...f, ...p } : f));
  const patchTarget = (i: number, p: Partial<TargetRow>) => setForm((f) => (f ? { ...f, targets: f.targets.map((t, j) => (j === i ? { ...t, ...p } : t)) } : f));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const targets = form.targets.filter((t) => t.costCenterId);
    let err: string | null = null;
    const fractions: string[] = [];
    if (!form.sourceId) err = 'Escolha o centro de origem.';
    else if (targets.length === 0) err = 'Inclua ao menos um centro de destino.';
    else if (targets.some((t) => t.costCenterId === form.sourceId)) err = 'O centro de origem não pode ser destino de si mesmo.';
    else if (new Set(targets.map((t) => t.costCenterId)).size !== targets.length) err = 'Há destinos repetidos.';
    else if (form.driver === 'percentual') {
      for (const t of targets) {
        const p = parsePercent(t.percent, 4);
        if (!p.ok || !p.value || Number(p.value) <= 0) {
          err = `Informe o percentual de ${nameOf(centers, t.costCenterId)} (até 2 casas).`;
          break;
        }
        fractions.push(p.value);
      }
      if (!err && !percentTargetsComplete(fractions)) err = 'Os percentuais dos destinos precisam somar 100%.';
    }
    setFormError(err);
    if (err) return;
    setBusy(true);
    try {
      await saveOverheadRule(form.sourceId, {
        driver: form.driver,
        active: form.active,
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        targets: targets.map((t, i) => (form.driver === 'percentual' ? { costCenterId: t.costCenterId, percent: fractions[i] } : { costCenterId: t.costCenterId })),
      });
      setForm(null);
      setNotice({ tone: 'success', text: 'Regra de rateio salva.' });
      rules.reload();
    } catch (ex) {
      setFormError(messageOf(ex, 'Não foi possível salvar a regra.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: OverheadRule) {
    if (!window.confirm(`Excluir a regra de rateio de ${r.sourceName ?? nameOf(centers, r.sourceCostCenterId)}?`)) return;
    setBusy(true);
    setNotice(null);
    try {
      await deleteOverheadRule(r.sourceCostCenterId);
      setNotice({ tone: 'success', text: 'Regra de rateio excluída.' });
      rules.reload();
    } catch (ex) {
      setNotice({ tone: 'danger', text: messageOf(ex, 'Não foi possível excluir a regra.') });
    } finally {
      setBusy(false);
    }
  }

  const usedSources = new Set((rules.data ?? []).map((r) => r.sourceCostCenterId));

  return (
    <section className="card">
      <div className="cc-section-head">
        <h2>Rateio do overhead</h2>
        {!form && (
          <button
            className="btn btn-primary"
            type="button"
            disabled={centersLoading}
            onClick={() => {
              setForm(emptyRule());
              setFormError(null);
              setNotice(null);
            }}
          >
            Nova regra
          </button>
        )}
      </div>
      <p className="muted section-hint">Calculado na consulta: o custo realizado da origem no período é distribuído pelos pesos dos destinos.</p>
      <Notice notice={notice} />
      {form && (
        <form className="cc-form" onSubmit={save} noValidate>
          <div className="grid-3">
            <Field label="Centro de origem" required>
              <select value={form.sourceId} disabled={form.existing} onChange={(e) => patch({ sourceId: e.target.value })}>
                <option value="">Escolha</option>
                {sorted
                  .filter((c) => form.existing || !usedSources.has(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {ccLabel(c)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Direcionador" required>
              <select value={form.driver} onChange={(e) => patch({ driver: e.target.value as OverheadDriver })}>
                {DRIVERS.map((d) => (
                  <option key={d} value={d}>
                    {DRIVER_LABEL[d]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="field">
              <span>Situação</span>
              <label className="checkbox">
                <input type="checkbox" checked={form.active} onChange={(e) => patch({ active: e.target.checked })} /> Regra ativa
              </label>
            </div>
          </div>
          <table className="table table-form">
            <thead>
              <tr>
                <th>Centro de destino</th>
                {form.driver === 'percentual' && <th className="num">Percentual (%)</th>}
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {form.targets.map((t, i) => (
                <tr key={i}>
                  <td>
                    <select className="table-select" value={t.costCenterId} onChange={(e) => patchTarget(i, { costCenterId: e.target.value })} aria-label={`Destino ${i + 1}`}>
                      <option value="">Escolha</option>
                      {sorted
                        .filter((c) => c.id !== form.sourceId)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {ccLabel(c)}
                          </option>
                        ))}
                    </select>
                  </td>
                  {form.driver === 'percentual' && (
                    <td className="num">
                      <input inputMode="decimal" value={t.percent} onChange={(e) => patchTarget(i, { percent: e.target.value })} aria-label={`Percentual do destino ${i + 1}`} />
                    </td>
                  )}
                  <td>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => patch({ targets: form.targets.filter((_, j) => j !== i) })}>
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => patch({ targets: [...form.targets, { costCenterId: '', percent: '' }] })}>
              Adicionar destino
            </button>
          </p>
          <Field label="Observação">
            <textarea className="textarea" rows={2} maxLength={500} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </Field>
          {formError && <ErrorAlert message={formError} />}
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar regra'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setForm(null)} disabled={busy}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {rules.error && <ErrorAlert message={rules.error} onRetry={rules.reload} />}
      {rules.loading && !rules.data && <p className="muted">Carregando…</p>}
      {rules.data && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Origem</th>
                <th>Direcionador</th>
                <th>Destinos</th>
                <th>Situação</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {rules.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted empty">
                    Nenhuma regra de rateio.
                  </td>
                </tr>
              )}
              {rules.data.map((r) => (
                <tr key={r.sourceCostCenterId}>
                  <td>
                    {r.sourceName ?? nameOf(centers, r.sourceCostCenterId)}
                    {r.notes && <div className="cell-sub muted">{r.notes}</div>}
                  </td>
                  <td>{DRIVER_LABEL[r.driver] ?? r.driver}</td>
                  <td>
                    <ul className="plain-list">
                      {r.targets.map((t) => (
                        <li key={t.costCenterId}>
                          {t.name ?? nameOf(centers, t.costCenterId)}
                          {r.driver === 'percentual' && ` · ${formatPercent(t.percent)}`}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>{r.active ? <Badge tone="success">ativa</Badge> : <Badge tone="neutral">inativa</Badge>}</td>
                  <td className="nowrap">
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setForm(ruleToForm(r));
                        setFormError(null);
                        setNotice(null);
                      }}
                    >
                      Editar
                    </button>{' '}
                    <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => remove(r)}>
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ================================================================ Cargos × funções

function JobTitles() {
  const maps = useLoad(getJobTitleMaps, [], 'Não foi possível carregar os cargos.');
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function save(jobTitleId: string, jobTitleName: string, current: string | null) {
    const roleKey = choice[jobTitleId] ?? current ?? '';
    if (!roleKey) return setNotice({ tone: 'danger', text: `Escolha a função para o cargo ${jobTitleName}.` });
    setBusy(jobTitleId);
    setNotice(null);
    try {
      await saveJobTitleMap(jobTitleId, jobTitleName, roleKey);
      setNotice({ tone: 'success', text: `Cargo ${jobTitleName} mapeado.` });
      setChoice((prev) => {
        const next = { ...prev };
        delete next[jobTitleId];
        return next;
      });
      maps.reload();
    } catch (ex) {
      setNotice({ tone: 'danger', text: messageOf(ex, 'Não foi possível salvar o mapeamento.') });
    } finally {
      setBusy(null);
    }
  }

  const roles = maps.data?.roles ?? [];
  const roleSelect = (jobTitleId: string, current: string | null, name: string) => (
    <select className="table-select" value={choice[jobTitleId] ?? current ?? ''} onChange={(e) => setChoice({ ...choice, [jobTitleId]: e.target.value })} aria-label={`Função para ${name}`}>
      <option value="">Escolha a função</option>
      {roles.map((r) => (
        <option key={r.roleKey} value={r.roleKey}>
          {r.label}
        </option>
      ))}
    </select>
  );

  return (
    <section className="card">
      <h2>Cargos × funções</h2>
      <p className="muted section-hint">O cargo do Axis Core define a função do orçamento usada no custo da folha por centro de custo. O nome do cargo é mantido no Axis Core.</p>
      <Notice notice={notice} />
      {maps.error && <ErrorAlert message={maps.error} onRetry={maps.reload} />}
      {maps.loading && !maps.data && <p className="muted">Carregando…</p>}
      {maps.data && (
        <>
          {maps.data.unmapped.length > 0 && (
            <>
              <p className="alert alert-warning" role="status">
                {maps.data.unmapped.length} {maps.data.unmapped.length === 1 ? 'cargo sem função' : 'cargos sem função'}: quem tem esses cargos fica fora da folha.
              </p>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Cargo sem função</th>
                      <th className="num">Colaboradores</th>
                      <th>Função</th>
                      <th aria-label="Ações" />
                    </tr>
                  </thead>
                  <tbody>
                    {maps.data.unmapped.map((u) => (
                      <tr key={u.jobTitleId}>
                        <td>{u.jobTitleName}</td>
                        <td className="num">{u.collaborators ?? '—'}</td>
                        <td>{roleSelect(u.jobTitleId, null, u.jobTitleName)}</td>
                        <td>
                          <button className="btn btn-primary btn-sm" type="button" disabled={busy !== null} onClick={() => save(u.jobTitleId, u.jobTitleName, null)}>
                            {busy === u.jobTitleId ? 'Salvando…' : 'Mapear'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Cargo</th>
                  <th>Função</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {maps.data.maps.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted empty">
                      Nenhum cargo mapeado ainda.
                    </td>
                  </tr>
                )}
                {maps.data.maps.map((m) => {
                  const changed = choice[m.jobTitleId] !== undefined && choice[m.jobTitleId] !== m.roleKey;
                  return (
                    <tr key={m.jobTitleId}>
                      <td>
                        {m.jobTitleName} {m.active === false && <Badge tone="warning">Excluído no Core</Badge>}
                      </td>
                      <td>{roleSelect(m.jobTitleId, m.roleKey, m.jobTitleName)}</td>
                      <td>
                        {changed && (
                          <button className="btn btn-primary btn-sm" type="button" disabled={busy !== null} onClick={() => save(m.jobTitleId, m.jobTitleName, m.roleKey)}>
                            {busy === m.jobTitleId ? 'Salvando…' : 'Salvar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {roles.length === 0 && <p className="muted">Nenhuma função no conjunto de parâmetros vigente.</p>}
        </>
      )}
    </section>
  );
}

// ================================================================ Adiantamentos

function Advances({ centers }: { centers: CcSummary[] }) {
  const [status, setStatus] = useState<Advance['status']>('aberto');
  const list = useLoad(() => listAdvances(status), [status], 'Não foi possível carregar os adiantamentos.');
  const [settling, setSettling] = useState<{ id: string; spent: string; notes: string; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function settle(e: FormEvent) {
    e.preventDefault();
    if (!settling) return;
    const spent = parseDecimal(settling.spent, 2);
    if (!spent.ok) return setSettling({ ...settling, error: spent.error });
    if (spent.value === null) return setSettling({ ...settling, error: 'Informe o valor comprovado (0 se nada foi gasto).' });
    setBusy(true);
    try {
      await settleAdvance(settling.id, spent.value, settling.notes.trim() || undefined);
      setSettling(null);
      setNotice({ tone: 'success', text: 'Prestação de contas registrada.' });
      list.reload();
    } catch (ex) {
      setSettling({ ...settling, error: messageOf(ex, 'Não foi possível registrar a prestação de contas.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="cc-section-head">
        <h2>Adiantamentos</h2>
        <div className="segmented" role="group" aria-label="Situação dos adiantamentos">
          <button type="button" aria-pressed={status === 'aberto'} onClick={() => setStatus('aberto')}>
            Em aberto
          </button>
          <button type="button" aria-pressed={status === 'prestado'} onClick={() => setStatus('prestado')}>
            Prestados
          </button>
        </div>
      </div>
      <p className="muted section-hint">A prestação de contas baixa o comprometido e lança o gasto comprovado como realizado em despesas de campo.</p>
      <Notice notice={notice} />
      {list.error && <ErrorAlert message={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <p className="muted">Carregando…</p>}
      {list.data && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Requisição</th>
                <th>Colaborador</th>
                <th>Centro de custo</th>
                <th>Aprovado em</th>
                <th className="num">Valor</th>
                {status === 'prestado' && <th className="num">Comprovado</th>}
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {list.data.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted empty">
                    {status === 'aberto' ? 'Nenhum adiantamento em aberto.' : 'Nenhum adiantamento prestado.'}
                  </td>
                </tr>
              )}
              {list.data.map((a) => (
                <Fragment key={a.id}>
                  <tr>
                    <td>{a.requestCode}</td>
                    <td>{a.collaboratorName ?? a.collaboratorId}</td>
                    <td>{nameOf(centers, a.costCenterId)}</td>
                    <td className="nowrap">{formatDate(a.approvedAt)}</td>
                    <td className="num">{formatBRL(a.amount)}</td>
                    {status === 'prestado' && (
                      <td className="num">
                        {formatBRL(a.spentAmount)}
                        <div className="cell-sub muted">{formatDate(a.settledAt)}</div>
                      </td>
                    )}
                    <td>
                      {a.status === 'aberto' ? (
                        <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => setSettling({ id: a.id, spent: '', notes: '', error: null })}>
                          Prestar contas
                        </button>
                      ) : (
                        <Badge tone="success">{ADVANCE_STATUS_LABEL[a.status]}</Badge>
                      )}
                    </td>
                  </tr>
                  {settling?.id === a.id && (
                    <tr>
                      <td colSpan={7}>
                        <form className="inline-form" onSubmit={settle} noValidate>
                          <div className="grid-2">
                            <Field label="Gasto comprovado (R$)" required hint={`Adiantado: ${formatBRL(a.amount)}`} error={settling.error ?? undefined}>
                              <input
                                autoFocus
                                inputMode="decimal"
                                value={settling.spent}
                                onChange={(e) => setSettling({ ...settling, spent: e.target.value, error: null })}
                                aria-invalid={!!settling.error}
                              />
                            </Field>
                            <Field label="Observação">
                              <input value={settling.notes} maxLength={300} onChange={(e) => setSettling({ ...settling, notes: e.target.value })} />
                            </Field>
                          </div>
                          <div className="form-actions">
                            <button className="btn btn-primary" type="submit" disabled={busy}>
                              {busy ? 'Salvando…' : 'Registrar prestação'}
                            </button>
                            <button className="btn btn-ghost" type="button" onClick={() => setSettling(null)} disabled={busy}>
                              Cancelar
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
