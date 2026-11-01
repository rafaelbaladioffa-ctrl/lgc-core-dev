import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { FulfillmentStatus } from '@prisma/client';

export class FulfillmentItemDto {
  @IsOptional() @IsUUID('all', { message: 'Material inválido.' }) materialId?: string;
  @IsOptional() @IsString() @MaxLength(40) materialCode?: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }, { message: 'Quantidade inválida.' }) @IsPositive({ message: 'A quantidade deve ser maior que zero.' })
  quantity!: number;

  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

/** Contrato interno de domínio de `material_request.approved` (0.4); o adaptador do ticket produz este formato. */
export class CreateFulfillmentDto {
  @IsString({ message: 'Informe a requisição de origem no Axis.' }) @MinLength(1) @MaxLength(80)
  axisRequestId!: string;

  @IsOptional() @IsInt() @Min(1) @Max(10000) requestVersion?: number;

  @IsOptional() @IsUUID('all', { message: 'Almoxarifado inválido.' }) warehouseId?: string;
  @IsOptional() @IsString() @MaxLength(30) warehouseCode?: string;
  @IsOptional() @IsString() @MaxLength(60) projectAxisId?: string;
  @IsOptional() @IsString() @MaxLength(60) costCenterAxisId?: string;
  @IsOptional() @IsString() @MaxLength(60) requesterAxisId?: string;
  @IsOptional() @IsString() @MaxLength(60) recipientAxisId?: string;
  @IsOptional() @IsDateString({ strict: true }, { message: 'Data necessária inválida (AAAA-MM-DD).' }) neededBy?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;

  @IsArray({ message: 'Informe os itens.' }) @ArrayMinSize(1, { message: 'Informe ao menos um item.' }) @ArrayMaxSize(200, { message: 'No máximo 200 itens.' })
  @ValidateNested({ each: true }) @Type(() => FulfillmentItemDto)
  items!: FulfillmentItemDto[];
}

export class CancelRequestDto {
  @IsString({ message: 'Informe o motivo.' }) @MinLength(3, { message: 'O motivo deve ter ao menos 3 caracteres.' }) @MaxLength(300)
  reason!: string;
}

export class ListFulfillmentQuery {
  @IsOptional() @IsEnum(FulfillmentStatus, { message: 'Status inválido.' }) status?: FulfillmentStatus;
  @IsOptional() @IsString() @MaxLength(80) axisRequestId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
