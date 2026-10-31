import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MovementType, Ownership, StockCondition } from '@prisma/client';

export class PostMovementDto {
  @IsEnum(MovementType, { message: 'Tipo de movimento inválido.' })
  type!: MovementType;

  @IsUUID('all', { message: 'Material inválido.' })
  materialId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 }, { message: 'Quantidade inválida.' })
  @IsPositive({ message: 'A quantidade deve ser maior que zero.' })
  quantity!: number;

  @IsOptional() @IsUUID('all', { message: 'Lote inválido.' }) lotId?: string;
  @IsOptional() @IsUUID('all', { message: 'Número de série inválido.' }) serialId?: string;
  @IsOptional() @IsUUID('all', { message: 'Endereço de origem inválido.' }) fromLocationId?: string;
  @IsOptional() @IsUUID('all', { message: 'Endereço de destino inválido.' }) toLocationId?: string;
  @IsOptional() @IsEnum(StockCondition, { message: 'Condição de origem inválida.' }) fromCondition?: StockCondition;
  @IsOptional() @IsEnum(StockCondition, { message: 'Condição de destino inválida.' }) toCondition?: StockCondition;
  @IsOptional() @IsEnum(Ownership, { message: 'Propriedade inválida.' }) ownership?: Ownership;

  @IsString({ message: 'Informe o motivo.' }) @MinLength(3, { message: 'O motivo deve ter ao menos 3 caracteres.' }) @MaxLength(300)
  reason!: string;

  @IsOptional() @IsString() @MaxLength(80) axisDocumentRef?: string;
  /** Aprovação de alçada no Axis — obrigatória para ajustes, perdas e descartes (11.12). */
  @IsOptional() @IsString() @MaxLength(80) axisApprovalRef?: string;
  @IsOptional() @IsString() @MaxLength(80) logisticsDocumentRef?: string;
  @IsOptional() @IsString() @MaxLength(60) projectAxisId?: string;
  @IsOptional() @IsString() @MaxLength(60) costCenterAxisId?: string;
  @IsOptional() @IsString() @MaxLength(60) clientAxisId?: string;
  @IsOptional() @IsString() @MaxLength(60) custodianAxisId?: string;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }, { message: 'Custo unitário inválido.' }) @Min(0, { message: 'O custo unitário não pode ser negativo.' })
  unitCost?: number;

  @IsOptional() @IsDateString({}, { message: 'Data efetiva inválida (use data e hora ISO 8601).' }) effectiveAt?: string;
  @IsOptional() @IsString() @MaxLength(80) deviceId?: string;
  @IsOptional() @IsString() @MaxLength(80) correlationId?: string;
}

export class ReverseMovementDto {
  @IsString({ message: 'Informe o motivo do estorno.' }) @MinLength(3, { message: 'O motivo deve ter ao menos 3 caracteres.' }) @MaxLength(300)
  reason!: string;

  @IsOptional() @IsString() @MaxLength(80) axisApprovalRef?: string;
}

export class ListMovementsQuery {
  @IsOptional() @IsUUID('all') materialId?: string;
  @IsOptional() @IsUUID('all') locationId?: string;
  @IsOptional() @IsEnum(MovementType) type?: MovementType;
  @IsOptional() @IsDateString({}, { message: 'Data inicial inválida.' }) from?: string;
  @IsOptional() @IsDateString({}, { message: 'Data final inválida.' }) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class ListBalancesQuery {
  @IsOptional() @IsUUID('all') materialId?: string;
  @IsOptional() @IsUUID('all') warehouseId?: string;
  @IsOptional() @IsUUID('all') locationId?: string;
  @IsOptional() @IsEnum(StockCondition) condition?: StockCondition;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}
