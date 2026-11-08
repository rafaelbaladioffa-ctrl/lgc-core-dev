import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';

/** DTOs do módulo Centros de custo (centros-de-custo-especificacao §8). Valores em reais como texto "1234.56". */

const MONEY = /^-?\d{1,12}(\.\d{1,2})?$/;
const POSITIVE_MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const COST_CATEGORIES = ['folha', 'material', 'compras', 'servicos', 'despesas_campo', 'frota', 'outros'] as const;
export const CATEGORIES = ['faturamento', ...COST_CATEGORIES] as const;
export const ACTIVITIES = ['projeto', 'deslocamento', 'treinamento', 'manutencao', 'ocioso'] as const;
export const DRIVERS = ['headcount', 'receita', 'custo_direto', 'percentual'] as const;

export class PeriodQuery {
  @IsOptional()
  @Matches(MONTH, { message: 'Início do período inválido (use AAAA-MM).' })
  from?: string;

  @IsOptional()
  @Matches(MONTH, { message: 'Fim do período inválido (use AAAA-MM).' })
  to?: string;
}

/** Importação manual das horas do Field por período (até 62 dias). */
export class FieldLaborImportDto {
  @Matches(DATE, { message: 'Início inválido (use AAAA-MM-DD).' })
  from!: string;

  @Matches(DATE, { message: 'Fim inválido (use AAAA-MM-DD).' })
  to!: string;
}

export class FieldLaborPendingQuery {
  @IsOptional()
  @Matches(DATE, { message: 'Início inválido (use AAAA-MM-DD).' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'Fim inválido (use AAAA-MM-DD).' })
  to?: string;
}

export class CreateEntryDto {
  @Matches(DATE, { message: 'Competência inválida (use AAAA-MM-DD).' })
  competence!: string;

  @IsIn(['receita', 'custo'], { message: 'Tipo: receita ou custo.' })
  kind!: 'receita' | 'custo';

  @IsIn(CATEGORIES, { message: 'Categoria inválida.' })
  category!: (typeof CATEGORIES)[number];

  @Matches(MONEY, { message: 'Valor inválido (até 2 casas decimais).' })
  amount!: string;

  @IsString()
  @MinLength(3, { message: 'Descreva o lançamento (mínimo 3 caracteres).' })
  @MaxLength(300)
  description!: string;

  @IsOptional()
  @IsUUID('all', { message: 'Projeto inválido.' })
  projectId?: string;
}

export class ReverseEntryDto {
  @IsString()
  @MinLength(5, { message: 'Informe o motivo do estorno (mínimo 5 caracteres).' })
  @MaxLength(300)
  reason!: string;
}

export class BudgetRowDto {
  @IsIn(COST_CATEGORIES, { message: 'Categoria de orçamento inválida.' })
  category!: (typeof COST_CATEGORIES)[number];

  @IsArray()
  @ArrayMaxSize(12)
  @Matches(POSITIVE_MONEY, { each: true, message: 'Valor do orçamento inválido (não negativo, até 2 casas).' })
  months!: string[];
}

export class BudgetDto {
  @IsArray()
  @ArrayMaxSize(COST_CATEGORIES.length)
  @ValidateNested({ each: true })
  @Type(() => BudgetRowDto)
  rows!: BudgetRowDto[];
}

export class SettingsDto {
  @ValidateIf((_, v) => v !== null)
  @Matches(POSITIVE_MONEY, { message: 'Limite inválido (não negativo, até 2 casas).' })
  fieldDailyLimit!: string | null;
}

export class TeamLogDto {
  @Matches(DATE, { message: 'Data inválida (use AAAA-MM-DD).' })
  date!: string;

  @IsIn(ACTIVITIES, { message: 'Atividade inválida.' })
  activity!: (typeof ACTIVITIES)[number];

  @IsOptional()
  @IsUUID('all', { message: 'Projeto inválido.' })
  projectId?: string;

  @Type(() => Number)
  @IsInt({ message: 'Pessoas: número inteiro.' })
  @Min(1, { message: 'Informe ao menos 1 pessoa.' })
  @Max(200)
  people!: number;

  @Matches(/^\d{1,2}(\.\d{1,2})?$/, { message: 'Horas por pessoa inválidas.' })
  hoursPerPerson!: string;

  @IsOptional()
  @Matches(/^\d{1,7}(\.\d)?$/, { message: 'Km inválido.' })
  km?: string;

  @IsOptional()
  @Matches(/^\d{1,9}(\.\d{1,3})?$/, { message: 'Quantidade produzida inválida.' })
  producedQuantity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  producedUnit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class OverheadTargetDto {
  @IsUUID('all', { message: 'Centro de custo de destino inválido.' })
  costCenterId!: string;

  @IsOptional()
  @Matches(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/, { message: 'Percentual inválido (fração entre 0 e 1).' })
  percent?: string;
}

export class OverheadRuleDto {
  @IsIn(DRIVERS, { message: 'Direcionador inválido.' })
  driver!: (typeof DRIVERS)[number];

  @IsBoolean()
  active!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OverheadTargetDto)
  targets!: OverheadTargetDto[];
}

export class JobTitleMapDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  jobTitleName!: string;

  @IsString()
  @MinLength(1, { message: 'Escolha a função.' })
  @MaxLength(60)
  roleKey!: string;
}

export class SettleAdvanceDto {
  @Matches(POSITIVE_MONEY, { message: 'Valor comprovado inválido.' })
  spentAmount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class AdvancesQuery {
  @IsOptional()
  @IsIn(['aberto', 'prestado'])
  status?: 'aberto' | 'prestado';
}

export class PurchasesQuery {
  @IsOptional()
  @IsUUID('all')
  costCenterId?: string;

  @IsOptional()
  @IsIn(['aprovada', 'pedido', 'recebida_parcial', 'recebida', 'cancelada'])
  status?: string;
}
