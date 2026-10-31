import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { LocationLevel, WarehouseType } from '@prisma/client';

export class CreateWarehouseDto {
  @Matches(/^[A-Z0-9]+(-[A-Z0-9]+)*$/, { message: 'Código inválido. Use maiúsculas, números e hífens (ex.: ALM-CENTRAL).' }) @MaxLength(30)
  code!: string;

  @IsString({ message: 'Informe o nome.' }) @MinLength(3, { message: 'O nome deve ter ao menos 3 caracteres.' }) @MaxLength(120)
  name!: string;

  @IsEnum(WarehouseType, { message: 'Tipo de almoxarifado inválido.' })
  type!: WarehouseType;

  @IsOptional() @IsString() @MaxLength(60) companyAxisId?: string;
  @IsOptional() @IsString() @MaxLength(60) unitAxisId?: string;
  @IsOptional() @IsString() @MaxLength(60) projectAxisId?: string;
  @IsOptional() @IsString() @MaxLength(60) responsibleAxisUserId?: string;
  @IsOptional() @IsString() @MaxLength(300) addressText?: string;
}

export class CreateLocationDto {
  @Matches(/^[A-Z0-9]+(-[A-Z0-9]+)*$/, { message: 'Código inválido. Use maiúsculas, números e hífens (ex.: A01-C02-E03).' }) @MaxLength(40)
  code!: string;

  @IsEnum(LocationLevel, { message: 'Nível de endereço inválido.' })
  level!: LocationLevel;

  @IsOptional() @IsUUID('all', { message: 'Endereço pai inválido.' }) parentId?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
}
