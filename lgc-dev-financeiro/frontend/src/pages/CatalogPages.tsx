import { useEffect, useState, type FormEvent } from 'react';
import { getDestination, getMaterial, listDestinations, listMaterials, saveDestination, saveMaterial, siteLabel, type BudgetDestination, type BudgetMaterial } from '../lib/budgetParams';
import type { MasterItem } from '../lib/masterData';
import { CoreMasterPicker } from '../components/CoreMasterPicker';
import { decimalToInput, formatNumber, parseDecimal } from '../lib/decimal';
import { formatBRL } from '../lib/format';
import { navigate } from '../lib/router';
import { Badge, ErrorAlert, Field, messageOf, PageHeader, useLoad, useUnsavedWarning } from '../components/ui';

function InactiveToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> Mostrar inativos
    </label>
  );
}

// ---------------------------------------------------------------------------
// Materiais
// ---------------------------------------------------------------------------

export function MaterialsPage({ canWrite, canSeeCost }: { canWrite: boolean; canSeeCost: boolean }) {
  const [inactive, setInactive] = useState(false);
  const [search, setSearch] = useState('');
  const { data, error, loading, reload } = useLoad(() => listMaterials(inactive), [inactive], 'Não foi possível carregar o catálogo de materiais.');
  const q = search.trim().toLowerCase();
  const rows = (data ?? []).filter((m) => !q || [m.name, m.manufacturer, m.partNumber, m.clientRef].some((v) => v?.toLowerCase().includes(q)));

  return (
    <>
      <PageHeader
        title="Catálogo de materiais"
        actions={
          canWrite && (
            <a className="btn btn-primary" href="#/materiais/novo">
              Novo item
            </a>
          )
        }
      >
        <p className="muted">Materiais fornecidos pela LGC e cobrados à parte. O orçamento copia preço e custo no momento do uso.</p>
      </PageHeader>
      <div className="toolbar">
        <input type="search" placeholder="Buscar por nome, fabricante ou código" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar material" />
        <InactiveToggle value={inactive} onChange={setInactive} />
      </div>
      {error && <ErrorAlert message={error} onRetry={reload} />}
      {loading && !data && <p className="muted">Carregando…</p>}
      {data && (
        <div className="card table-card table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Fabricante</th>
                <th>Código</th>
                <th>Unid.</th>
                <th className="num">Preço cobrado</th>
                {canSeeCost && <th className="num">Custo real</th>}
                <th>Ref. no cliente</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted empty">
                    {data.length === 0 ? 'Nenhum material cadastrado.' : 'Nenhum material encontrado.'}
                  </td>
                </tr>
              )}
              {rows.map((m) => (
                <tr key={m.id} className={canWrite ? 'row-link' : undefined} onClick={canWrite ? () => navigate(`/materiais/${m.id}`) : undefined}>
                  <td>{canWrite ? <a href={`#/materiais/${m.id}`}>{m.name}</a> : m.name}</td>
                  <td>{m.manufacturer ?? '—'}</td>
                  <td>{m.partNumber ?? '—'}</td>
                  <td>{m.unit}</td>
                  <td className="num">{formatBRL(m.billedPrice)}</td>
                  {canSeeCost && <td className="num">{m.realCost ? formatBRL(m.realCost) : <span className="muted">não informado</span>}</td>}
                  <td>{m.clientRef ?? '—'}</td>
                  <td>{m.active ? <Badge tone="success">Ativo</Badge> : <Badge tone="neutral">Inativo</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted table-count">{rows.length} de {data.length} itens</p>
        </div>
      )}
    </>
  );
}

const EMPTY_MATERIAL = { name: '', manufacturer: '', partNumber: '', unit: 'un', billedPrice: '', realCost: '', clientRef: '', active: true };
type MaterialForm = typeof EMPTY_MATERIAL;

function materialToForm(m: BudgetMaterial): MaterialForm {
  return {
    name: m.name,
    manufacturer: m.manufacturer ?? '',
    partNumber: m.partNumber ?? '',
    unit: m.unit,
    billedPrice: decimalToInput(m.billedPrice),
    realCost: decimalToInput(m.realCost ?? null),
    clientRef: m.clientRef ?? '',
    active: m.active,
  };
}

export function MaterialFormPage({ id, canSeeCost }: { id: string | null; canSeeCost: boolean }) {
  const loaded = useLoad(() => (id ? getMaterial(id) : Promise.resolve(null)), [id], 'Não foi possível carregar o item.');
  const initial = loaded.data ? materialToForm(loaded.data) : EMPTY_MATERIAL;
  const [form, setForm] = useState<MaterialForm>(EMPTY_MATERIAL);
  const [errors, setErrors] = useState<Partial<Record<keyof MaterialForm, string>>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => setForm(loaded.data ? materialToForm(loaded.data) : EMPTY_MATERIAL), [loaded.data]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useUnsavedWarning(dirty && !saving);
  const set = (k: keyof MaterialForm, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (form.name.trim().length < 2) errs.name = 'Informe o nome do item (mínimo 2 caracteres).';
    const price = parseDecimal(form.billedPrice, 4);
    if (!price.ok) errs.billedPrice = price.error;
    else if (price.value === null) errs.billedPrice = 'Informe o preço cobrado.';
    const cost = parseDecimal(form.realCost, 4);
    if (!cost.ok) errs.realCost = cost.error;
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      manufacturer: form.manufacturer.trim() || null,
      partNumber: form.partNumber.trim() || null,
      unit: form.unit.trim() || 'un',
      billedPrice: price.ok ? price.value : null,
      clientRef: form.clientRef.trim() || null,
      active: form.active,
    };
    if (canSeeCost) body.realCost = cost.ok ? cost.value : null;
    setSaving(true);
    setFormError(null);
    try {
      await saveMaterial(id, body);
      navigate('/materiais');
    } catch (err) {
      setFormError(messageOf(err, 'Não foi possível salvar o item.'));
      setSaving(false);
    }
  }

  if (loaded.error) return <ErrorAlert message={loaded.error} onRetry={loaded.reload} />;
  if (id && !loaded.data) return <p className="muted">Carregando…</p>;

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader title={id ? `Editar ${loaded.data?.name ?? 'item'}` : 'Novo item de material'} back={{ href: '/materiais', label: 'Catálogo de materiais' }} />
      {formError && <ErrorAlert message={formError} />}
      <section className="card">
        <div className="grid-2">
          <Field label="Item" required error={errors.name}>
            <input value={form.name} maxLength={120} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} autoFocus />
          </Field>
          <Field label="Fabricante">
            <input value={form.manufacturer} maxLength={80} onChange={(e) => set('manufacturer', e.target.value)} />
          </Field>
          <Field label="Código do fabricante" hint="Gravado em maiúsculas.">
            <input value={form.partNumber} maxLength={80} onChange={(e) => set('partNumber', e.target.value)} />
          </Field>
          <Field label="Unidade" hint="Ex.: un, m, cx.">
            <input value={form.unit} maxLength={10} onChange={(e) => set('unit', e.target.value)} />
          </Field>
          <Field label="Preço cobrado do cliente (R$)" required error={errors.billedPrice} hint="Sem markup; o markup vem dos parâmetros.">
            <input inputMode="decimal" value={form.billedPrice} onChange={(e) => set('billedPrice', e.target.value)} aria-invalid={!!errors.billedPrice} />
          </Field>
          {canSeeCost && (
            <Field label="Custo real pago pela LGC (R$)" error={errors.realCost} hint="Vazio: o orçamento usa o preço cobrado e marca como custo estimado.">
              <input inputMode="decimal" value={form.realCost} onChange={(e) => set('realCost', e.target.value)} aria-invalid={!!errors.realCost} />
            </Field>
          )}
          <Field label="Referência no formulário do cliente" hint="Ex.: linha da planilha de proposta do cliente.">
            <input value={form.clientRef} maxLength={60} onChange={(e) => set('clientRef', e.target.value)} />
          </Field>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Ativo (aparece para novos orçamentos)
        </label>
      </section>
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <a className="btn btn-ghost" href="#/materiais">
          Cancelar
        </a>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Destinos
// ---------------------------------------------------------------------------

export function DestinationsPage({ canWrite }: { canWrite: boolean }) {
  const [inactive, setInactive] = useState(false);
  const { data, error, loading, reload } = useLoad(() => listDestinations(inactive), [inactive], 'Não foi possível carregar os destinos.');

  return (
    <>
      <PageHeader
        title="Destinos"
        actions={
          canWrite && (
            <a className="btn btn-primary" href="#/destinos/novo">
              Novo destino
            </a>
          )
        }
      >
        <p className="muted">Distância e pedágio de ida e volta a partir da sede. Ligue o destino ao site do Axis Core para a revisão sugerir o deslocamento pelo site do projeto.</p>
      </PageHeader>
      <div className="toolbar">
        <InactiveToggle value={inactive} onChange={setInactive} />
      </div>
      {error && <ErrorAlert message={error} onRetry={reload} />}
      {loading && !data && <p className="muted">Carregando…</p>}
      {data && (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Destino</th>
                <th>Site no Axis Core</th>
                <th className="num">Km ida e volta</th>
                <th className="num">Pedágio por dia</th>
                <th>Rota / fonte</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted empty">
                    Nenhum destino cadastrado.
                  </td>
                </tr>
              )}
              {data.map((d) => (
                <tr key={d.id} className={canWrite ? 'row-link' : undefined} onClick={canWrite ? () => navigate(`/destinos/${d.id}`) : undefined}>
                  <td>{canWrite ? <a href={`#/destinos/${d.id}`}>{d.name}</a> : d.name}</td>
                  <td>
                    {d.site ? (
                      <>
                        {siteLabel(d.site)} {!d.site.active && <Badge tone="warning">Inativo no Core</Badge>}
                      </>
                    ) : d.siteAxisId ? (
                      <span className="muted">Site fora dos cadastros recebidos do Core</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num">{formatNumber(d.kmRoundTrip)}</td>
                  <td className="num">{formatBRL(d.tollPerDay)}</td>
                  <td>{d.routeNotes ?? '—'}</td>
                  <td>{d.active ? <Badge tone="success">Ativo</Badge> : <Badge tone="neutral">Inativo</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const EMPTY_DESTINATION = { name: '', kmRoundTrip: '', tollPerDay: '', routeNotes: '', siteAxisId: null as string | null, active: true };
type DestinationForm = typeof EMPTY_DESTINATION;

const destinationToForm = (d: BudgetDestination): DestinationForm => ({
  name: d.name,
  kmRoundTrip: decimalToInput(d.kmRoundTrip),
  tollPerDay: decimalToInput(d.tollPerDay),
  routeNotes: d.routeNotes ?? '',
  siteAxisId: d.siteAxisId,
  active: d.active,
});

/** Site do destino já carregado, no formato do seletor (evita buscar de novo). */
const siteItem = (d: BudgetDestination | null | undefined): MasterItem | null =>
  d?.site ? { axisId: d.site.axisId, code: d.site.code, name: d.site.name, active: d.site.active, label: siteLabel(d.site), info: {} } : null;

export function DestinationFormPage({ id }: { id: string | null }) {
  const loaded = useLoad(() => (id ? getDestination(id) : Promise.resolve(null)), [id], 'Não foi possível carregar o destino.');
  const initial = loaded.data ? destinationToForm(loaded.data) : EMPTY_DESTINATION;
  const [form, setForm] = useState<DestinationForm>(EMPTY_DESTINATION);
  const [errors, setErrors] = useState<Partial<Record<keyof DestinationForm, string>>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => setForm(loaded.data ? destinationToForm(loaded.data) : EMPTY_DESTINATION), [loaded.data]);
  useUnsavedWarning(JSON.stringify(form) !== JSON.stringify(initial) && !saving);
  const set = (k: keyof DestinationForm, v: string | boolean | null) => setForm((f) => ({ ...f, [k]: v }));

  /** Escolher o site do Core preenche o nome do destino quando ele ainda está vazio. */
  function pickSite(item: MasterItem | null) {
    setForm((f) => ({ ...f, siteAxisId: item?.axisId ?? null, name: f.name.trim() || !item ? f.name : item.label.slice(0, 120) }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (form.name.trim().length < 2) errs.name = 'Informe o destino (mínimo 2 caracteres).';
    const km = parseDecimal(form.kmRoundTrip, 2);
    if (!km.ok) errs.kmRoundTrip = km.error;
    else if (km.value === null) errs.kmRoundTrip = 'Informe a distância de ida e volta.';
    const toll = parseDecimal(form.tollPerDay, 2);
    if (!toll.ok) errs.tollPerDay = toll.error;
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    setFormError(null);
    try {
      await saveDestination(id, {
        name: form.name.trim(),
        kmRoundTrip: km.ok ? km.value : null,
        tollPerDay: (toll.ok && toll.value) || '0',
        routeNotes: form.routeNotes.trim() || null,
        siteAxisId: form.siteAxisId,
        active: form.active,
      });
      navigate('/destinos');
    } catch (err) {
      setFormError(messageOf(err, 'Não foi possível salvar o destino.'));
      setSaving(false);
    }
  }

  if (loaded.error) return <ErrorAlert message={loaded.error} onRetry={loaded.reload} />;
  if (id && !loaded.data) return <p className="muted">Carregando…</p>;

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader title={id ? `Editar ${loaded.data?.name ?? 'destino'}` : 'Novo destino'} back={{ href: '/destinos', label: 'Destinos' }} />
      {formError && <ErrorAlert message={formError} />}
      <section className="card">
        <Field label="Site no Axis Core" hint="Mantido no Axis Core. Km e pedágio continuam definidos aqui no Financeiro.">
          <CoreMasterPicker
            kind="sites"
            value={form.siteAxisId}
            selected={siteItem(loaded.data)}
            editable
            placeholder="Buscar site do Core (código ou nome)"
            emptyLabel="Sem site do Core"
            onPick={pickSite}
          />
        </Field>
        <div className="grid-2">
          <Field label="Destino / site" required error={errors.name}>
            <input value={form.name} maxLength={120} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} autoFocus />
          </Field>
          <Field label="Km ida e volta" required error={errors.kmRoundTrip}>
            <input inputMode="decimal" value={form.kmRoundTrip} onChange={(e) => set('kmRoundTrip', e.target.value)} aria-invalid={!!errors.kmRoundTrip} />
          </Field>
          <Field label="Pedágio por dia, ida e volta (R$)" error={errors.tollPerDay} hint="Vazio = sem pedágio.">
            <input inputMode="decimal" value={form.tollPerDay} onChange={(e) => set('tollPerDay', e.target.value)} aria-invalid={!!errors.tollPerDay} />
          </Field>
          <Field label="Rota / fonte">
            <input value={form.routeNotes} maxLength={300} onChange={(e) => set('routeNotes', e.target.value)} />
          </Field>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Ativo
        </label>
      </section>
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <a className="btn btn-ghost" href="#/destinos">
          Cancelar
        </a>
      </div>
    </form>
  );
}
