import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { CustodyStatus, ReturnDisposition, ReturnType } from '@prisma/client';

export class ReturnItemDto {
  @IsUUID('all', { message: 'Material inválido.' }) materialId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }, { message: 'Quantidade inválida.' }) @IsPositive({ message: 'A quantidade deve ser maior que zero.' }) quantity!: number;
  @IsOptional() @IsUUID('all', { message: 'Lote inválido.' }) lotId?: string;
  @IsOptional() @IsUUID('all', { message: 'Número de série inválido.' }) serialId?: string;
}

export class CreateReturnDto {
  @IsEnum(ReturnType, { message: 'Tipo de devolução inválido.' }) type!: ReturnType;
  @IsUUID('all', { message: 'Almoxarifado inválido.' }) warehouseId!: string;
  @IsUUID('all', { message: 'Endereço de recebimento inválido.' }) receivingLocationId!: string;
  @IsOptional() @IsString() @MaxLength(60) returnedByAxisId?: string;
  @IsOptional() @IsString() @MaxLength(60) projectAxisId?: string;
  @IsOptional() @IsUUID('all', { message: 'Termo de custódia inválido.' }) custodyTermId?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;

  @IsArray() @ArrayMinSize(1, { message: 'Informe ao menos um item.' }) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ReturnItemDto)
  items!: ReturnItemDto[];
}

export class ClassifyDto {
  @IsEnum(ReturnDisposition, { message: 'Destinação inválida (DISPONIVEL, MANUTENCAO, QUARENTENA, AVARIADO_REPARO ou SUCATA).' }) disposition!: ReturnDisposition;
  /** Obrigatório para SUCATA/descarte (aprovação de alçada no Axis). */
  @IsOptional() @IsString() @MaxLength(80) approvalRef?: string;
  @IsString({ message: 'Informe o parecer da inspeção.' }) @MinLength(3, { message: 'O parecer deve ter ao menos 3 caracteres.' }) @MaxLength(500) notes!: string;
}

export class CloseCustodyDto {
  @IsString({ message: 'Informe o motivo.' }) @MinLength(3, { message: 'O motivo deve ter ao menos 3 caracteres.' }) @MaxLength(500) notes!: string;
  /** Baixa por perda/extravio exige aprovação do Axis. */
  @IsString({ message: 'Informe a aprovação do Axis.' }) @MaxLength(80) approvalRef!: string;
}

export class ListCustodyQuery {
  @IsOptional() @IsString() @MaxLength(60) custodianAxisId?: string;
  @IsOptional() @IsEnum(CustodyStatus) status?: CustodyStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
