import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Criticality, DemandClass, ExitMethod, MaterialType } from '@prisma/client';

const CODE_REGEX = /^[A-Z0-9]+(-[A-Z0-9]+)+$/;

/** Campos editáveis do material; criação exige os obrigatórios (7.1), atualização é parcial. */
export class MaterialFieldsDto {
  @IsOptional() @IsString({ message: 'Descrição curta inválida.' }) @MinLength(3, { message: 'A descrição curta deve ter ao menos 3 caracteres.' }) @MaxLength(160, { message: 'A descrição curta deve ter no máximo 160 caracteres.' })
  shortDescription?: string;

  @IsOptional() @IsString() @MaxLength(4000, { message: 'A descrição técnica deve ter no máximo 4000 caracteres.' })
  technicalDescription?: string;

  @IsOptional() @IsString() @MinLength(2, { message: 'Informe a categoria.' }) @MaxLength(80)
  category?: string;

  @IsOptional() @IsString() @MaxLength(80)
  subcategory?: string;

  @IsOptional() @IsEnum(MaterialType, { message: 'Tipo de material inválido.' })
  type?: MaterialType;

  @IsOptional() @IsUUID('all', { message: 'Unidade de estoque inválida.' })
  stockUomId?: string;

  @IsOptional() @IsString() @MaxLength(80) manufacturer?: string;
  @IsOptional() @IsString() @MaxLength(80) brand?: string;
  @IsOptional() @IsString() @MaxLength(80) model?: string;
  @IsOptional() @IsString() @MaxLength(80) manufacturerCode?: string;
  @IsOptional() @Matches(/^\d{8}$/, { message: 'NCM deve ter 8 dígitos.' }) ncm?: string;
  @IsOptional() @Matches(/^\d{7}$/, { message: 'CEST deve ter 7 dígitos.' }) cest?: string;

  @IsOptional() @IsBoolean({ message: 'Valor inválido para controle por lote.' }) lotControlled?: boolean;
  @IsOptional() @IsBoolean() expiryControlled?: boolean;
  @IsOptional() @IsInt({ message: 'A vida útil mínima deve ser um número inteiro de dias.' }) @Min(0) @Max(36500) minShelfLifeDays?: number;
  @IsOptional() @IsBoolean() serialControlled?: boolean;
  @IsOptional() @IsBoolean() assetTagged?: boolean;
  @IsOptional() @IsBoolean() requiresCertificate?: boolean;
  @IsOptional() @IsBoolean() requiresCalibration?: boolean;
  @IsOptional() @IsBoolean() requiresCa?: boolean;
  @IsOptional() @IsBoolean() hasSizeGrid?: boolean;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }, { message: 'Peso inválido.' }) @Min(0, { message: 'O peso não pode ser negativo.' }) weightKg?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0, { message: 'A dimensão não pode ser negativa.' }) lengthCm?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0, { message: 'A dimensão não pode ser negativa.' }) widthCm?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0, { message: 'A dimensão não pode ser negativa.' }) heightCm?: number;

  @IsOptional() @IsString() @MaxLength(200) storageCondition?: string;
  @IsOptional() @IsString() @MaxLength(80) riskClass?: string;
  @IsOptional() @IsEnum(ExitMethod, { message: 'Método de saída inválido (FIFO, FEFO ou SERIE_ESPECIFICA).' }) exitMethod?: ExitMethod;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0, { message: 'O múltiplo de compra não pode ser negativo.' }) purchaseMultiple?: number;
  @IsOptional() @IsInt() @Min(0, { message: 'O lead time não pode ser negativo.' }) @Max(3650) leadTimeDays?: number;
  @IsOptional() @IsEnum(Criticality, { message: 'Criticidade inválida (A, B ou C).' }) criticality?: Criticality;
  @IsOptional() @IsEnum(DemandClass, { message: 'Classe de demanda inválida (X, Y ou Z).' }) demandClass?: DemandClass;
  @IsOptional() @IsBoolean() requiresAuthorization?: boolean;
  @IsOptional() @IsString() @MaxLength(40) authorizationBy?: string;
  @IsOptional() @IsBoolean() returnable?: boolean;
  @IsOptional() @IsBoolean() repairable?: boolean;
  @IsOptional() @IsBoolean() calibratable?: boolean;
  @IsOptional() @IsBoolean() leased?: boolean;
  @IsOptional() @IsBoolean() disposable?: boolean;
}

export class CreateMaterialDto extends MaterialFieldsDto {
  @Matches(CODE_REGEX, { message: 'Código inválido. Use maiúsculas, números e hífens (ex.: EPI-CAP-0001).' }) @MaxLength(40)
  code!: string;

  @IsString({ message: 'Informe a descrição curta.' }) @MinLength(3, { message: 'A descrição curta deve ter ao menos 3 caracteres.' }) @MaxLength(160)
  declare shortDescription: string;

  @IsString({ message: 'Informe a categoria.' }) @MinLength(2, { message: 'Informe a categoria.' }) @MaxLength(80)
  declare category: string;

  @IsEnum(MaterialType, { message: 'Informe o tipo de material.' })
  declare type: MaterialType;

  @IsUUID('all', { message: 'Informe a unidade de estoque.' })
  declare stockUomId: string;
}

export class UpdateMaterialDto extends MaterialFieldsDto {
  @IsOptional() @IsString() @MaxLength(300) changeReason?: string;
}

export class ListMaterialsQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsEnum(MaterialType) type?: MaterialType;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsEnum(['ATIVO', 'INATIVO', 'SUBSTITUIDO']) status?: 'ATIVO' | 'INATIVO' | 'SUBSTITUIDO';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
