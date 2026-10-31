import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { DeliveryOutcome, PickingTaskStatus } from '@prisma/client';

export class ReleasePickingDto {
  /** Aceite explícito de atendimento parcial (11.10): ordem RESERVADA_PARCIAL só libera com true. */
  @IsOptional() @IsBoolean() acceptPartial?: boolean;
  /** Força conferência independente mesmo que as regras do material não exijam. */
  @IsOptional() @IsBoolean() requireCheck?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100) priority?: number;
}

export class ScanDto {
  @IsUUID('all', { message: 'Item de separação inválido.' }) pickingItemId!: string;
  @IsUUID('all', { message: 'Endereço lido inválido.' }) locationId!: string;

  /** Material lido: por id ou por código de barras/SKU. */
  @IsOptional() @IsUUID('all', { message: 'Material inválido.' }) materialId?: string;
  @IsOptional() @IsString() @MaxLength(80) barcode?: string;

  @IsOptional() @IsUUID('all', { message: 'Lote inválido.' }) lotId?: string;
  @IsOptional() @IsUUID('all', { message: 'Número de série inválido.' }) serialId?: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }, { message: 'Quantidade inválida.' }) @IsPositive({ message: 'A quantidade deve ser maior que zero.' })
  quantity!: number;

  /** Encerra o item com o que foi separado (falta). Exige motivo (9.4.4). */
  @IsOptional() @IsBoolean() closeShort?: boolean;
  @IsOptional() @IsString() @MinLength(3, { message: 'O motivo deve ter ao menos 3 caracteres.' }) @MaxLength(300) divergenceReason?: string;
}

export class CheckDto {
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class PackageItemDto {
  @IsUUID('all', { message: 'Item de separação inválido.' }) pickingItemId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @IsPositive({ message: 'A quantidade deve ser maior que zero.' }) quantity!: number;
}

export class PackageDto {
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0, { message: 'O peso não pode ser negativo.' }) weightKg?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0, { message: 'A dimensão não pode ser negativa.' }) lengthCm?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0, { message: 'A dimensão não pode ser negativa.' }) widthCm?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0, { message: 'A dimensão não pode ser negativa.' }) heightCm?: number;
  @IsOptional() @IsString() @MaxLength(60) seal?: string;

  @IsArray() @ArrayMinSize(1, { message: 'O volume precisa ter ao menos um item.' }) @ValidateNested({ each: true }) @Type(() => PackageItemDto)
  items!: PackageItemDto[];
}

export class PackDto {
  @IsArray() @ArrayMinSize(1, { message: 'Informe ao menos um volume.' }) @ValidateNested({ each: true }) @Type(() => PackageDto)
  packages!: PackageDto[];

  @IsOptional() @IsString() @MaxLength(300) destination?: string;
}

export class DispatchDto {
  @IsString({ message: 'Informe o transportador ou responsável pela entrega.' }) @MinLength(2) @MaxLength(120) carrier!: string;
  @IsOptional() @IsString() @MaxLength(120) route?: string;
  @IsOptional() @IsString() @MaxLength(40) vehicle?: string;
  @IsOptional() @IsString() @MaxLength(300) destination?: string;
}

export class ConfirmDeliveryDto {
  @IsEnum(DeliveryOutcome, { message: 'Resultado inválido (ENTREGUE, PARCIAL ou RECUSADA).' }) outcome!: DeliveryOutcome;

  @IsString({ message: 'Informe o recebedor.' }) @MinLength(2, { message: 'O nome do recebedor deve ter ao menos 2 caracteres.' }) @MaxLength(120) receiverName!: string;
  @IsOptional() @IsString() @MaxLength(60) receiverAxisId?: string;
  @IsOptional() @IsDateString({}, { message: 'Data da entrega inválida (ISO 8601).' }) deliveredAt?: string;
  @IsOptional() @Type(() => Number) @IsLatitude({ message: 'Latitude inválida.' }) latitude?: number;
  @IsOptional() @Type(() => Number) @IsLongitude({ message: 'Longitude inválida.' }) longitude?: number;
  @IsOptional() @IsString() @MaxLength(300) signatureRef?: string;
  @IsOptional() @IsString() @MaxLength(300) photoRef?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;

  /** Obrigatório em PARCIAL: volumes efetivamente entregues. */
  @IsOptional() @IsArray() @IsUUID('all', { each: true, message: 'Volume inválido.' }) packageIds?: string[];
}

export class ListTasksQuery {
  @IsOptional() @IsEnum(PickingTaskStatus) status?: PickingTaskStatus;
  @IsOptional() @IsUUID('all') orderId?: string;
}
