import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { listProjects } from '../lib/budgets';
import { BUDGET_STATUS, consumptionWidth, defaultPeriod, validatePeriod, withPeriod, type BudgetStatus, type Period } from '../lib/costCenters';
import { formatPercent } from '../lib/decimal';
import { formatBRL } from '../lib/format';
import { navigate } from '../lib/router';
import { Badge, messageOf } from './ui';

/** Seletor de período (meses inclusivos). Aplicar muda a rota, para o link guardar o período. */
export function PeriodPicker({ period, base }: { period: Period; base: string }) {
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const [error, setError] = useState<string | null>(null);

  function apply(e: FormEvent) {
    e.preventDefault();
    const p = { from, to };
    const err = validatePeriod(p);
    setError(err);
    if (!err) navigate(withPeriod(base, p));
  }

  function reset() {
    const p = defaultPeriod();
    setFrom(p.from);
    setTo(p.to);
    setError(null);
    navigate(withPeriod(base, p));
  }

  return (
    <form className="period-picker" onSubmit={apply} noValidate>
      <label>
        <span>De</span>
        <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} aria-invalid={!!error} />
      </label>
      <label>
        <span>Até</span>
        <input type="month" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!!error} />
      </label>
      <button className="btn btn-primary" type="submit">
        Aplicar
      </button>
      <button className="btn btn-ghost" type="button" onClick={reset}>
        Ano corrente
      </button>
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
    </form>
  );
}

export function BudgetBadge({ status }: { status: BudgetStatus }) {
  const s = BUDGET_STATUS[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Barra de consumo do orçamento do ano (realizado + comprometido em aberto) com o selo da faixa. */
export function BudgetBar({ budget }: { budget: { amount: string; consumed: string; percent: string | null; status: BudgetStatus } }) {
  if (budget.status === 'sem_orcamento') return <BudgetBadge status="sem_orcamento" />;
  const width = consumptionWidth(budget.percent);
  return (
    <div className="budget-consumption" title={`${formatBRL(budget.consumed)} de ${formatBRL(budget.amount)}`}>
      <div className="budget-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={width} aria-label="Consumo do orçamento do ano">
        {/* A largura é o dado (0–100%); não há token para isso. */}
        <div className={`budget-bar-fill budget-bar-${budget.status}`} style={{ width: `${width}%` }} />
      </div>
      <span className="budget-consumption-text">
        {formatPercent(budget.percent)} <BudgetBadge status={budget.status} />
      </span>
    </div>
  );
}

/** Valor em reais com cor de negativo. */
export function Amount({ value }: { value: string | null | undefined }) {
  const negative = typeof value === 'string' && value.trim().startsWith('-');
  return <span className={negative ? 'negative' : undefined}>{formatBRL(value)}</span>;
}

export function Notice({ notice }: { notice: { tone: 'success' | 'danger' | 'warning'; text: ReactNode } | null }) {
  if (!notice) return null;
  return (
    <div className={`alert alert-${notice.tone}`} role={notice.tone === 'danger' ? 'alert' : 'status'}>
      {notice.text}
    </div>
  );
}

export type ProjectOption = { id: string; label: string };

/**
 * Projetos do Core para os seletores (lançamento manual, diário). A lista vem de `/projects` (exige
 * `budget:read`); sem acesso ou com falha, ficam os projetos já conhecidos da tela e o erro é mostrado.
 */
export function useProjectOptions(known: ProjectOption[]) {
  const [loaded, setLoaded] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    listProjects()
      .then((r) => alive && setLoaded(r.projects.filter((p) => p.active).map((p) => ({ id: p.axisProjectId, label: [p.code, p.name].filter(Boolean).join(' — ') }))))
      .catch((e: unknown) => alive && setError(messageOf(e, 'Não foi possível carregar a lista de projetos.')));
    return () => {
      alive = false;
    };
  }, []);
  const byId = new Map<string, ProjectOption>();
  for (const p of [...known, ...loaded]) byId.set(p.id, p);
  const options = [...byId.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  return { options, error };
}
