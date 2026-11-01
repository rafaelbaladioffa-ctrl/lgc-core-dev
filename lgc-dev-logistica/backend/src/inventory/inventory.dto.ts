import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { StockCountStatus, StockCountType } from '@prisma/client';

export const ADJUSTMENT_REASONS = ['ERRO_LANCAMENTO', 'PERDA', 'AVARIA', 'ERRO_CONTAGEM_ANTERIOR', 'ROUBO_EXTRAVIO', 'VENCIMENTO', 'OUTRO'] as const;

export class CountScopeDto {
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true, message: 'Endereço inválido.' }) locationIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true, message: 'Material inválido.' }) materialIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true, message: 'Lote inválido.' }) lotIds?: string[];
  @IsOptional() @IsIn(['A', 'B', 'C'], { message: 'Criticidade inválida (A, B ou C).' }) criticality?: 'A' | 'B' | 'C';
  @IsOptional() @IsInt({ message: 'O tamanho da amostra deve ser inteiro.' }) @Min(1) @Max(5000) sampleSize?: number;
}

export class CreateCountDto {
  @IsEnum(StockCountType, { message: 'Tipo de inventário inválido.' }) type!: StockCountType;
  @IsUUID('all', { message: 'Almoxarifado inválido.' }) warehouseId!: string;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => CountScopeDto) scope?: CountScopeDto;
  /** Diferença percentual (sobre o saldo do sistema) até a qual não exige recontagem. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0, { message: 'A tolerância não pode ser negativa.' }) @Max(100, { message: 'A tolerância máxima é 100%.' }) tolerancePct?: number;
  @IsOptional() @IsBoolean() frozen?: boolean;
}

export class SubmitCountDto {
  @IsUUID('all', { message: 'Linha de contagem inválida.' }) lineId!: string;
  @Transform(({ obj, key, value }) => (obj[key] === '' || obj[key] === null ? undefined : value)) // campo vazio nunca vira contagem zero
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }, { message: 'Quantidade inválida.' }) @Min(0, { message: 'A quantidade contada não pode ser negativa.' }) quantity!: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class ActionPlanDto {
  @IsString({ message: 'Informe o plano de ação.' }) @MinLength(5, { message: 'O plano deve ter ao menos 5 caracteres.' }) @MaxLength(2000) text!: string;
}

export class AdjustLineDto {
  @IsUUID('all', { message: 'Linha de contagem inválida.' }) lineId!: string;
  @IsIn(ADJUSTMENT_REASONS, { message: `Motivo inválido. Use: ${ADJUSTMENT_REASONS.join(', ')}.` }) reason!: (typeof ADJUSTMENT_REASONS)[number];
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class ApplyAdjustmentsDto {
  /** Aprovação de alçada no Axis para o ajuste (valor e motivo). */
  @IsString({ message: 'Informe a aprovação do Axis.' }) @MinLength(3) @MaxLength(80) approvalRef!: string;
  @IsArray() @ArrayMinSize(1, { message: 'Informe os motivos de cada divergência.' }) @ValidateNested({ each: true }) @Type(() => AdjustLineDto) lines!: AdjustLineDto[];
}

export class CancelCountDto {
  @IsString({ message: 'Informe o motivo.' }) @MinLength(3, { message: 'O motivo deve ter ao menos 3 caracteres.' }) @MaxLength(300) reason!: string;
}

export class ListCountsQuery {
  @IsOptional() @IsEnum(StockCountStatus) status?: StockCountStatus;
  @IsOptional() @IsUUID('all') warehouseId?: string;
}
