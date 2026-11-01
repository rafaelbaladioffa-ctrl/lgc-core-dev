import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { InspectionDecision } from '@prisma/client';

export class ExpectedItemDto {
  @IsOptional() @IsUUID('all', { message: 'Material inválido.' }) materialId?: string;
  @IsOptional() @IsString() @MaxLength(40) materialCode?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @IsPositive({ message: 'A quantidade deve ser maior que zero.' }) quantity!: number;
}

export class CreateReceiptDto {
  @IsUUID('all', { message: 'Almoxarifado inválido.' }) warehouseId!: string;
  /** Endereço de recebimento/doca onde a mercadoria dá entrada antes da armazenagem. */
  @IsUUID('all', { message: 'Endereço de recebimento inválido.' }) receivingLocationId!: string;
  @IsOptional() @IsString() @MaxLength(60) axisPurchaseOrderId?: string;
  @IsOptional() @IsString() @MaxLength(60) supplierAxisId?: string;
  @IsOptional() @IsString() @MaxLength(60) invoiceNumber?: string;
  @IsOptional() @IsString() @MaxLength(40) vehicle?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) volumes?: number;
  /** Recebimento sem pedido do Axis exige exceção aprovada (9.2). */
  @IsOptional() @IsString() @MaxLength(80) exceptionApprovalRef?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ExpectedItemDto)
  expectedItems?: ExpectedItemDto[];
}

export class ScanReceiptItemDto {
  @IsOptional() @IsUUID('all', { message: 'Material inválido.' }) materialId?: string;
  @IsOptional() @IsString() @MaxLength(80) barcode?: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }, { message: 'Quantidade inválida.' }) @IsPositive({ message: 'A quantidade deve ser maior que zero.' })
  quantity!: number;

  @IsOptional() @IsString() @MaxLength(60) lotNumber?: string;
  @IsOptional() @IsDateString({ strict: true }, { message: 'Data de fabricação inválida (AAAA-MM-DD).' }) manufacturedAt?: string;
  @IsOptional() @IsDateString({ strict: true }, { message: 'Data de validade inválida (AAAA-MM-DD).' }) expiresAt?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsString({ each: true }) @MaxLength(80, { each: true }) serials?: string[];
  @IsOptional() @IsBoolean() damaged?: boolean;
  @IsOptional() @IsBoolean() forceInspection?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0, { message: 'O custo unitário não pode ser negativo.' }) unitCost?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) photoRefs?: string[];
  @IsOptional() @IsString() @MaxLength(300) certificateRef?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class InspectDto {
  @IsEnum(InspectionDecision, { message: 'Decisão inválida (APROVADO ou REPROVADO).' }) decision!: InspectionDecision;
  @IsOptional() @IsObject() checklist?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(300) certificateRef?: string;
  @IsString({ message: 'Informe o parecer.' }) @MinLength(3, { message: 'O parecer deve ter ao menos 3 caracteres.' }) @MaxLength(500) notes!: string;
}

export class ConfirmPutawayDto {
  @IsUUID('all', { message: 'Endereço lido inválido.' }) locationId!: string;
}
