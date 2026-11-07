import type { CompletionRule, ManagementLevelStep, RequestCategoryKind, RequestFormField, WorkflowStep } from '../api/requestCategories';

/** Horas úteis (tela) -> minutos (API). Aceita vírgula decimal. `null` se inválido. */
export function hoursToMinutes(input: number | string): number | null {
  const hours = typeof input === 'number' ? input : Number(input.trim().replace(',', '.'));
  if (!Number.isFinite(hours) || hours <= 0) return null;
  // A tela trabalha em passos de 0,25h (15 min).
  if (Math.abs(hours * 4 - Math.round(hours * 4)) > 1e-9) return null;
  return Math.round(hours * 60);
}

/** Minutos (API) -> horas úteis (tela). */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/** Chave sugerida a partir do rótulo: snake_case, sem acento, até 40 caracteres, começando por letra. */
export function keyFromLabel(label: string): string {
  let key = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (key === '') return '';
  if (!/^[a-z]/.test(key)) key = `campo_${key}`;
  return key.slice(0, 40).replace(/_+$/, '');
}

export const MANAGEMENT_LEVEL_ORDER: ManagementLevelStep[] = ['supervisor', 'coordenador', 'gerente', 'diretor'];

export type ApprovalMode = 'none' | 'gestor_direto' | 'niveis' | 'colaboradores' | 'custom';

export interface ApprovalState {
  mode: ApprovalMode;
  levels: ManagementLevelStep[];
  collaboratorIds: string[];
  completionRule: CompletionRule;
  requiredCount: number;
  /** Fluxo existente que a tela não sabe editar; mantido como está até o usuário escolher outro modo. */
  custom: WorkflowStep[];
}

export const emptyApproval: ApprovalState = {
  mode: 'none',
  levels: [],
  collaboratorIds: [],
  completionRule: 'todos',
  requiredCount: 1,
  custom: [],
};

/** Interpreta um workflowSchema existente nos modos que a tela edita. */
export function approvalFromWorkflow(steps: WorkflowStep[]): ApprovalState {
  if (steps.length === 0) return { ...emptyApproval };
  if (steps.length === 1 && steps[0].approverRule === 'gestor_direto') return { ...emptyApproval, mode: 'gestor_direto' };
  if (steps.every((s) => s.approverRule === 'management_level' && s.requiredLevel)) {
    return { ...emptyApproval, mode: 'niveis', levels: steps.map((s) => s.requiredLevel as ManagementLevelStep) };
  }
  if (steps.length === 1 && steps[0].approverRule === 'colaboradores') {
    const s = steps[0];
    return {
      ...emptyApproval,
      mode: 'colaboradores',
      collaboratorIds: s.collaboratorIds ?? [],
      completionRule: s.completionRule ?? 'todos',
      requiredCount: s.requiredCount ?? 1,
    };
  }
  return { ...emptyApproval, mode: 'custom', custom: steps };
}

/** Monta o workflowSchema da API a partir do que foi escolhido na tela. */
export function workflowFromApproval(a: ApprovalState): WorkflowStep[] {
  switch (a.mode) {
    case 'none':
      return [];
    case 'gestor_direto':
      return [{ stepOrder: 1, approverRule: 'gestor_direto' }];
    case 'niveis':
      return MANAGEMENT_LEVEL_ORDER.filter((l) => a.levels.includes(l)).map((requiredLevel, i) => ({
        stepOrder: i + 1,
        approverRule: 'management_level' as const,
        requiredLevel,
      }));
    case 'colaboradores':
      return [
        {
          stepOrder: 1,
          approverRule: 'colaboradores',
          collaboratorIds: a.collaboratorIds,
          completionRule: a.completionRule,
          ...(a.completionRule === 'n_de_m' ? { requiredCount: a.requiredCount } : {}),
        },
      ];
    case 'custom':
      return a.custom;
  }
}

export interface FieldDraft {
  uid: string;
  label: string;
  key: string;
  /** A chave foi editada à mão: deixa de acompanhar o rótulo. */
  keyTouched: boolean;
  type: RequestFormField['type'];
  required: boolean;
  optionsMode: 'list' | 'source';
  optionsText: string;
  optionsSource: NonNullable<RequestFormField['optionsSource']>;
}

let uidCounter = 0;
export const nextUid = () => `f${++uidCounter}`;

export function newFieldDraft(): FieldDraft {
  return { uid: nextUid(), label: '', key: '', keyTouched: false, type: 'text', required: false, optionsMode: 'list', optionsText: '', optionsSource: 'projects' };
}

export function fieldDraftFromSchema(f: RequestFormField): FieldDraft {
  return {
    uid: nextUid(),
    label: f.label,
    key: f.key,
    keyTouched: true,
    type: f.type,
    required: f.required === true,
    optionsMode: f.optionsSource ? 'source' : 'list',
    optionsText: (f.options ?? []).join('\n'),
    optionsSource: f.optionsSource ?? 'projects',
  };
}

export function fieldDraftToSchema(d: FieldDraft): RequestFormField {
  const field: RequestFormField = { key: d.key.trim(), label: d.label.trim(), type: d.type };
  if (d.required) field.required = true;
  if (d.type === 'select') {
    if (d.optionsMode === 'source') field.optionsSource = d.optionsSource;
    else
      field.options = d.optionsText
        .split('\n')
        .map((o) => o.trim())
        .filter((o) => o !== '');
  }
  return field;
}

export const KIND_LABELS: Record<RequestCategoryKind, string> = {
  padrao: 'Padrão',
  compra_material: 'Compra de material',
  denuncia: 'Denúncia',
};

export const OPTIONS_SOURCE_LABELS: Record<NonNullable<RequestFormField['optionsSource']>, string> = {
  projects: 'Projetos',
  collaborators: 'Colaboradores',
  clients: 'Clientes',
  cost_centers: 'Centros de custo',
  job_titles: 'Cargos',
};

export const FIELD_TYPE_LABELS: Record<RequestFormField['type'], string> = {
  text: 'Texto curto',
  textarea: 'Texto longo',
  number: 'Número',
  date: 'Data',
  select: 'Lista de opções',
  checkbox: 'Caixa de seleção',
  attachment: 'Anexo',
};

export interface GroupedErrors {
  /** Erros por índice de campo do formulário (já sem o prefixo técnico). */
  byField: Map<number, string[]>;
  workflow: string[];
  sla: string[];
  other: string[];
}

/** Separa a lista de erros do servidor (`formSchema[2].key: ...`) por área da tela. */
export function groupErrors(errors: string[]): GroupedErrors {
  const grouped: GroupedErrors = { byField: new Map(), workflow: [], sla: [], other: [] };
  for (const error of errors) {
    const field = /^formSchema\[(\d+)\](?:\.\w+)?:\s*(.*)$/.exec(error);
    if (field) {
      const index = Number(field[1]);
      grouped.byField.set(index, [...(grouped.byField.get(index) ?? []), field[2]]);
    } else if (error.startsWith('workflowSchema')) grouped.workflow.push(error.replace(/^workflowSchema(\[\d+\](\.\w+)?)?:\s*/, ''));
    else if (/^sla/i.test(error)) grouped.sla.push(error.replace(/^sla\w*:\s*/i, ''));
    else grouped.other.push(error.replace(/^formSchema:\s*/, ''));
  }
  return grouped;
}
