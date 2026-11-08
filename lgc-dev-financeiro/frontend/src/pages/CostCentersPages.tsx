import { Fragment, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import {
  ALERT_TYPE_LABEL,
  budgetTotals,
  CATEGORY_LABEL,
  ccLabel,
  COST_CATEGORIES,
  createEntry,
  ENTRY_KIND_LABEL,
  FUNNEL_LABEL,
  formatMonth,
  formatPeriodLabel,
  getBudget,
  getCostCenter,
  KIND_LABEL,
  labelOf,
  listCostCenters,
  listEntries,
  listPurchases,
  MONTH_LABELS,
  normalizeBudgetRows,
  reverseEntry,
  saveBudget,
  saveCostCenterSettings,
  SOURCE_LABEL,
  STAGE_LABEL,
  sumDecimals,
  isDate,
  buildTree,
  today,
  withPeriod,
  type CcDetail,
  type Entry,
  type EntryKind,
  type Figures,
  type Period,
} from '../lib/costCenters';
import { decimalToInput, formatPercent, parseDecimal } from '../lib/decimal';
import { formatBRL, formatDate, formatDateTime } from '../lib/format';
import { Badge, ErrorAlert, Field, messageOf, PageHeader, useLoad, useUnsavedWarning } from '../components/ui';
import { Amount, BudgetBar, Notice, PeriodPicker, useProjectOptions } from '../components/costCenterUi';

type Mode = 'own' | 'consolidated';

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Valores exibidos">
      <button type="button" aria-pressed={mode === 'own'} onClick={() => onChange('own')}>
        Próprio
      </button>
      <button type="button" aria-pressed={mode === 'consolidated'} onClick={() => onChange('consolidated')}>
        Consolidado
      </button>
    </div>
  );
}

// ================================================================ Lista (árvore)

export function CostCentersPage({ period }: { period: Period }) {
  const { data, error, loading, reload } = useLoad(() => listCostCenters(period), [period.from, period.to], 'Não foi possível carregar os centros de custo.');
  const [mode, setMode] = useState<Mode>('consolidated');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showInactive, setShowInactive] = useState(false);

  const items = useMemo(() => (data?.items ?? []).filter((i) => showInactive || i.active), [data, showInactive]);
  const rows = useMemo(() => buildTree(items, collapsed), [items, collapsed]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <PageHeader title="Centros de custo">
        <p className="muted">
          Receita, custo, comprometido e resultado de {formatPeriodLabel(period)}; consumo do orçamento do ano {data ? data.year : ''}.
        </p>
      </PageHeader>
      <PeriodPicker key={`${period.from}-${period.to}`} period={period} base="/centros-de-custo" />
      {error && <ErrorAlert message={error} onRetry={reload} />}
      {loading && !data && <p className="muted">Carregando…</p>}
      {data && data.alerts.length > 0 && (
        <section className="card cc-alerts" aria-label="Alertas">
          <h2>Alertas</h2>
          <ul>
            {data.alerts.map((a, i) => (
              <li key={`${a.costCenterId}-${a.type}-${i}`}>
                <Badge tone={a.type === 'orcamento' ? 'danger' : 'warning'}>{ALERT_TYPE_LABEL[a.type] ?? a.type}</Badge>{' '}
                <a href={`#${withPeriod(`/centros-de-custo/${encodeURIComponent(a.costCenterId)}`, period)}`}>{a.name ?? 'Centro sem nome'}</a>: {a.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      {data && (
        <>
          <div className="toolbar">
            <ModeToggle mode={mode} onChange={setMode} />
            <label className="checkbox">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostrar inativos
            </label>
            <span className="muted">{mode === 'own' ? 'Só os lançamentos do próprio centro.' : 'O centro e todos os descendentes.'}</span>
          </div>
          <div className="card table-card table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Centro de custo</th>
                  <th>Tipo</th>
                  <th className="num">Receita</th>
                  <th className="num">Custo realizado</th>
                  <th className="num">Comprometido</th>
                  <th className="num">Resultado</th>
                  <th className="num">Margem</th>
                  <th>Orçamento do ano</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted empty">
                      {data.items.length === 0 ? 'Nenhum centro de custo visível para você. Os centros vêm do Axis Core.' : 'Nenhum centro ativo.'}
                    </td>
                  </tr>
                )}
                {rows.map(({ item, depth, hasChildren }) => {
                  const f = mode === 'own' ? item.own : item.consolidated;
                  const href = `#${withPeriod(`/centros-de-custo/${encodeURIComponent(item.id)}`, period)}`;
                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="tree-cell" data-depth={Math.min(depth, 6)}>
                          {hasChildren ? (
                            <button className="tree-toggle" type="button" onClick={() => toggle(item.id)} aria-expanded={!collapsed.has(item.id)} aria-label={collapsed.has(item.id) ? 'Expandir' : 'Recolher'}>
                              {collapsed.has(item.id) ? '▸' : '▾'}
                            </button>
                          ) : (
                            <span className="tree-toggle-spacer" />
                          )}
                          <span>
                            <a href={href}>{item.shortCode ?? item.code ?? '—'}</a>
                            <div className="cell-sub">
                              {item.name ?? <span className="muted">Sem nome</span>} {!item.active && <Badge tone="neutral">inativo</Badge>}
                            </div>
                          </span>
                        </div>
                      </td>
                      <td>{item.kind ? KIND_LABEL[item.kind] : '—'}</td>
                      <td className="num">{formatBRL(f.revenue)}</td>
                      <td className="num">{formatBRL(f.cost)}</td>
                      <td className="num">{formatBRL(f.committed)}</td>
                      <td className="num">
                        <Amount value={f.result} />
                      </td>
                      <td className="num">{formatPercent(f.margin)}</td>
                      <td>
                        <BudgetBar budget={item.budget} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted table-count">{data.items.length} centros de custo</p>
          </div>
        </>
      )}
    </>
  );
}

// ================================================================ Detalhe

function Dre({ own, consolidated, hasChildren }: { own: Figures; consolidated: Figures; hasChildren: boolean }) {
  const lines: Array<{ label: string; key: keyof Figures; strong?: boolean; sub?: boolean; pct?: boolean }> = [
    { label: 'Receita', key: 'revenue' },
    { label: '(−) Custo realizado', key: 'cost' },
    { label: '(−) Rateio recebido', key: 'overheadIn' },
    { label: '(+) Rateio cedido', key: 'overheadOut' },
    { label: '= Resultado', key: 'result', strong: true },
    { label: 'Margem sobre a receita', key: 'margin', pct: true },
    { label: 'Comprometido em aberto (fora do resultado)', key: 'committed', sub: true },
  ];
  return (
    <table className="table dre">
      <thead>
        <tr>
          <th>Resultado do período</th>
          <th className="num">Próprio</th>
          {hasChildren && <th className="num">Consolidado</th>}
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.key} className={l.strong ? 'dre-strong' : l.sub ? 'dre-sub' : undefined}>
            <td>{l.label}</td>
            <td className="num">{l.pct ? formatPercent(own[l.key]) : <Amount value={own[l.key]} />}</td>
            {hasChildren && <td className="num">{l.pct ? formatPercent(consolidated[l.key]) : <Amount value={consolidated[l.key]} />}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CostCenterPage({ id, period, canWrite }: { id: string; period: Period; canWrite: boolean }) {
  const detail = useLoad(() => getCostCenter(id, period), [id, period.from, period.to], 'Não foi possível carregar o centro de custo.');
  const entries = useLoad(() => listEntries(id, period), [id, period.from, period.to], 'Não foi possível carregar os lançamentos.');
  const purchases = useLoad(() => listPurchases(id), [id], 'Não foi possível carregar as compras.');
  const d = detail.data;

  if (detail.error && !d) {
    return (
      <>
        <PageHeader title="Centro de custo" back={{ href: withPeriod('/centros-de-custo', period), label: 'Centros de custo' }} />
        <ErrorAlert message={detail.error} onRetry={detail.reload} />
      </>
    );
  }
  if (!d) return <p className="muted">Carregando…</p>;

  const base = `/centros-de-custo/${encodeURIComponent(id)}`;
  const reloadAll = () => {
    detail.reload();
    entries.reload();
  };
  const totals = {
    realized: sumDecimals(d.costsByCategory.map((c) => c.realized)),
    committed: sumDecimals(d.costsByCategory.map((c) => c.committed)),
    budget: sumDecimals(d.costsByCategory.map((c) => c.budget)),
  };

  return (
    <>
      <PageHeader
        title={ccLabel(d)}
        back={{ href: withPeriod('/centros-de-custo', period), label: 'Centros de custo' }}
        actions={
          <>
            {d.kind === 'equipe_tecnica' && (
              <a className="btn btn-primary" href={`#${withPeriod(`/equipes/${encodeURIComponent(id)}`, period)}`}>
                Painel da equipe
              </a>
            )}
            <a className="btn btn-ghost" href={`#${base}/orcamento/${d.budget.year}`}>
              Orçamento {d.budget.year}
            </a>
          </>
        }
      >
        <p className="muted">
          {d.kind ? KIND_LABEL[d.kind] : 'Tipo não informado'} · {formatPeriodLabel(d.period ?? period)}
          {!d.active && ' · inativo no Axis Core'}
          {d.children.length > 0 && ` · consolidado inclui ${d.children.length} ${d.children.length === 1 ? 'centro filho' : 'centros filhos'}`}
        </p>
      </PageHeader>
      <PeriodPicker key={`${period.from}-${period.to}`} period={period} base={base} />
      {detail.error && <ErrorAlert message={detail.error} onRetry={detail.reload} />}

      <div className="cc-columns">
        <section className="card">
          <Dre own={d.own} consolidated={d.consolidated} hasChildren={d.children.length > 0} />
        </section>
        <section className="card">
          <h2>Orçamento de {d.budget.year}</h2>
          <dl className="kv kv-compact">
            <dt>Orçado no ano</dt>
            <dd>{formatBRL(d.budget.amount)}</dd>
            <dt>Consumido (realizado + comprometido)</dt>
            <dd>{formatBRL(d.budget.consumed)}</dd>
          </dl>
          <BudgetBar budget={d.budget} />
          <FieldLimit id={id} limit={d.settings.fieldDailyLimit} canWrite={canWrite} onSaved={(v) => detail.setData({ ...d, settings: { fieldDailyLimit: v } })} />
        </section>
      </div>

      <section className="card table-card table-scroll">
        <h2 className="card-pad">Custos por categoria × orçamento do período</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Categoria</th>
              <th className="num">Realizado</th>
              <th className="num">Comprometido</th>
              <th className="num">Orçamento</th>
            </tr>
          </thead>
          <tbody>
            {d.costsByCategory.length === 0 && (
              <tr>
                <td colSpan={4} className="muted empty">
                  Sem custos nem orçamento no período.
                </td>
              </tr>
            )}
            {d.costsByCategory.map((c) => (
              <tr key={c.category}>
                <td>{labelOf(CATEGORY_LABEL, c.category)}</td>
                <td className="num">{formatBRL(c.realized)}</td>
                <td className="num">{formatBRL(c.committed)}</td>
                <td className="num">{formatBRL(c.budget)}</td>
              </tr>
            ))}
          </tbody>
          {d.costsByCategory.length > 0 && (
            <tfoot>
              <tr className="total-row">
                <td>Total</td>
                <td className="num">{formatBRL(totals.realized)}</td>
                <td className="num">{formatBRL(totals.committed)}</td>
                <td className="num">{formatBRL(totals.budget)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>

      <section className="card table-card table-scroll">
        <h2 className="card-pad">Mês a mês</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Mês</th>
              <th className="num">Receita</th>
              <th className="num">Realizado</th>
              <th className="num">Comprometido</th>
              <th className="num">Orçamento</th>
            </tr>
          </thead>
          <tbody>
            {d.monthly.map((m) => (
              <tr key={m.month}>
                <td>{formatMonth(m.month)}</td>
                <td className="num">{formatBRL(m.revenue)}</td>
                <td className="num">{formatBRL(m.realized)}</td>
                <td className="num">{formatBRL(m.committed)}</td>
                <td className="num">{formatBRL(m.budget)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="cc-columns">
        <section className="card">
          <h2>Rateio recebido</h2>
          <SimpleAmounts rows={d.overhead.received} empty="Nenhum rateio recebido no período." period={period} />
        </section>
        <section className="card">
          <h2>Rateio cedido</h2>
          <SimpleAmounts rows={d.overhead.ceded} empty="Este centro não cede rateio." period={period} />
        </section>
      </div>

      <div className="cc-columns">
        <section className="card">
          <h2>Funil de compras</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Situação</th>
                <th className="num">Compras</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {d.funnel.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted empty">
                    Nenhuma compra no período.
                  </td>
                </tr>
              )}
              {d.funnel.map((f) => (
                <tr key={f.status}>
                  <td>{labelOf(FUNNEL_LABEL, f.status)}</td>
                  <td className="num">{f.count}</td>
                  <td className="num">{formatBRL(f.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <PurchaseList state={purchases} />
        </section>
        <section className="card">
          <h2>Receita contratada</h2>
          <p className="muted section-hint">Receita dos projetos deste centro no período.</p>
          <table className="table">
            <thead>
              <tr>
                <th>Projeto</th>
                <th className="num">Receita</th>
              </tr>
            </thead>
            <tbody>
              {d.contractedRevenue.length === 0 && (
                <tr>
                  <td colSpan={2} className="muted empty">
                    Nenhum projeto com receita no período.
                  </td>
                </tr>
              )}
              {d.contractedRevenue.map((p) => (
                <tr key={p.projectId}>
                  <td>
                    <a href={`#/projetos/${encodeURIComponent(p.projectId)}`}>{p.code ?? 'Projeto'}</a>
                    {p.name && <div className="cell-sub">{p.name}</div>}
                  </td>
                  <td className="num">{formatBRL(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <Entries id={id} state={entries} canWrite={canWrite} onChanged={reloadAll} detail={d} />
    </>
  );
}

function SimpleAmounts({ rows, empty, period }: { rows: { costCenterId: string; name: string | null; amount: string }[]; empty: string; period: Period }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <table className="table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.costCenterId}>
            <td>
              <a href={`#${withPeriod(`/centros-de-custo/${encodeURIComponent(r.costCenterId)}`, period)}`}>{r.name ?? 'Centro sem nome'}</a>
            </td>
            <td className="num">
              <Amount value={r.amount} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PurchaseList({ state }: { state: ReturnType<typeof useLoad<Awaited<ReturnType<typeof listPurchases>>>> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cc-subsection">
      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Esconder compras' : 'Ver compras do centro'}
      </button>
      {open && state.error && <ErrorAlert message={state.error} onRetry={state.reload} />}
      {open && state.loading && !state.data && <p className="muted">Carregando…</p>}
      {open && state.data && (
        <table className="table">
          <thead>
            <tr>
              <th>Requisição</th>
              <th>Situação</th>
              <th>Aprovada</th>
              <th>Recebida</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {state.data.length === 0 && (
              <tr>
                <td colSpan={5} className="muted empty">
                  Nenhuma compra registrada.
                </td>
              </tr>
            )}
            {state.data.map((p) => (
              <tr key={p.id}>
                <td>{p.code}</td>
                <td>{labelOf(FUNNEL_LABEL, p.status)}</td>
                <td className="nowrap">{formatDate(p.approvedAt)}</td>
                <td className="nowrap">{p.cancelledAt ? `cancelada em ${formatDate(p.cancelledAt)}` : formatDate(p.receivedAt)}</td>
                <td className="num">{formatBRL(p.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FieldLimit({ id, limit, canWrite, onSaved }: { id: string; limit: string | null; canWrite: boolean; onSaved: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(decimalToInput(limit));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = parseDecimal(value, 2);
    if (!parsed.ok) return setError(parsed.error);
    setBusy(true);
    setError(null);
    try {
      const r = await saveCostCenterSettings(id, parsed.value);
      onSaved(r?.fieldDailyLimit ?? parsed.value);
      setEditing(false);
    } catch (err) {
      setError(messageOf(err, 'Não foi possível salvar o limite.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cc-subsection">
      <h3>Limite de despesa de campo</h3>
      {!editing ? (
        <p>
          {limit ? `${formatBRL(limit)} por pessoa-dia` : <span className="muted">Sem limite definido.</span>}{' '}
          {canWrite && (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing(true)}>
              Alterar
            </button>
          )}
        </p>
      ) : (
        <form className="inline-form" onSubmit={save} noValidate>
          <Field label="R$ por pessoa-dia" hint="Vazio remove o limite." error={error ?? undefined}>
            <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} />
          </Field>
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setEditing(false)} disabled={busy}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Lançamentos

type EntryForm = { competence: string; kind: EntryKind; category: string; amount: string; description: string; projectId: string };
const EMPTY_ENTRY = (): EntryForm => ({ competence: today(), kind: 'custo', category: 'outros', amount: '', description: '', projectId: '' });

function Entries({ id, state, canWrite, onChanged, detail }: { id: string; state: ReturnType<typeof useLoad<Entry[]>>; canWrite: boolean; onChanged: () => void; detail: CcDetail }) {
  const [form, setForm] = useState<EntryForm | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof EntryForm | 'form', string>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [reversing, setReversing] = useState<{ id: string; reason: string; error: string | null } | null>(null);
  const known = detail.contractedRevenue.map((p) => ({ id: p.projectId, label: [p.code, p.name].filter(Boolean).join(' — ') || p.projectId }));
  const projects = useProjectOptions(known);

  const set = <K extends keyof EntryForm>(k: K, v: EntryForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const errs: typeof errors = {};
    if (!isDate(form.competence)) errs.competence = 'Informe a data de competência.';
    const amount = parseDecimal(form.amount, 2);
    if (!amount.ok) errs.amount = amount.error;
    else if (!amount.value || Number(amount.value) === 0) errs.amount = 'Informe um valor maior que zero.';
    if (!form.description.trim()) errs.description = 'Descreva o lançamento.';
    setErrors(errs);
    if (Object.keys(errs).length > 0 || !amount.ok || !amount.value) return;
    setBusy(true);
    try {
      await createEntry(id, {
        competence: form.competence,
        kind: form.kind,
        category: form.kind === 'receita' ? 'faturamento' : form.category,
        amount: amount.value,
        description: form.description.trim(),
        ...(form.projectId ? { projectId: form.projectId } : {}),
      });
      setForm(null);
      setNotice({ tone: 'success', text: 'Lançamento registrado.' });
      onChanged();
    } catch (err) {
      setErrors({ form: messageOf(err, 'Não foi possível registrar o lançamento.') });
    } finally {
      setBusy(false);
    }
  }

  async function reverse(e: FormEvent) {
    e.preventDefault();
    if (!reversing) return;
    if (!reversing.reason.trim()) return setReversing({ ...reversing, error: 'Informe o motivo do estorno.' });
    setBusy(true);
    try {
      await reverseEntry(reversing.id, reversing.reason.trim());
      setReversing(null);
      setNotice({ tone: 'success', text: 'Lançamento estornado.' });
      onChanged();
    } catch (err) {
      setReversing({ ...reversing, error: messageOf(err, 'Não foi possível estornar o lançamento.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card table-card">
      <div className="card-pad cc-section-head">
        <h2>Lançamentos do período</h2>
        {canWrite && !form && (
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setForm(EMPTY_ENTRY());
              setErrors({});
              setNotice(null);
            }}
          >
            Lançamento manual
          </button>
        )}
      </div>
      <div className="card-pad">
        <Notice notice={notice} />
        {form && (
          <form className="cc-form" onSubmit={submit} noValidate>
            <div className="grid-3">
              <Field label="Competência" required error={errors.competence}>
                <input type="date" value={form.competence} onChange={(e) => set('competence', e.target.value)} aria-invalid={!!errors.competence} />
              </Field>
              <Field label="Tipo" required>
                <select value={form.kind} onChange={(e) => set('kind', e.target.value as EntryKind)}>
                  <option value="custo">{ENTRY_KIND_LABEL.custo}</option>
                  <option value="receita">{ENTRY_KIND_LABEL.receita} (nota emitida)</option>
                </select>
              </Field>
              <Field label="Categoria" required>
                {form.kind === 'receita' ? (
                  <select value="faturamento" disabled>
                    <option value="faturamento">{CATEGORY_LABEL.faturamento}</option>
                  </select>
                ) : (
                  <select value={form.category} onChange={(e) => set('category', e.target.value)}>
                    {COST_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Valor (R$)" required error={errors.amount}>
                <input inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} aria-invalid={!!errors.amount} />
              </Field>
              <Field label="Projeto" hint={projects.error ? `Lista de projetos indisponível: ${projects.error}` : 'Opcional.'}>
                <select value={form.projectId} onChange={(e) => set('projectId', e.target.value)}>
                  <option value="">Sem projeto</option>
                  {projects.options.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Descrição" required error={errors.description}>
              <input value={form.description} maxLength={300} onChange={(e) => set('description', e.target.value)} aria-invalid={!!errors.description} />
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
                <th>Competência</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Etapa</th>
                <th>Origem</th>
                <th className="num">Valor</th>
                {canWrite && <th aria-label="Ações" />}
              </tr>
            </thead>
            <tbody>
              {state.data.length === 0 && (
                <tr>
                  <td colSpan={canWrite ? 7 : 6} className="muted empty">
                    Nenhum lançamento no período.
                  </td>
                </tr>
              )}
              {state.data.map((en) => {
                const canReverse = canWrite && en.source === 'manual' && !en.reversed && !en.reversesId;
                return (
                  <Fragment key={en.id}>
                    <tr className={en.reversed ? 'entry-reversed' : undefined}>
                      <td className="nowrap">{formatDate(en.competence)}</td>
                      <td>
                        {en.description}
                        <div className="cell-sub muted">
                          {en.projectCode && `${en.projectCode} · `}
                          {en.createdByName ?? 'Usuário do Axis'} em {formatDateTime(en.createdAt)}
                        </div>
                        {en.reversesId && <div className="cell-sub">Estorno{en.reason ? `: ${en.reason}` : ''}</div>}
                        {en.reversed && (
                          <div className="cell-sub">
                            <Badge tone="neutral">estornado</Badge>
                          </div>
                        )}
                      </td>
                      <td>
                        {ENTRY_KIND_LABEL[en.kind] ?? en.kind} · {labelOf(CATEGORY_LABEL, en.category)}
                      </td>
                      <td>{STAGE_LABEL[en.stage] ?? en.stage}</td>
                      <td>{SOURCE_LABEL[en.source] ?? en.source}</td>
                      <td className="num">
                        <Amount value={en.amount} />
                      </td>
                      {canWrite && (
                        <td>
                          {canReverse && (
                            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setReversing({ id: en.id, reason: '', error: null })} disabled={busy}>
                              Estornar
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                    {reversing?.id === en.id && (
                      <tr>
                        <td colSpan={7}>
                          <form className="inline-form" onSubmit={reverse} noValidate>
                            <Field label="Motivo do estorno" required error={reversing.error ?? undefined}>
                              <input autoFocus value={reversing.reason} maxLength={300} onChange={(e) => setReversing({ ...reversing, reason: e.target.value, error: null })} aria-invalid={!!reversing.error} />
                            </Field>
                            <div className="form-actions">
                              <button className="btn btn-primary" type="submit" disabled={busy}>
                                {busy ? 'Estornando…' : 'Confirmar estorno'}
                              </button>
                              <button className="btn btn-ghost" type="button" onClick={() => setReversing(null)} disabled={busy}>
                                Cancelar
                              </button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <p className="muted table-count">Lançamentos não se apagam: a correção é um estorno. Só lançamentos manuais podem ser estornados aqui.</p>
        </div>
      )}
    </section>
  );
}

// ================================================================ Orçamento (grade categoria × mês)

export function CostCenterBudgetPage({ id, year, canWrite }: { id: string; year: number; canWrite: boolean }) {
  const yearPeriod = { from: `${year}-01`, to: `${year}-12` };
  const cc = useLoad(() => getCostCenter(id, yearPeriod), [id, year], 'Não foi possível carregar o centro de custo.');
  const budget = useLoad(() => getBudget(id, year), [id, year], 'Não foi possível carregar o orçamento.');

  const back = { href: `/centros-de-custo/${encodeURIComponent(id)}`, label: cc.data ? ccLabel(cc.data) : 'Centro de custo' };
  if (budget.error && !budget.data) {
    return (
      <>
        <PageHeader title={`Orçamento ${year}`} back={back} />
        <ErrorAlert message={budget.error} onRetry={budget.reload} />
      </>
    );
  }
  if (!budget.data) return <p className="muted">Carregando…</p>;
  return <BudgetGridForm key={`${id}-${year}`} id={id} year={year} initial={budget.data.rows} canWrite={canWrite} back={back} ccName={cc.data ? ccLabel(cc.data) : null} ccError={cc.error} />;
}

const toCell = (v: string) => (v && Number(v) !== 0 ? decimalToInput(v) : '');

function BudgetGridForm({
  id,
  year,
  initial,
  canWrite,
  back,
  ccName,
  ccError,
}: {
  id: string;
  year: number;
  initial: { category: string; months: string[] }[];
  canWrite: boolean;
  back: { href: string; label: string };
  ccName: string | null;
  ccError: string | null;
}) {
  const start = useMemo(() => normalizeBudgetRows(initial).map((r) => ({ category: r.category, cells: r.months.map(toCell) })), [initial]);
  const [rows, setRows] = useState(start);
  const [saved, setSaved] = useState(() => JSON.stringify(start));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const dirty = JSON.stringify(rows) !== saved;
  useUnsavedWarning(dirty);

  const parsed = rows.map((r) => r.cells.map((c) => parseDecimal(c, 2)));
  const values = parsed.map((r) => r.map((p) => (p.ok ? (p.value ?? '0') : '0')));
  const invalid = parsed.some((r) => r.some((p) => !p.ok));
  const totals = budgetTotals(values);

  const setCell = (ri: number, mi: number, v: string) => setRows((prev) => prev.map((r, i) => (i === ri ? { ...r, cells: r.cells.map((c, j) => (j === mi ? v : c)) } : r)));

  function confirmLeave(e: MouseEvent<HTMLAnchorElement>) {
    if (dirty && !window.confirm('Há alterações não salvas no orçamento. Sair mesmo assim?')) e.preventDefault();
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (invalid) return setNotice({ tone: 'danger', text: 'Corrija os valores marcados antes de salvar.' });
    setBusy(true);
    setNotice(null);
    try {
      const r = await saveBudget(id, { year, rows: rows.map((row, i) => ({ category: row.category, months: values[i] })) });
      const next = normalizeBudgetRows(r?.rows ?? rows.map((row, i) => ({ category: row.category, months: values[i] }))).map((x) => ({ category: x.category, cells: x.months.map(toCell) }));
      setRows(next);
      setSaved(JSON.stringify(next));
      setNotice({ tone: 'success', text: 'Orçamento salvo.' });
    } catch (err) {
      setNotice({ tone: 'danger', text: messageOf(err, 'Não foi possível salvar o orçamento.') });
    } finally {
      setBusy(false);
    }
  }

  const editable = canWrite;
  return (
    <>
      <div className="page-header">
        <div>
          <a className="breadcrumb" href={`#${back.href}`} onClick={confirmLeave}>
            ← {back.label}
          </a>
          <h1>Orçamento {year}</h1>
          <p className="muted">{ccName ?? 'Centro de custo'} · custo orçado por categoria e mês (R$).</p>
        </div>
        <div className="page-actions">
          <a className="btn btn-ghost" href={`#/centros-de-custo/${encodeURIComponent(id)}/orcamento/${year - 1}`} onClick={confirmLeave}>
            ← {year - 1}
          </a>
          <a className="btn btn-ghost" href={`#/centros-de-custo/${encodeURIComponent(id)}/orcamento/${year + 1}`} onClick={confirmLeave}>
            {year + 1} →
          </a>
        </div>
      </div>
      {ccError && <ErrorAlert message={ccError} />}
      {dirty && (
        <p className="alert alert-warning" role="status">
          Há alterações não salvas.
        </p>
      )}
      <Notice notice={notice} />
      <form onSubmit={save} noValidate>
        <div className="card table-card table-scroll">
          <table className="table table-form budget-grid">
            <thead>
              <tr>
                <th>Categoria</th>
                {MONTH_LABELS.map((m) => (
                  <th key={m} className="num">
                    {m}
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={r.category}>
                  <th scope="row">{labelOf(CATEGORY_LABEL, r.category)}</th>
                  {r.cells.map((c, mi) => (
                    <td key={mi} className="num">
                      {editable ? (
                        <input
                          inputMode="decimal"
                          value={c}
                          placeholder="0"
                          onChange={(e) => setCell(ri, mi, e.target.value)}
                          aria-invalid={!parsed[ri][mi].ok}
                          aria-label={`${labelOf(CATEGORY_LABEL, r.category)} — ${MONTH_LABELS[mi]}`}
                          title={parsed[ri][mi].ok ? undefined : (parsed[ri][mi] as { error: string }).error}
                        />
                      ) : (
                        formatBRL(values[ri][mi])
                      )}
                    </td>
                  ))}
                  <td className="num total-cell">{formatBRL(totals.rowTotals[ri])}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="total-row">
                <th scope="row">Total</th>
                {totals.monthTotals.map((t, i) => (
                  <td key={i} className="num">
                    {formatBRL(t)}
                  </td>
                ))}
                <td className="num">{formatBRL(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {editable && (
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={busy || !dirty}>
              {busy ? 'Salvando…' : 'Salvar orçamento'}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy || !dirty}
              onClick={() => {
                setRows(JSON.parse(saved) as typeof rows);
                setNotice(null);
              }}
            >
              Descartar alterações
            </button>
          </div>
        )}
      </form>
    </>
  );
}
