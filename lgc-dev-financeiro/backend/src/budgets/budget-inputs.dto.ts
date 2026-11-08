import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { decimalPattern } from '../budget-params/parameter-sets.dto.js';

/** Entradas da revisão (projetos-especificacao §5). Dinheiro como texto decimal; vazio/nulo = 0. */

const nullable = () => ValidateIf((_o, v) => v !== null && v !== undefined);
const money = (label: string) => Matches(decimalPattern(10, 2), { message: `${label}: número com até 2 casas decimais.` });
const qty = (label: string) => Matches(decimalPattern(8, 4), { message: `${label}: número com até 4 casas decimais.` });
const int = (label: string, max = 9999) => [IsInt({ message: `${label}: número inteiro.` }), Min(0, { message: `${label}: não pode ser negativo.` }), Max(max, { message: `${label}: valor alto demais.` })];
const applyAll = (...ds: PropertyDecorator[]): PropertyDecorator => (t, k) => ds.forEach((d) => d(t, k));

export class TeamInputDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,39}$/, { message: 'Função inválida.' })
  roleKey!: string;

  @nullable()
  @applyAll(...int('Pessoas', 500))
  people?: number | null;

  @nullable()
  @Matches(decimalPattern(6, 2), { message: 'Horas: número com até 2 casas decimais.' })
  hours?: string | null;
}

export class MaterialInputDto {
  @nullable()
  @IsUUID('4', { message: 'Item do catálogo inválido.' })
  materialId?: string | null;

  @IsString()
  @Length(1, 160, { message: 'Descrição do material: 1 a 160 caracteres.' })
  description!: string;

  @nullable()
  @IsString()
  @MaxLength(10)
  unit?: string | null;

  @qty('Quantidade')
  quantity!: string;

  @Matches(decimalPattern(10, 4), { message: 'Preço cobrado: número com até 4 casas decimais.' })
  billedUnitPrice!: string;

  @nullable()
  @Matches(decimalPattern(10, 4), { message: 'Custo real: número com até 4 casas decimais.' })
  realUnitCost?: string | null;
}

export class TravelInputDto {
  @nullable() @IsUUID('4', { message: 'Destino inválido.' }) destinationId?: string | null;
  @nullable() @IsString() @MaxLength(120) destinationName?: string | null;
  @nullable() @Matches(decimalPattern(6, 2), { message: 'Km ida e volta: número com até 2 casas decimais.' }) kmRoundTrip?: string | null;
  @nullable() @money('Pedágio por dia') tollPerDay?: string | null;
  @nullable() @applyAll(...int('Carros', 100)) cars?: number | null;
  @nullable() @money('Aluguel de carro por dia') carRentalPerDay?: string | null;
  @nullable() @money('Estacionamento por dia') parkingPerDay?: string | null;
}

export class PlatformInputDto {
  @nullable() @applyAll(...int('Dias de plataforma')) days?: number | null;
  @nullable() @money('Diária cobrada da plataforma') dailyBilled?: string | null;
  @nullable() @money('Custo real da plataforma') realCost?: string | null;
}

export class LodgingInputDto {
  @nullable() @applyAll(...int('Pessoas na hospedagem', 500)) people?: number | null;
  @nullable() @applyAll(...int('Noites')) nights?: number | null;
  @nullable() @money('Valor por noite') nightValue?: string | null;
  @nullable() @money('Custo real da hospedagem') realCost?: string | null;
}

export class MealsInputDto {
  @nullable() @applyAll(...int('Pessoas com diária', 500)) people?: number | null;
  @nullable() @applyAll(...int('Dias de diária')) days?: number | null;
  @nullable() @money('Valor da diária') dayValue?: string | null;
  @nullable() @money('Custo real das diárias') realCost?: string | null;
}

export class ExtraLaborInputDto {
  @nullable() @money('Horas extras previstas') overtimeCost?: string | null;
  @nullable() @money('Credenciamento e integração') onboardingCost?: string | null;
}

export class OtherCostsInputDto {
  @nullable() @money('EPI e uniformes') epi?: string | null;
  @nullable() @money('Ferramentas e equipamentos') tools?: string | null;
  @nullable() @money('Seguro e ART') insurance?: string | null;
  @nullable() @money('Outros custos') other?: string | null;
  @nullable() @IsString() @MaxLength(200, { message: 'Descrição de outros custos: até 200 caracteres.' }) otherDescription?: string | null;
}

export class BudgetInputsDto {
  @applyAll(...int('Dias de trabalho', 999))
  workDays!: number;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TeamInputDto)
  team!: TeamInputDto[];

  @IsArray()
  @ArrayMaxSize(200, { message: 'No máximo 200 itens de material.' })
  @ValidateNested({ each: true })
  @Type(() => MaterialInputDto)
  materials!: MaterialInputDto[];

  @nullable() @money('Frete de material') materialFreight?: string | null;
  @nullable() @Matches(decimalPattern(2, 6), { message: 'Perdas de material: fração (ex.: 0.05 = 5 %).' }) materialLossRate?: string | null;

  @IsOptional() @ValidateNested() @Type(() => TravelInputDto) travel?: TravelInputDto;
  @IsOptional() @ValidateNested() @Type(() => PlatformInputDto) platform?: PlatformInputDto;
  @IsOptional() @ValidateNested() @Type(() => LodgingInputDto) lodging?: LodgingInputDto;
  @IsOptional() @ValidateNested() @Type(() => MealsInputDto) meals?: MealsInputDto;
  @IsOptional() @ValidateNested() @Type(() => ExtraLaborInputDto) extraLabor?: ExtraLaborInputDto;
  @IsOptional() @ValidateNested() @Type(() => OtherCostsInputDto) otherCosts?: OtherCostsInputDto;
}

export class CreateBudgetDto {
  @IsString()
  @Length(1, 64)
  axisProjectId!: string;

  @IsOptional()
  @IsString()
  @Length(3, 160, { message: 'Título: 3 a 160 caracteres.' })
  title?: string;
}

/** `AAAA-MM-DD` com mês 01–12 e dia 01–31; data inexistente (ex.: 2026-02-30) é recusada no serviço. */
const dateOnly = (label: string) => Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, { message: `${label}: data no formato AAAA-MM-DD.` });

/** Cabeçalho do orçamento (P-07). `null` = volta a usar o valor do projeto no Core. */
export class UpdateBudgetDto {
  @nullable()
  @IsString()
  @Length(3, 160, { message: 'Título: 3 a 160 caracteres.' })
  title?: string | null;

  @nullable()
  @dateOnly('Início previsto')
  plannedStartDate?: string | null;

  @nullable()
  @dateOnly('Conclusão prevista')
  plannedEndDate?: string | null;
}

export class UpdateRevisionDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetInputsDto)
  inputs?: BudgetInputsDto;

  @nullable()
  @IsString()
  @MaxLength(2000, { message: 'Observações: até 2000 caracteres.' })
  notes?: string | null;
}

export class SimulateRevisionDto {
  @ValidateNested()
  @Type(() => BudgetInputsDto)
  inputs!: BudgetInputsDto;
}

/** Motivo ao devolver ou perder (obrigatório nessas ações; opcional nas outras). */
export class RevisionTransitionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string | null;
}

/** Importar a SOW: do Core (pedido informado ou o mais recente do projeto) ou texto colado. */
export class ImportSowDto {
  @IsOptional()
  @IsUUID()
  quoteRequestId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  text?: string;
}

export class SowCableLineDto {
  @IsString()
  @Length(1, 80)
  type!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000)
  lengthM!: number;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3456)
  fibers?: number;
}

export class UpdateSowCablesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SowCableLineDto)
  cables!: SowCableLineDto[];
}

/** Bid Template do pedido de cotação (o informado ou o mais recente do projeto). */
export class ImportBidTemplateDto {
  @IsOptional()
  @IsUUID()
  quoteRequestId?: string;
}

/** Horas T por tipo de cabo (número) ou `null` para voltar ao proporcional. Conferido no serviço. */
export class UpdateHoursTDto {
  @IsObject()
  hours!: Record<string, number | null>;
}

/** Justificativas por indicador (efficiency, costPerPort, laborCostPerPort, hoursPerPort, hoursPerMeter). */
export class UpdateKpiJustificationsDto {
  @IsObject()
  justifications!: Record<string, string | null>;
}

export class BidHeaderProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  vendorName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  pocName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  pocEmail?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  leadTimeDays?: number | null;
}

/**
 * Perfil da Bid: cabeçalho e mapeamentos. `cables`: tipo normalizado → { code, description?, supplier?,
 * partNumber?, unit? } ou null; `roles`: roleKey → código da linha de mão de obra ou null. Conferido no serviço.
 */
export class UpdateBidProfileDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BidHeaderProfileDto)
  header?: BidHeaderProfileDto;

  @IsOptional()
  @IsObject()
  cables?: Record<string, { code: string; description?: string | null; supplier?: string | null; partNumber?: string | null; unit?: string | null } | null>;

  @IsOptional()
  @IsObject()
  roles?: Record<string, string | null>;
}
