import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  discardRevision,
  getRevision,
  newRevision,
  REVISION_STATUS,
  saveRevision,
  simulateRevision,
  useCurrentParameters,
  type BudgetInputs,
  type BudgetResult,
  type Revision,
} from '../lib/budgets';
import { listDestinations, listMaterials, type BudgetDestination, type BudgetMaterial } from '../lib/budgetParams';
import { decimalToInput, formatNumber, formatPercent, fractionToPercentInput, parseDecimal, parsePercent } from '../lib/decimal';
import { formatBRL, formatDateTime } from '../lib/format';
import { navigate } from '../lib/router';
import { Badge, ErrorAlert, Field, messageOf, PageHeader, useLoad, useUnsavedWarning } from '../components/ui';

// ---------------------------------------------------------------------------
// Formulário ↔ entradas da API
// ---------------------------------------------------------------------------

interface MaterialRow {
  uid: string;
  materialId: string | null;
  description: string;
  unit: string;
  quantity: string;
  billedUnitPrice: string;
  realUnitCost: string;
}

interface Form {
  workDays: string;
  team: Record<string, string>;
  materials: MaterialRow[];
  materialFreight: string;
  materialLossRate: string;
  travel: { destinationId: string; destinationName: string; kmRoundTrip: string; tollPerDay: string; cars: string; carRentalPerDay: string; parkingPerDay: string };
  platform: { days: string; dailyBilled: string; realCost: string };
  lodging: { people: string; nights: string; nightValue: string; realCost: string };
  meals: { people: string; days: string; dayValue: string; realCost: string };
  extraLabor: { overtimeCost: string; onboardingCost: string };
  otherCosts: { epi: string; tools: string; insurance: string; other: string; otherDescription: string };
  notes: string;
}

const d = decimalToInput;
const i = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
let uidSeq = 0;
const uid = () => `m${++uidSeq}`;

function toForm(rev: Revision): Form {
  const x = rev.inputs;
  const team: Record<string, string> = {};
  for (const r of rev.roles) {
    const t = x.team.find((t) => t.roleKey === r.roleKey);
    team[r.roleKey] = r.fieldRole ? i(t?.people) : d(t?.hours);
  }
  return {
    workDays: i(x.workDays),
    team,
    materials: x.materials.map((m) => ({ uid: uid(), materialId: m.materialId ?? null, description: m.description, unit: m.unit ?? 'un', quantity: d(m.quantity), billedUnitPrice: d(m.billedUnitPrice), realUnitCost: d(m.realUnitCost) })),
    materialFreight: d(x.materialFreight),
    materialLossRate: fractionToPercentInput(x.materialLossRate),
    travel: {
      destinationId: x.travel?.destinationId ?? '',
      destinationName: x.travel?.destinationName ?? '',
      kmRoundTrip: d(x.travel?.kmRoundTrip),
      tollPerDay: d(x.travel?.tollPerDay),
      cars: i(x.travel?.cars),
      carRentalPerDay: d(x.travel?.carRentalPerDay),
      parkingPerDay: d(x.travel?.parkingPerDay),
    },
    platform: { days: i(x.platform?.days), dailyBilled: d(x.platform?.dailyBilled), realCost: d(x.platform?.realCost) },
    lodging: { people: i(x.lodging?.people), nights: i(x.lodging?.nights), nightValue: d(x.lodging?.nightValue), realCost: d(x.lodging?.realCost) },
    meals: { people: i(x.meals?.people), days: i(x.meals?.days), dayValue: d(x.meals?.dayValue), realCost: d(x.meals?.realCost) },
    extraLabor: { overtimeCost: d(x.extraLabor?.overtimeCost), onboardingCost: d(x.extraLabor?.onboardingCost) },
    otherCosts: { epi: d(x.otherCosts?.epi), tools: d(x.otherCosts?.tools), insurance: d(x.otherCosts?.insurance), other: d(x.otherCosts?.other), otherDescription: x.otherCosts?.otherDescription ?? '' },
    notes: rev.notes ?? '',
  };
}

/** Converte o formulário em entradas da API; erros por caminho do campo. */
export function toInputs(form: Form, roles: Revision['roles'], costVisible: boolean): { inputs: BudgetInputs | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const num = (path: string, v: string, scale = 2) => {
    const p = parseDecimal(v, scale);
    if (!p.ok) errors[path] = p.error;
    return p.ok ? p.value : null;
  };
  const int = (path: string, v: string) => {
    const p = num(path, v, 0);
    return p === null ? null : Number(p);
  };
  const workDays = int('workDays', form.workDays) ?? 0;
  const team = roles.map((r) => (r.fieldRole ? { roleKey: r.roleKey, people: int(`team.${r.roleKey}`, form.team[r.roleKey] ?? '') ?? 0 } : { roleKey: r.roleKey, hours: num(`team.${r.roleKey}`, form.team[r.roleKey] ?? '') ?? '0' }));
  const materials = form.materials.map((m) => {
    if (!m.description.trim()) errors[`mat.${m.uid}.description`] = 'Informe a descrição.';
    const quantity = num(`mat.${m.uid}.quantity`, m.quantity, 4);
    if (quantity === null && !errors[`mat.${m.uid}.quantity`]) errors[`mat.${m.uid}.quantity`] = 'Informe a quantidade.';
    const price = num(`mat.${m.uid}.billedUnitPrice`, m.billedUnitPrice, 4);
    if (price === null && !errors[`mat.${m.uid}.billedUnitPrice`]) errors[`mat.${m.uid}.billedUnitPrice`] = 'Informe o preço.';
    return {
      materialId: m.materialId,
      description: m.description.trim(),
      unit: m.unit || 'un',
      quantity: quantity ?? '0',
      billedUnitPrice: price ?? '0',
      ...(costVisible ? { realUnitCost: num(`mat.${m.uid}.realUnitCost`, m.realUnitCost, 4) } : {}),
    };
  });
  const loss = parsePercent(form.materialLossRate);
  if (!loss.ok) errors.materialLossRate = loss.error;
  const t = form.travel;
  const inputs: BudgetInputs = {
    workDays,
    team,
    materials,
    materialFreight: num('materialFreight', form.materialFreight),
    materialLossRate: loss.ok ? loss.value : null,
    travel: {
      destinationId: t.destinationId || null,
      destinationName: t.destinationName || null,
      kmRoundTrip: num('travel.kmRoundTrip', t.kmRoundTrip),
      tollPerDay: num('travel.tollPerDay', t.tollPerDay),
      cars: int('travel.cars', t.cars),
      carRentalPerDay: num('travel.carRentalPerDay', t.carRentalPerDay),
      parkingPerDay: num('travel.parkingPerDay', t.parkingPerDay),
    },
    platform: { days: int('platform.days', form.platform.days), dailyBilled: num('platform.dailyBilled', form.platform.dailyBilled), realCost: num('platform.realCost', form.platform.realCost) },
    lodging: { people: int('lodging.people', form.lodging.people), nights: int('lodging.nights', form.lodging.nights), nightValue: num('lodging.nightValue', form.lodging.nightValue), realCost: num('lodging.realCost', form.lodging.realCost) },
    meals: { people: int('meals.people', form.meals.people), days: int('meals.days', form.meals.days), dayValue: num('meals.dayValue', form.meals.dayValue), realCost: num('meals.realCost', form.meals.realCost) },
    extraLabor: { overtimeCost: num('extraLabor.overtimeCost', form.extraLabor.overtimeCost), onboardingCost: num('extraLabor.onboardingCost', form.extraLabor.onboardingCost) },
    otherCosts: {
      epi: num('otherCosts.epi', form.otherCosts.epi),
      tools: num('otherCosts.tools', form.otherCosts.tools),
      insurance: num('otherCosts.insurance', form.otherCosts.insurance),
      other: num('otherCosts.other', form.otherCosts.other),
      otherDescription: form.otherCosts.otherDescription.trim() || null,
    },
  };
  return { inputs: Object.keys(errors).length ? null : inputs, errors };
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export function RevisionPage({ id, canWrite }: { id: string; canWrite: boolean }) {
  const { data: rev, setData, error, reload } = useLoad(() => getRevision(id), [id], 'Não foi possível carregar a revisão.');
  if (error) return <ErrorAlert message={error} onRetry={reload} />;
  if (!rev) return <p className="muted">Carregando…</p>;
  return <RevisionEditor key={`${rev.id}-${rev.updatedAt}-${rev.status}`} rev={rev} editable={canWrite && rev.status === 'rascunho'} canWrite={canWrite} onChange={setData} />;
}

function RevisionEditor({ rev, editable, canWrite, onChange }: { rev: Revision; editable: boolean; canWrite: boolean; onChange: (r: Revision) => void }) {
  const initial = useMemo(() => toForm(rev), [rev]);
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<BudgetResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const catalogs = useLoad(() => (editable ? Promise.all([listMaterials(), listDestinations()]) : Promise.resolve(null)), [editable], 'Não foi possível carregar os catálogos.');
  const [materials, destinations] = catalogs.data ?? [[], []];

  const dirty = JSON.stringify({ ...form, materials: form.materials.map(({ uid: _u, ...m }) => m) }) !== JSON.stringify({ ...initial, materials: initial.materials.map(({ uid: _u, ...m }) => m) });
  useUnsavedWarning(dirty && editable);

  // Resultado ao vivo: o servidor calcula as entradas ainda não salvas.
  const seq = useRef(0);
  useEffect(() => {
    if (!editable || !dirty) {
      setPreview(null);
      return;
    }
    const { inputs, errors: errs } = toInputs(form, rev.roles, rev.costVisible);
    setErrors(errs);
    if (!inputs) return;
    const mine = ++seq.current;
    const timer = window.setTimeout(() => {
      simulateRevision(rev.id, inputs)
        .then((r) => mine === seq.current && (setPreview(r), setSimError(null)))
        .catch((e: unknown) => mine === seq.current && setSimError(messageOf(e, 'Não foi possível recalcular.')));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [form, dirty, editable, rev.id, rev.roles, rev.costVisible]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setIn = <K extends 'travel' | 'platform' | 'lodging' | 'meals' | 'extraLabor' | 'otherCosts'>(k: K, field: keyof Form[K], v: string) => setForm((f) => ({ ...f, [k]: { ...f[k], [field]: v } }));
  const setMat = (u: string, patch: Partial<MaterialRow>) => setForm((f) => ({ ...f, materials: f.materials.map((m) => (m.uid === u ? { ...m, ...patch } : m)) }));

  function addMaterial(item?: BudgetMaterial) {
    const row: MaterialRow = item
      ? { uid: uid(), materialId: item.id, description: item.name, unit: item.unit, quantity: '1', billedUnitPrice: d(item.billedPrice), realUnitCost: d(item.realCost ?? null) }
      : { uid: uid(), materialId: null, description: '', unit: 'un', quantity: '1', billedUnitPrice: '', realUnitCost: '' };
    setForm((f) => ({ ...f, materials: [...f.materials, row] }));
  }

  function pickDestination(destId: string) {
    const dest: BudgetDestination | undefined = destinations.find((x) => x.id === destId);
    setForm((f) => ({
      ...f,
      travel: dest ? { ...f.travel, destinationId: dest.id, destinationName: dest.name, kmRoundTrip: d(dest.kmRoundTrip), tollPerDay: d(dest.tollPerDay) } : { ...f.travel, destinationId: '', destinationName: '' },
    }));
  }

  async function act(fn: () => Promise<Revision>, ok: string) {
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

  function save(e?: FormEvent) {
    e?.preventDefault();
    const { inputs, errors: errs } = toInputs(form, rev.roles, rev.costVisible);
    setErrors(errs);
    if (!inputs) {
      setMessage({ tone: 'danger', text: 'Corrija os campos destacados.' });
      return;
    }
    void act(() => saveRevision(rev.id, { inputs, notes: form.notes.trim() || null }), 'Revisão salva.');
  }

  async function createNext() {
    setBusy(true);
    try {
      const { revisionId } = await newRevision(rev.budget.id);
      navigate(`/revisoes/${revisionId}`);
    } catch (e) {
      setMessage({ tone: 'danger', text: messageOf(e, 'Não foi possível criar a revisão.') });
      setBusy(false);
    }
  }

  const result = preview ?? rev.result;
  const st = REVISION_STATUS[rev.status];
  const err = (k: string) => errors[k];
  const money = (label: string, path: string, value: string, onChangeValue: (v: string) => void, hint?: string) => (
    <Field label={label} error={err(path)} hint={hint}>
      <input inputMode="decimal" value={value} onChange={(e) => onChangeValue(e.target.value)} aria-invalid={!!err(path)} />
    </Field>
  );
  const paramsOutdated = rev.currentParameterSet && rev.currentParameterSet.id !== rev.parameterSet.id;

  return (
    <form onSubmit={save} noValidate>
      <PageHeader
        title={`${rev.code}`}
        back={{ href: `/projetos/${encodeURIComponent(rev.budget.axisProjectId)}`, label: rev.budget.title }}
        actions={
          canWrite && (
            <>
              {editable && (
                <button className="btn btn-primary" type="submit" disabled={busy || !dirty}>
                  {busy ? 'Salvando…' : 'Salvar'}
                </button>
              )}
              {editable && (
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => window.confirm(`Descartar a revisão R${rev.number}? Ela continua no histórico, mas não poderá mais ser editada.`) && void act(() => discardRevision(rev.id), `R${rev.number} descartada.`)}
                >
                  Descartar
                </button>
              )}
              {!editable && !rev.revisions.some((r) => r.status === 'rascunho') && (
                <button className="btn btn-primary" type="button" disabled={busy} onClick={createNext}>
                  Nova revisão
                </button>
              )}
            </>
          )
        }
      >
        <p className="muted">
          <Badge tone={st.tone}>{st.label}</Badge> {rev.project?.client?.name ?? ''} · parâmetros {rev.parameterSet.code} · alterada em {formatDateTime(rev.updatedAt)}
        </p>
      </PageHeader>

      {message && (
        <p className={`alert alert-${message.tone}`} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      {editable && paramsOutdated && (
        <p className="alert alert-warning">
          Esta revisão usa {rev.parameterSet.code}; o vigente é {rev.currentParameterSet!.code}.{' '}
          <button className="btn btn-ghost btn-sm" type="button" disabled={busy || dirty} onClick={() => void act(() => useCurrentParameters(rev.id), `Revisão recalculada com ${rev.currentParameterSet!.code}.`)}>
            Usar {rev.currentParameterSet!.code}
          </button>
          {dirty && <small> (salve antes)</small>}
        </p>
      )}
      {catalogs.error && <ErrorAlert message={catalogs.error} onRetry={catalogs.reload} />}

      <div className="revision-layout">
        <fieldset className="revision-form" disabled={!editable}>
          <Section title="Equipe e dias">
            <div className="grid-3">
              <Field label="Dias de trabalho" error={err('workDays')} hint="Iguais para toda a equipe de campo.">
                <input inputMode="numeric" value={form.workDays} onChange={(e) => set('workDays', e.target.value)} aria-invalid={!!err('workDays')} />
              </Field>
              {rev.roles.map((r) => (
                <Field
                  key={r.roleKey}
                  label={r.fieldRole ? `${r.label} (pessoas)` : `${r.label} (horas)`}
                  error={err(`team.${r.roleKey}`)}
                  hint={r.billingRate ? `${formatBRL(r.billingRate)}/h cobrado` : 'Sem valor hora nos parâmetros'}
                >
                  <input inputMode="decimal" value={form.team[r.roleKey] ?? ''} onChange={(e) => set('team', { ...form.team, [r.roleKey]: e.target.value })} aria-invalid={!!err(`team.${r.roleKey}`)} />
                </Field>
              ))}
            </div>
            {result && <p className="muted">Horas de campo: {formatNumber(result.fieldHours)} h</p>}
          </Section>

          <Section title="Material fornecido pela LGC" hint={`Markup dos parâmetros: ${formatPercent(rev.parameterSet.materialMarkup ?? '0')}`}>
            <div className="table-scroll">
              <table className="table table-form">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Unid.</th>
                    <th>Qtd</th>
                    <th>Preço cobrado (R$)</th>
                    {rev.costVisible && <th>Custo real (R$)</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {form.materials.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted empty">
                        Nenhum material.
                      </td>
                    </tr>
                  )}
                  {form.materials.map((m) => (
                    <tr key={m.uid}>
                      <td>
                        <input aria-label="Descrição" value={m.description} readOnly={!!m.materialId} onChange={(e) => setMat(m.uid, { description: e.target.value })} aria-invalid={!!err(`mat.${m.uid}.description`)} />
                        {m.materialId && <small className="muted">do catálogo</small>}
                      </td>
                      <td>
                        <input aria-label="Unidade" value={m.unit} onChange={(e) => setMat(m.uid, { unit: e.target.value })} />
                      </td>
                      <td>
                        <input aria-label="Quantidade" inputMode="decimal" value={m.quantity} onChange={(e) => setMat(m.uid, { quantity: e.target.value })} aria-invalid={!!err(`mat.${m.uid}.quantity`)} />
                        {err(`mat.${m.uid}.quantity`) && <small className="field-error">{err(`mat.${m.uid}.quantity`)}</small>}
                      </td>
                      <td>
                        <input aria-label="Preço cobrado" inputMode="decimal" value={m.billedUnitPrice} onChange={(e) => setMat(m.uid, { billedUnitPrice: e.target.value })} aria-invalid={!!err(`mat.${m.uid}.billedUnitPrice`)} />
                      </td>
                      {rev.costVisible && (
                        <td>
                          <input aria-label="Custo real" inputMode="decimal" placeholder="estimado" value={m.realUnitCost} onChange={(e) => setMat(m.uid, { realUnitCost: e.target.value })} aria-invalid={!!err(`mat.${m.uid}.realUnitCost`)} />
                        </td>
                      )}
                      <td>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => set('materials', form.materials.filter((x) => x.uid !== m.uid))}>
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {editable && (
              <div className="toolbar">
                <select aria-label="Adicionar do catálogo" value="" onChange={(e) => e.target.value && addMaterial(materials.find((x) => x.id === e.target.value))}>
                  <option value="">Adicionar do catálogo…</option>
                  {materials.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} — {formatBRL(x.billedPrice)}/{x.unit}
                    </option>
                  ))}
                </select>
                <button className="btn btn-ghost" type="button" onClick={() => addMaterial()}>
                  Item avulso
                </button>
              </div>
            )}
            <div className="grid-3">
              {money('Frete / retirada de material (R$)', 'materialFreight', form.materialFreight, (v) => set('materialFreight', v))}
              <Field label="Perdas e sobra (% do custo)" error={err('materialLossRate')}>
                <input inputMode="decimal" value={form.materialLossRate} onChange={(e) => set('materialLossRate', e.target.value)} aria-invalid={!!err('materialLossRate')} />
              </Field>
            </div>
          </Section>

          <Section title="Deslocamento" hint={`Cobrado: km × ${formatBRL(rev.parameterSet.kmRate)} + pedágio, por carro e dia de trabalho.`}>
            <div className="grid-3">
              <Field label="Destino">
                <select value={form.travel.destinationId} onChange={(e) => pickDestination(e.target.value)}>
                  <option value="">{form.travel.destinationName || 'Outro (digitar km e pedágio)'}</option>
                  {destinations.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </Field>
              {money('Km ida e volta', 'travel.kmRoundTrip', form.travel.kmRoundTrip, (v) => setIn('travel', 'kmRoundTrip', v))}
              {money('Pedágio por dia (R$)', 'travel.tollPerDay', form.travel.tollPerDay, (v) => setIn('travel', 'tollPerDay', v))}
              <Field label="Carros" error={err('travel.cars')}>
                <input inputMode="numeric" value={form.travel.cars} onChange={(e) => setIn('travel', 'cars', e.target.value)} aria-invalid={!!err('travel.cars')} />
              </Field>
              {money('Aluguel de carro por dia (R$, custo)', 'travel.carRentalPerDay', form.travel.carRentalPerDay, (v) => setIn('travel', 'carRentalPerDay', v), 'Só se o carro for alugado.')}
              {money('Estacionamento por dia (R$, custo)', 'travel.parkingPerDay', form.travel.parkingPerDay, (v) => setIn('travel', 'parkingPerDay', v))}
            </div>
          </Section>

          <Section title="Plataforma, hospedagem e alimentação">
            <div className="grid-3">
              <Field label="Dias de plataforma" error={err('platform.days')}>
                <input inputMode="numeric" value={form.platform.days} onChange={(e) => setIn('platform', 'days', e.target.value)} aria-invalid={!!err('platform.days')} />
              </Field>
              {money('Diária cobrada da plataforma (R$)', 'platform.dailyBilled', form.platform.dailyBilled, (v) => setIn('platform', 'dailyBilled', v))}
              {money('Custo real da plataforma (R$, total)', 'platform.realCost', form.platform.realCost, (v) => setIn('platform', 'realCost', v), 'Vazio: dias × diária real dos parâmetros + frete.')}
              <Field label="Hospedagem: pessoas" error={err('lodging.people')}>
                <input inputMode="numeric" value={form.lodging.people} onChange={(e) => setIn('lodging', 'people', e.target.value)} />
              </Field>
              <Field label="Hospedagem: noites" error={err('lodging.nights')}>
                <input inputMode="numeric" value={form.lodging.nights} onChange={(e) => setIn('lodging', 'nights', e.target.value)} />
              </Field>
              {money('Valor por noite (R$)', 'lodging.nightValue', form.lodging.nightValue, (v) => setIn('lodging', 'nightValue', v))}
              <Field label="Diária de alimentação: pessoas" error={err('meals.people')}>
                <input inputMode="numeric" value={form.meals.people} onChange={(e) => setIn('meals', 'people', e.target.value)} />
              </Field>
              <Field label="Diária de alimentação: dias" error={err('meals.days')}>
                <input inputMode="numeric" value={form.meals.days} onChange={(e) => setIn('meals', 'days', e.target.value)} />
              </Field>
              {money('Valor da diária (R$)', 'meals.dayValue', form.meals.dayValue, (v) => setIn('meals', 'dayValue', v))}
              {money('Custo real da hospedagem (R$, total)', 'lodging.realCost', form.lodging.realCost, (v) => setIn('lodging', 'realCost', v), 'Vazio: igual ao cobrado.')}
              {money('Custo real das diárias (R$, total)', 'meals.realCost', form.meals.realCost, (v) => setIn('meals', 'realCost', v), 'Vazio: igual ao cobrado.')}
            </div>
          </Section>

          <Section title="Custos não cobrados à parte">
            <div className="grid-3">
              {money('Horas extras / fim de semana previstos (R$)', 'extraLabor.overtimeCost', form.extraLabor.overtimeCost, (v) => setIn('extraLabor', 'overtimeCost', v))}
              {money('Credenciamento e integração do cliente (R$)', 'extraLabor.onboardingCost', form.extraLabor.onboardingCost, (v) => setIn('extraLabor', 'onboardingCost', v))}
              {money('EPI e uniformes (R$)', 'otherCosts.epi', form.otherCosts.epi, (v) => setIn('otherCosts', 'epi', v))}
              {money('Ferramentas e equipamentos (R$)', 'otherCosts.tools', form.otherCosts.tools, (v) => setIn('otherCosts', 'tools', v))}
              {money('Seguro e ART (R$)', 'otherCosts.insurance', form.otherCosts.insurance, (v) => setIn('otherCosts', 'insurance', v))}
              {money('Outros (R$)', 'otherCosts.other', form.otherCosts.other, (v) => setIn('otherCosts', 'other', v))}
              <Field label="Descrição de outros">
                <input value={form.otherCosts.otherDescription} maxLength={200} onChange={(e) => setIn('otherCosts', 'otherDescription', e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Observações">
            <textarea className="textarea" rows={3} maxLength={2000} value={form.notes} onChange={(e) => set('notes', e.target.value)} aria-label="Observações" />
          </Section>
        </fieldset>

        <aside className="revision-result">
          <ResultPanel result={result} costVisible={rev.costVisible} live={!!preview} error={simError} />
        </aside>
      </div>
    </form>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {hint && <p className="muted section-hint">{hint}</p>}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  PREJUIZO: { label: 'Prejuízo', tone: 'danger' },
  ABAIXO_DA_META: { label: 'Abaixo da meta', tone: 'warning' },
  META_ATINGIDA: { label: 'Meta atingida', tone: 'success' },
};

function Row({ label, value, strong, sub }: { label: string; value: string; strong?: boolean; sub?: boolean }) {
  return (
    <div className={`result-row${strong ? ' strong' : ''}${sub ? ' sub' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ResultPanel({ result, costVisible, live, error }: { result: BudgetResult | null; costVisible: boolean; live: boolean; error: string | null }) {
  if (!result) return <p className="card muted">Sem cálculo ainda.</p>;
  const r = result;
  const neg = (v?: string) => (v ? `− ${formatBRL(v)}` : '—');
  return (
    <>
      <section className="card">
        <h2>Proposta</h2>
        {live && <p className="muted section-hint">Prévia com as alterações não salvas.</p>}
        {error && <p className="alert alert-danger">{error}</p>}
        <Row label="Mão de obra" value={formatBRL(r.revenue.labor)} />
        <Row label="Material (com markup)" value={formatBRL(r.revenue.material)} />
        <Row label="Deslocamento" value={formatBRL(r.revenue.travel)} />
        <Row label="Plataforma" value={formatBRL(r.revenue.platform)} />
        <Row label="Hospedagem e alimentação" value={formatBRL(r.revenue.lodgingMeals)} />
        <Row label="Total da proposta" value={formatBRL(r.revenue.total)} strong />
      </section>

      {costVisible && r.result && r.directCosts && r.indirect && r.taxes && r.pricing && (
        <>
          <section className="card">
            <h2>
              Resultado <Badge tone={STATUS[r.result.status].tone}>{STATUS[r.result.status].label}</Badge>
            </h2>
            <Row label="Receita bruta" value={formatBRL(r.revenue.total)} />
            <Row label={`Impostos (${r.taxes.rate ? formatPercent(r.taxes.rate) : '—'})`} value={neg(r.taxes.amount)} />
            <Row label="Mão de obra" value={neg(r.directCosts.labor)} />
            <Row label="Material" value={neg(r.directCosts.material)} />
            <Row label="Deslocamento" value={neg(r.directCosts.travel)} />
            <Row label="Plataforma" value={neg(r.directCosts.platform)} />
            <Row label="Hospedagem e alimentação" value={neg(r.directCosts.lodgingMeals)} />
            <Row label="Outros custos" value={neg(r.directCosts.other)} />
            <Row label="Margem de contribuição" value={formatBRL(r.result.contributionMargin)} strong />
            <Row label="Indiretos e risco" value={neg(r.indirect.total)} />
            <Row label="Contingência" value={formatBRL(r.indirect.contingency)} sub />
            <Row label="Rateio de despesas fixas" value={formatBRL(r.indirect.overhead)} sub />
            <Row label="Comissão" value={formatBRL(r.indirect.commission)} sub />
            <Row label="Custo financeiro" value={formatBRL(r.indirect.financial)} sub />
            <Row label="Lucro real" value={formatBRL(r.result.profit)} strong />
            <Row label="Lucro sobre o custo" value={`${r.result.profitOnCost ? formatPercent(r.result.profitOnCost) : '—'} (meta ${r.result.target ? formatPercent(r.result.target) : '—'})`} strong />
            <Row label="Margem sobre a receita" value={r.result.margin ? formatPercent(r.result.margin) : '—'} />
            <Row label="Lucro por dia de obra" value={formatBRL(r.result.profitPerDay)} />
            <Row label="Lucro por hora de campo" value={formatBRL(r.result.profitPerFieldHour)} />
          </section>

          <section className="card">
            <h2>Preço</h2>
            <Row label="Preço mínimo (lucro zero)" value={formatBRL(r.pricing.minimumPrice)} />
            <Row label="Preço para atingir a meta" value={formatBRL(r.pricing.targetPrice)} strong />
            <Row label="Falta para a meta" value={formatBRL(r.pricing.gapToTarget)} />
            {r.pricing.hourRatesForTarget.map((h) => (
              <Row key={h.roleKey} label={`Valor hora ${h.label.toLowerCase()} para a meta`} value={`${formatBRL(h.needed)} (hoje ${formatBRL(h.current)})`} sub />
            ))}
          </section>

          {r.groups && (
            <section className="card">
              <h2>Onde está o lucro</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Grupo</th>
                    <th className="num">Cobrado</th>
                    <th className="num">Custo</th>
                    <th className="num">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {r.groups.map((g) => (
                    <tr key={g.key}>
                      <td>{g.label}</td>
                      <td className="num">{formatBRL(g.billed)}</td>
                      <td className="num">{formatBRL(g.cost)}</td>
                      <td className={`num${Number(g.result) < 0 ? ' negative' : ''}`}>{formatBRL(g.result)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {r.warnings.length > 0 && (
        <section className="card">
          <h2>Avisos</h2>
          <ul className="warnings">
            {r.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
