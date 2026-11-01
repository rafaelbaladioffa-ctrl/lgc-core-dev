import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class TransferItemDto {
  @IsOptional() @IsUUID('all', { message: 'Material inválido.' }) materialId?: string;
  @IsOptional() @IsString() @MaxLength(40) materialCode?: string;
  @IsUUID('all', { message: 'Endereço de origem inválido.' }) fromLocationId!: string;
  @IsOptional() @IsUUID('all', { message: 'Lote inválido.' }) lotId?: string;
  @IsOptional() @IsUUID('all', { message: 'Número de série inválido.' }) serialId?: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }, { message: 'Quantidade inválida.' }) @IsPositive({ message: 'A quantidade deve ser maior que zero.' })
  quantity!: number;
}

export class CreateTransferDto {
  @IsUUID('all', { message: 'Almoxarifado de destino inválido.' }) toWarehouseId!: string;
  @IsString({ message: 'Informe o motivo.' }) @MinLength(3, { message: 'O motivo deve ter ao menos 3 caracteres.' }) @MaxLength(300) reason!: string;
  /** Fluxo simplificado (9.7): expede direto após aprovação, com auditoria. */
  @IsOptional() @IsBoolean() urgent?: boolean;

  @IsArray() @ArrayMinSize(1, { message: 'Informe ao menos um item.' }) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => TransferItemDto)
  items!: TransferItemDto[];
}

export class ReceiveItemDto {
  @IsUUID('all', { message: 'Item de transferência inválido.' }) itemId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0, { message: 'A quantidade recebida não pode ser negativa.' }) receivedQty!: number;
  @IsUUID('all', { message: 'Endereço de destino inválido.' }) toLocationId!: string;
}

export class ReceiveTransferDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReceiveItemDto) items!: ReceiveItemDto[];
}

export class CancelTransferDto {
  @IsString({ message: 'Informe o motivo.' }) @MinLength(3, { message: 'O motivo deve ter ao menos 3 caracteres.' }) @MaxLength(300) reason!: string;
}
