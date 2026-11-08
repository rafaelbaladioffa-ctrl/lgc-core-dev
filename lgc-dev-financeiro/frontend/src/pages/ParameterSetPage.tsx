import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  getParameterSchema,
  getParameterSet,
  publishParameterSet,
  STATUS_LABEL,
  updateParameterSet,
  type FieldDef,
  type ParameterRole,
  type ParameterSchema,
  type ParameterSet,
} from '../lib/budgetParams';
import { decimalToInput, formatNumber, formatPercent, fractionToPercentInput, parseDecimal, parsePercent } from '../lib/decimal';
import { formatBRL, formatDate, formatDateTime } from '../lib/format';
import { Badge, ErrorAlert, Field, messageOf, PageHeader, useLoad, useUnsavedWarning } from '../components/ui';

type Value = string | boolean | null;

const PAYROLL_SCALE: Record<string, number> = { plrSalariesPerYear: 4, costPerHourOverride: 4 };

interface RoleRow {
  uid: string;
  roleKey: string;
  label: string;
  fieldRole: boolean;
  values: Record<string, string>; // billingRate + campos de folha, como digitados
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'funcao';

function toInput(field: FieldDef, v: unknown): Value {
  if (field.kind === 'bool') return typeof v === 'boolean' ? v : null;
  if (v === null || v === undefined) return '';
  if (field.kind === 'rate') return fractionToPercentInput(v as string);
  if (field.kind === 'int') return String(v);
  return decimalToInput(v as string);
}

function display(field: FieldDef, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (field.kind === 'bool') return v ? 'Sim' : 'Não';
  if (field.kind === 'rate') return formatPercent(v as string);
  if (field.kind === 'money') return formatBRL(v as string);
  return formatNumber(v as string);
}

function rolesToRows(roles: ParameterRole[], payrollFields: string[]): RoleRow[] {
  return roles.map((r) => ({
    uid: r.id ?? r.roleKey,
    roleKey: r.roleKey,
    label: r.label,
    fieldRole: r.fieldRole,
    values: Object.fromEntries(['billingRate', ...payrollFields].map((k) => [k, decimalToInput((r as unknown as Record<string, string | null>)[k])])),
  }));
}

export function ParameterSetPage({ id, canWrite }: { id: string; canWrite: boolean }) {
  const schemaLoad = useLoad(getParameterSchema, [], 'Não foi possível carregar o formulário de parâmetros.');
  const setLoad = useLoad(() => getParameterSet(id), [id], 'Não foi possível carregar o conjunto de parâmetros.');
  const schema = schemaLoad.data;
  const set = setLoad.data;

  if (schemaLoad.error || setLoad.error) {
    return (
      <>
        <PageHeader title="Parâmetros" back={{ href: '/parametros', label: 'Parâmetros' }} />
        <ErrorAlert
          message={(schemaLoad.error ?? setLoad.error)!}
          onRetry={() => {
            schemaLoad.reload();
            setLoad.reload();
          }}
        />
      </>
    );
  }
  if (!schema || !set) return <p className="muted">Carregando…</p>;

  const editable = canWrite && set.status === 'rascunho';
  return editable ? <ParameterSetForm schema={schema} set={set} onSaved={setLoad.setData} /> : <ParameterSetView schema={schema} set={set} />;
}

function Header({ set }: { set: ParameterSet }) {
  const tone = set.status === 'vigente' ? 'success' : set.status === 'rascunho' ? 'warning' : 'neutral';
  return (
    <PageHeader title={`Parâmetros ${set.code}`} back={{ href: '/parametros', label: 'Parâmetros' }}>
      <p className="muted">
        <Badge tone={tone}>{STATUS_LABEL[set.status]}</Badge> {set.effectiveFrom ? `Vigência a partir de ${formatDate(set.effectiveFrom)}` : 'Sem vigência definida'}
        {set.publishedAt ? ` · publicado em ${formatDateTime(set.publishedAt)}` : ''}
      </p>
    </PageHeader>
  );
}

function Derived({ set, stale }: { set: ParameterSet; stale?: boolean }) {
  return (
    <section className="card">
      <h2>Resultados</h2>
      {stale && <p className="alert alert-warning">Há alterações não salvas: salve para recalcular.</p>}
      <dl className="kv">
        <dt>Alíquota total sobre a nota</dt>
        <dd>{set.derived.invoiceTaxRate ? formatPercent(set.derived.invoiceTaxRate) : 'faltam percentuais de imposto'}</dd>
        <dt>Diária real da plataforma</dt>
        <dd>{set.derived.platformDailyCost ? formatBRL(set.derived.platformDailyCost) : '—'}</dd>
      </dl>
      {set.payrollVisible ? <HourlyCosts roles={set.roles} /> : <p className="muted">O custo hora da equipe só aparece para quem tem acesso à folha.</p>}
    </section>
  );
}

const ANNUAL_LABELS: Array<[string, string]> = [
  ['salaries', '12 salários'],
  ['thirteenth', '13º salário'],
  ['vacationThird', '1/3 de férias'],
  ['employerCharges', 'INSS + RAT + terceiros'],
  ['fgts', 'FGTS + provisão de multa'],
  ['plr', 'PLR'],
  ['meal', 'Vale-refeição'],
  ['transport', 'Vale-transporte'],
  ['fixedBenefits', 'Saúde, academia e outros'],
  ['total', 'Custo anual total'],
  ['monthlyAverage', 'Custo mensal médio'],
];

function HourlyCosts({ roles }: { roles: ParameterRole[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Função</th>
          <th className="num">Custo por hora trabalhada</th>
          <th className="num">Valor hora cobrado</th>
          <th className="num">Markup da hora</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {roles.map((r) => {
          const hc = r.hourlyCost;
          const key = r.id ?? r.roleKey;
          return (
            <Fragment key={key}>
              <tr>
                <td>{r.label}</td>
                {hc?.ok ? (
                  <>
                    <td className="num">
                      {formatBRL(hc.value.costPerHour)}
                      {hc.value.source === 'informado' && <small className="muted"> (informado)</small>}
                    </td>
                    <td className="num">{formatBRL(hc.value.billingRate)}</td>
                    <td className="num">{hc.value.hourMarkup ? formatPercent(hc.value.hourMarkup) : '—'}</td>
                    <td>
                      {hc.value.annual && (
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
                          {open === key ? 'Ocultar' : 'Composição'}
                        </button>
                      )}
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className="muted">
                    Falta: {hc?.missing.join(', ') ?? '—'}
                  </td>
                )}
              </tr>
              {open === key && hc?.ok && hc.value.annual && (
                <tr>
                  <td colSpan={5}>
                    <dl className="kv kv-compact">
                      {ANNUAL_LABELS.map(([k, label]) => (
                        <Fragment key={k}>
                          <dt>{label}</dt>
                          <dd>{formatBRL(hc.value.annual![k as keyof typeof hc.value.annual])}</dd>
                        </Fragment>
                      ))}
                      <dt>Horas trabalhadas no ano</dt>
                      <dd>
                        {formatNumber(hc.value.workedHours)} h ({hc.value.workedDays} dias)
                      </dd>
                    </dl>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function ParameterSetView({ schema, set }: { schema: ParameterSchema; set: ParameterSet }) {
  const payrollFields = set.payrollVisible ? schema.payrollFields : [];
  return (
    <>
      <Header set={set} />
      {set.status === 'rascunho' && <p className="alert alert-warning">Rascunho em preparação. Só quem mantém parâmetros pode editá-lo e publicá-lo.</p>}
      {set.notes && <p className="card">{set.notes}</p>}
      <Derived set={set} />
      {schema.groups.map((g) => (
        <section className="card" key={g.key}>
          <h2>{g.label}</h2>
          <dl className="kv">
            {g.fields.map((f) => (
              <Fragment key={f.key}>
                <dt>{f.label}</dt>
                <dd>{display(f, set[f.key])}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
      <section className="card">
        <h2>Funções da equipe</h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Função</th>
                <th>Campo</th>
                {['billingRate', ...payrollFields].map((k) => (
                  <th key={k} className="num">
                    {schema.roleFields[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {set.roles.map((r) => (
                <tr key={r.id ?? r.roleKey}>
                  <td>{r.label}</td>
                  <td>{r.fieldRole ? 'Sim' : 'Não'}</td>
                  {['billingRate', ...payrollFields].map((k) => {
                    const v = (r as unknown as Record<string, string | null>)[k];
                    return (
                      <td key={k} className="num">
                        {k === 'plrSalariesPerYear' ? formatNumber(v) : formatBRL(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ParameterSetForm({ schema, set, onSaved }: { schema: ParameterSchema; set: ParameterSet; onSaved: (s: ParameterSet) => void }) {
  const payrollFields = set.payrollVisible ? schema.payrollFields : [];
  const fields = useMemo(() => schema.groups.flatMap((g) => g.fields), [schema]);
  const initial = useMemo(
    () => ({
      values: Object.fromEntries(fields.map((f) => [f.key, toInput(f, set[f.key])])) as Record<string, Value>,
      effectiveFrom: set.effectiveFrom ?? '',
      notes: set.notes ?? '',
      roles: rolesToRows(set.roles, payrollFields),
    }),
    // Recomeça o formulário a cada versão salva do conjunto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [set],
  );
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  useEffect(() => setForm(initial), [initial]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useUnsavedWarning(dirty);

  const setValue = (key: string, v: Value) => setForm((f) => ({ ...f, values: { ...f.values, [key]: v } }));
  const setRole = (uid: string, patch: Partial<RoleRow> | { value: [string, string] }) =>
    setForm((f) => ({
      ...f,
      roles: f.roles.map((r) => (r.uid !== uid ? r : 'value' in patch ? { ...r, values: { ...r.values, [patch.value[0]]: patch.value[1] } } : { ...r, ...patch })),
    }));

  function addRole() {
    const uid = `novo-${Date.now()}`;
    setForm((f) => ({ ...f, roles: [...f.roles, { uid, roleKey: '', label: '', fieldRole: true, values: Object.fromEntries(['billingRate', ...payrollFields].map((k) => [k, ''])) }] }));
  }

  function buildPayload(): Record<string, unknown> | null {
    const errs: Record<string, string> = {};
    const body: Record<string, unknown> = { effectiveFrom: form.effectiveFrom || null, notes: form.notes.trim() || null };
    for (const f of fields) {
      const raw = form.values[f.key];
      if (f.kind === 'bool') {
        body[f.key] = raw;
        continue;
      }
      const parsed = f.kind === 'rate' ? parsePercent(String(raw ?? ''), f.scale ?? 6) : parseDecimal(String(raw ?? ''), f.kind === 'int' ? 0 : (f.scale ?? 2));
      if (!parsed.ok) errs[f.key] = parsed.error;
      else body[f.key] = f.kind === 'int' && parsed.value !== null ? Number(parsed.value) : parsed.value;
    }
    const used = new Set<string>();
    body.roles = form.roles.map((r, i) => {
      if (r.label.trim().length < 2) errs[`role.${r.uid}.label`] = 'Informe o nome da função.';
      let roleKey = r.roleKey || slug(r.label);
      while (used.has(roleKey)) roleKey = `${roleKey}_${i + 1}`;
      used.add(roleKey);
      const out: Record<string, unknown> = { roleKey, label: r.label.trim(), fieldRole: r.fieldRole, sortOrder: i + 1 };
      for (const k of ['billingRate', ...payrollFields]) {
        const parsed = parseDecimal(r.values[k] ?? '', PAYROLL_SCALE[k] ?? 2);
        if (!parsed.ok) errs[`role.${r.uid}.${k}`] = parsed.error;
        else out[k] = parsed.value;
      }
      return out;
    });
    setErrors(errs);
    return Object.keys(errs).length ? null : body;
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setMessage(null);
    const body = buildPayload();
    if (!body) {
      setMessage({ tone: 'danger', text: 'Corrija os campos destacados.' });
      return;
    }
    setSaving(true);
    try {
      onSaved(await updateParameterSet(set.id, body));
      setMessage({ tone: 'success', text: 'Rascunho salvo.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: messageOf(err, 'Não foi possível salvar o rascunho.') });
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!window.confirm(`Publicar ${set.code}? Ele passa a ser o conjunto vigente, substitui o atual e não poderá mais ser alterado.`)) return;
    setMessage(null);
    setSaving(true);
    try {
      onSaved(await publishParameterSet(set.id, form.effectiveFrom || undefined));
      setMessage({ tone: 'success', text: `${set.code} publicado.` });
    } catch (err) {
      setMessage({ tone: 'danger', text: messageOf(err, 'Não foi possível publicar.') });
    } finally {
      setSaving(false);
    }
  }

  const issues = set.publishIssues;
  return (
    <form onSubmit={save} noValidate>
      <Header set={set} />
      {message && (
        <p className={`alert alert-${message.tone}`} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      <section className="card">
        <h2>Vigência</h2>
        <div className="grid-2">
          <Field label="Início da vigência" hint="Em branco: a data da publicação.">
            <input type="date" value={form.effectiveFrom} onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))} />
          </Field>
          <Field label="Observações">
            <input value={form.notes} maxLength={1000} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Ex.: reajuste do dissídio" />
          </Field>
        </div>
      </section>

      {schema.groups.map((g) => (
        <section className="card" key={g.key}>
          <h2>{g.label}</h2>
          <div className="grid-3">
            {g.fields.map((f) => (
              <Field key={f.key} label={f.kind === 'rate' ? `${f.label} (%)` : f.label} hint={f.hint} error={errors[f.key]} required={f.required}>
                {f.kind === 'bool' ? (
                  <select value={form.values[f.key] === null ? '' : String(form.values[f.key])} onChange={(e) => setValue(f.key, e.target.value === '' ? null : e.target.value === 'true')}>
                    <option value="">—</option>
                    <option value="true">Sim</option>
                    <option value="false">Não</option>
                  </select>
                ) : (
                  <input inputMode="decimal" value={String(form.values[f.key] ?? '')} onChange={(e) => setValue(f.key, e.target.value)} aria-invalid={!!errors[f.key]} />
                )}
              </Field>
            ))}
          </div>
        </section>
      ))}

      <section className="card">
        <h2>Funções da equipe</h2>
        {!set.payrollVisible && <p className="muted">Salários e benefícios não aparecem para o seu perfil; os valores já cadastrados são mantidos.</p>}
        <div className="table-scroll">
          <table className="table table-form">
            <thead>
              <tr>
                <th>Função</th>
                <th>Campo</th>
                {['billingRate', ...payrollFields].map((k) => (
                  <th key={k}>{schema.roleFields[k]}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {form.roles.map((r) => (
                <tr key={r.uid}>
                  <td>
                    <input aria-label="Nome da função" value={r.label} onChange={(e) => setRole(r.uid, { label: e.target.value })} aria-invalid={!!errors[`role.${r.uid}.label`]} />
                    {errors[`role.${r.uid}.label`] && <small className="field-error">{errors[`role.${r.uid}.label`]}</small>}
                  </td>
                  <td>
                    <input type="checkbox" aria-label="Trabalha em campo" checked={r.fieldRole} onChange={(e) => setRole(r.uid, { fieldRole: e.target.checked })} />
                  </td>
                  {['billingRate', ...payrollFields].map((k) => (
                    <td key={k}>
                      <input inputMode="decimal" aria-label={`${schema.roleFields[k]} — ${r.label}`} value={r.values[k] ?? ''} onChange={(e) => setRole(r.uid, { value: [k, e.target.value] })} aria-invalid={!!errors[`role.${r.uid}.${k}`]} />
                      {errors[`role.${r.uid}.${k}`] && <small className="field-error">{errors[`role.${r.uid}.${k}`]}</small>}
                    </td>
                  ))}
                  <td>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => setForm((f) => ({ ...f, roles: f.roles.filter((x) => x.uid !== r.uid) }))}>
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn btn-ghost" type="button" onClick={addRole}>
          Adicionar função
        </button>
      </section>

      <Derived set={set} stale={dirty} />

      {issues && (issues.missing.length > 0 || issues.incompleteRoles.length > 0) && (
        <section className="card">
          <h2>Antes de publicar</h2>
          <ul>
            {issues.missing.map((m) => (
              <li key={m}>Falta: {m}</li>
            ))}
            {issues.incompleteRoles.map((r) => (
              <li key={r} className="muted">
                Função incompleta (não poderá ser usada em orçamento): {r}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={saving || !dirty}>
          {saving ? 'Salvando…' : 'Salvar rascunho'}
        </button>
        <button className="btn btn-ghost" type="button" onClick={publish} disabled={saving || dirty || (issues?.missing.length ?? 0) > 0} title={dirty ? 'Salve antes de publicar.' : undefined}>
          Publicar
        </button>
      </div>
    </form>
  );
}
