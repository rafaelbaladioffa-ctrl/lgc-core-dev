import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { PARAMETER_FIELDS, PAYROLL_ROLE_FIELDS, type FieldDef } from './parameter-fields.js';

/** Texto decimal não negativo ("1234.56"), com no máximo `scale` casas. */
export const decimalPattern = (intDigits: number, scale: number) => new RegExp(scale > 0 ? `^\\d{1,${intDigits}}(\\.\\d{1,${scale}})?$` : `^\\d{1,${intDigits}}$`);

const INT_DIGITS: Record<FieldDef['kind'], number> = { rate: 2, money: 12, decimal: 6, int: 6, bool: 0 };

/** Valor nulo limpa o campo (permitido no rascunho); `undefined` não altera. */
const nullable = () => ValidateIf((_o, v) => v !== null && v !== undefined);

export class ParameterSetRoleDto {
  @IsString({ message: 'Código da função inválido.' })
  @Matches(/^[a-z][a-z0-9_]{1,39}$/, { message: 'Código da função: letras minúsculas, números e _ (ex.: tecnico).' })
  roleKey!: string;

  @IsString({ message: 'Informe o nome da função.' })
  @Length(2, 60, { message: 'Nome da função: 2 a 60 caracteres.' })
  label!: string;

  @IsOptional()
  @IsBoolean({ message: 'Indique se a função trabalha em campo.' })
  fieldRole?: boolean;

  @IsOptional()
  @IsInt({ message: 'Ordem inválida.' })
  @Min(0)
  @Max(999)
  sortOrder?: number;

  @nullable()
  @Matches(decimalPattern(10, 2), { message: 'Valor hora cobrado: use até 2 casas decimais (ex.: 85.50).' })
  billingRate?: string | null;

  @nullable()
  @Matches(decimalPattern(10, 2), { message: 'Salário mensal: use até 2 casas decimais.' })
  monthlySalary?: string | null;

  @nullable()
  @Matches(decimalPattern(3, 4), { message: 'PLR: número de salários com até 4 casas.' })
  plrSalariesPerYear?: string | null;

  @nullable()
  @Matches(decimalPattern(10, 2), { message: 'Vale-refeição: use até 2 casas decimais.' })
  mealPerWorkedDay?: string | null;

  @nullable()
  @Matches(decimalPattern(10, 2), { message: 'Vale-transporte: use até 2 casas decimais.' })
  transportPerMonth?: string | null;

  @nullable()
  @Matches(decimalPattern(10, 2), { message: 'Academia: use até 2 casas decimais.' })
  gymPerMonth?: string | null;

  @nullable()
  @Matches(decimalPattern(10, 2), { message: 'Plano de saúde: use até 2 casas decimais.' })
  healthPerMonth?: string | null;

  @nullable()
  @Matches(decimalPattern(10, 2), { message: 'Outros benefícios: use até 2 casas decimais.' })
  otherBenefitsPerMonth?: string | null;

  @nullable()
  @Matches(decimalPattern(10, 4), { message: 'Custo hora informado: use até 4 casas decimais.' })
  costPerHourOverride?: string | null;
}

/** Os campos gerais são declarados a partir de PARAMETER_FIELDS (abaixo), para não divergir do formulário. */
export class UpdateParameterSetDto {
  [key: string]: unknown;

  @nullable()
  @IsDateString({ strict: true }, { message: 'Vigência: data no formato AAAA-MM-DD.' })
  effectiveFrom?: string | null;

  @nullable()
  @IsString()
  @MaxLength(1000, { message: 'Observações: até 1000 caracteres.' })
  notes?: string | null;

  @IsOptional()
  @IsArray({ message: 'Informe a lista de funções.' })
  @ArrayMaxSize(20, { message: 'No máximo 20 funções.' })
  @ValidateNested({ each: true })
  @Type(() => ParameterSetRoleDto)
  roles?: ParameterSetRoleDto[];
}

for (const field of PARAMETER_FIELDS) {
  const target = UpdateParameterSetDto.prototype;
  nullable()(target, field.key);
  if (field.kind === 'bool') {
    IsBoolean({ message: `${field.label}: sim ou não.` })(target, field.key);
  } else if (field.kind === 'int') {
    IsInt({ message: `${field.label}: número inteiro.` })(target, field.key);
    Min(0, { message: `${field.label}: não pode ser negativo.` })(target, field.key);
    Max(9999, { message: `${field.label}: valor alto demais.` })(target, field.key);
  } else {
    const what = field.kind === 'rate' ? 'percentual como fração (ex.: 0.2 = 20 %)' : 'número';
    Matches(decimalPattern(INT_DIGITS[field.kind], field.scale ?? 2), { message: `${field.label}: ${what} com até ${field.scale} casas decimais.` })(target, field.key);
  }
}

export class CreateParameterSetDto {
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f-]{36}$/i, { message: 'Conjunto de origem inválido.' })
  basedOnId?: string;
}

export class PublishParameterSetDto {
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Vigência: data no formato AAAA-MM-DD.' })
  effectiveFrom?: string;
}

export const PAYROLL_FIELDS: readonly string[] = PAYROLL_ROLE_FIELDS;
