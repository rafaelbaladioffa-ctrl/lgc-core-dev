/**
 * Metadados dos parâmetros gerais de orçamento (projetos-especificacao §4.2). Fonte única para a
 * validação do DTO, a checagem de publicação e o formulário do frontend (GET /parameter-sets/schema).
 *
 * `rate` = fração (0.2 = 20 %); `money` = R$; `decimal` = número com casas; `int` = inteiro; `bool` = sim/não.
 */
export type FieldKind = 'rate' | 'money' | 'decimal' | 'int' | 'bool';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  /** Casas decimais aceitas na entrada (fração, no caso de `rate`). */
  scale?: number;
  hint?: string;
  /** Exigido para publicar. Campos opcionais valem 0/"não" quando vazios. */
  required: boolean;
}

export interface FieldGroup {
  key: string;
  label: string;
  fields: FieldDef[];
}

const f = (key: string, label: string, kind: FieldKind, opts: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  kind,
  required: true,
  scale: kind === 'rate' ? 6 : kind === 'money' ? 2 : kind === 'decimal' ? 4 : 0,
  ...opts,
});

export const PARAMETER_GROUPS: FieldGroup[] = [
  {
    key: 'jornada',
    label: 'Jornada',
    fields: [
      f('hoursPerDay', 'Horas trabalhadas por dia', 'decimal', { scale: 2 }),
      f('workingDaysYear', 'Dias úteis no ano', 'int', { hint: 'Feriados nacionais já descontados.' }),
      f('vacationWorkDays', 'Dias úteis de férias por ano', 'int', { hint: '30 dias corridos ≈ 22 dias úteis.' }),
    ],
  },
  {
    key: 'encargos',
    label: 'Encargos trabalhistas',
    fields: [
      f('inssRate', 'INSS patronal', 'rate'),
      f('ratRate', 'RAT × FAP', 'rate', { hint: 'Depende do CNAE e do FAP. Confirmar na folha.' }),
      f('thirdPartyRate', 'Terceiros (Sistema S, salário-educação, Incra)', 'rate'),
      f('fgtsRate', 'FGTS', 'rate', { hint: 'Sobre salário, férias e 13º.' }),
      f('fgtsFineProvision', 'Provisão de multa rescisória (% do FGTS)', 'rate', { required: false, hint: 'Ex.: 40 % para provisionar demissão sem justa causa.' }),
      f('vtSalaryDiscount', 'Desconta 6 % do salário no vale-transporte', 'bool', { required: false }),
    ],
  },
  {
    key: 'impostos',
    label: 'Impostos sobre a nota (lucro presumido)',
    fields: [
      f('pisRate', 'PIS (cumulativo)', 'rate'),
      f('cofinsRate', 'COFINS (cumulativo)', 'rate'),
      f('issRate', 'ISS', 'rate', { hint: 'Alíquota que sai na nota da LGC (município e item de serviço).' }),
      f('irpjPresumption', 'Presunção de lucro — IRPJ', 'rate'),
      f('irpjRate', 'IRPJ', 'rate'),
      f('irpjSurcharge', 'Aplica adicional de IRPJ de 10 %', 'bool', { required: false, hint: 'Conservador: aplicado sobre toda a presunção.' }),
      f('csllPresumption', 'Presunção de lucro — CSLL', 'rate'),
      f('csllRate', 'CSLL', 'rate'),
    ],
  },
  {
    key: 'veiculo',
    label: 'Veículo',
    fields: [
      f('kmRate', 'Valor cobrado por km rodado (R$)', 'money'),
      f('fuelKmPerLiter', 'Consumo do carro (km por litro)', 'decimal', { scale: 2 }),
      f('fuelPricePerLiter', 'Preço do combustível (R$ por litro)', 'money'),
      f('vehicleWearPerKm', 'Desgaste e manutenção (R$ por km)', 'decimal', { required: false, hint: 'Pneus, revisão, depreciação. Vazio = 0.' }),
    ],
  },
  {
    key: 'material',
    label: 'Material',
    fields: [
      f('materialMarkup', 'Markup sobre material', 'rate', { required: false, hint: 'Vazio = 0 %.' }),
      f('rj45SpareRate', 'Sobra de conectores RJ45', 'rate', { required: false }),
    ],
  },
  {
    key: 'plataforma',
    label: 'Plataforma elevatória',
    fields: [
      f('platformMonthlyRent', 'Locação mensal (R$)', 'money', { required: false }),
      f('platformDaysPerMonth', 'Dias de uso por mês', 'int', { required: false, hint: 'Diária real = locação mensal ÷ dias de uso.' }),
      f('platformFreight', 'Frete / mobilização ida e volta (R$)', 'money', { required: false }),
      f('platformDailyBilled', 'Diária cobrada padrão (R$)', 'money', { required: false }),
    ],
  },
  {
    key: 'indiretos',
    label: 'Custos indiretos e meta',
    fields: [
      f('contingencyRate', 'Contingência sobre custos diretos', 'rate', { required: false }),
      f('overheadRate', 'Rateio de despesas fixas (% da receita)', 'rate', { required: false }),
      f('commissionRate', 'Comissão sobre a venda (% da receita)', 'rate', { required: false }),
      f('receivableDays', 'Prazo de recebimento (dias após a nota)', 'int', { required: false }),
      f('moneyCostMonthly', 'Custo do dinheiro (% ao mês)', 'rate', { required: false }),
      f('targetProfitOnCost', 'Meta de lucro sobre o custo', 'rate', { hint: '100 % = o lucro é igual ao custo total.' }),
    ],
  },
];

export const PARAMETER_FIELDS: FieldDef[] = PARAMETER_GROUPS.flatMap((g) => g.fields);
export const PARAMETER_KEYS = PARAMETER_FIELDS.map((x) => x.key);

/** Campos de remuneração da função: só com `budget_params:read_payroll`. */
export const PAYROLL_ROLE_FIELDS = [
  'monthlySalary',
  'plrSalariesPerYear',
  'mealPerWorkedDay',
  'transportPerMonth',
  'gymPerMonth',
  'healthPerMonth',
  'otherBenefitsPerMonth',
  'costPerHourOverride',
] as const;

export type PayrollRoleField = (typeof PAYROLL_ROLE_FIELDS)[number];

export const ROLE_FIELD_LABELS: Record<PayrollRoleField | 'billingRate', string> = {
  billingRate: 'Valor hora cobrado (R$)',
  monthlySalary: 'Salário mensal (R$)',
  plrSalariesPerYear: 'PLR (nº de salários por ano)',
  mealPerWorkedDay: 'Vale-refeição (R$ por dia trabalhado)',
  transportPerMonth: 'Vale-transporte (R$ por mês, 11 meses)',
  gymPerMonth: 'Academia / Wellhub (R$ por mês)',
  healthPerMonth: 'Plano de saúde (R$ por mês)',
  otherBenefitsPerMonth: 'Outros benefícios (R$ por mês)',
  costPerHourOverride: 'Custo hora informado (R$, substitui o cálculo)',
};

/**
 * Valores iniciais de um primeiro conjunto: só referências legais públicas (lucro presumido, CLT).
 * Valores próprios da LGC (salários, valor hora, km, metas) ficam vazios e são preenchidos na tela.
 */
export const LEGAL_DEFAULTS: Record<string, string | number | boolean> = {
  hoursPerDay: '8',
  workingDaysYear: 252,
  vacationWorkDays: 22,
  inssRate: '0.2',
  thirdPartyRate: '0.058',
  fgtsRate: '0.08',
  fgtsFineProvision: '0',
  vtSalaryDiscount: false,
  pisRate: '0.0065',
  cofinsRate: '0.03',
  irpjPresumption: '0.32',
  irpjRate: '0.15',
  irpjSurcharge: true,
  csllPresumption: '0.32',
  csllRate: '0.09',
};

export const DEFAULT_ROLES = [
  { roleKey: 'tecnico', label: 'Técnico', fieldRole: true, sortOrder: 1 },
  { roleKey: 'encarregado', label: 'Encarregado', fieldRole: true, sortOrder: 2 },
  { roleKey: 'gerente_projeto', label: 'Gerente de projeto', fieldRole: false, sortOrder: 3 },
];
