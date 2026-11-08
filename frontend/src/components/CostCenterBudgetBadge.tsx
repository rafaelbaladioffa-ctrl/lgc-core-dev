import { StatusBadge } from './DataTable';
import { COST_CENTER_BUDGET_LABELS, type CostCenter } from '../api/costCenters';
import { formatNumberBR } from '../utils/format';

const TONES = { ok: 'success', alerta: 'warning', estourado: 'danger' } as const;

/** Selo da situação do orçamento do centro de custo (informada pelo Financeiro). Nada quando o
 * Financeiro ainda não informou. O percentual vem na escala 0–999 (não fração). */
export function CostCenterBudgetBadge({ costCenter, showYear = false }: { costCenter: Pick<CostCenter, 'budgetStatus' | 'budgetPercent' | 'budgetYear'>; showYear?: boolean }) {
  if (!costCenter.budgetStatus) return null;
  const percent = costCenter.budgetPercent !== null ? ` · ${formatNumberBR(costCenter.budgetPercent, 2)}%` : '';
  const year = showYear && costCenter.budgetYear ? ` (${costCenter.budgetYear})` : '';
  return <StatusBadge label={`${COST_CENTER_BUDGET_LABELS[costCenter.budgetStatus]}${percent}${year}`} tone={TONES[costCenter.budgetStatus]} />;
}
