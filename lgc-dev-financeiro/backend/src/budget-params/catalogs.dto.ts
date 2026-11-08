import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { decimalPattern } from './parameter-sets.dto.js';

const nullable = () => ValidateIf((_o, v) => v !== null && v !== undefined);

export class CreateMaterialDto {
  @IsString({ message: 'Informe o nome do item.' })
  @Length(2, 120, { message: 'Nome do item: 2 a 120 caracteres.' })
  name!: string;

  @nullable()
  @IsString()
  @MaxLength(80, { message: 'Fabricante: até 80 caracteres.' })
  manufacturer?: string | null;

  @nullable()
  @IsString()
  @MaxLength(80, { message: 'Código: até 80 caracteres.' })
  partNumber?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 10, { message: 'Unidade: 1 a 10 caracteres (ex.: un, m, cx).' })
  unit?: string;

  @Matches(decimalPattern(10, 4), { message: 'Preço cobrado: número com até 4 casas decimais (ex.: 12.5).' })
  billedPrice!: string;

  @nullable()
  @Matches(decimalPattern(10, 4), { message: 'Custo real: número com até 4 casas decimais.' })
  realCost?: string | null;

  @nullable()
  @IsString()
  @MaxLength(60, { message: 'Referência no formulário do cliente: até 60 caracteres.' })
  clientRef?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'Ativo: sim ou não.' })
  active?: boolean;
}

/** Mesmos campos, todos opcionais. */
export class UpdateMaterialDto {
  @IsOptional()
  @IsString({ message: 'Informe o nome do item.' })
  @Length(2, 120, { message: 'Nome do item: 2 a 120 caracteres.' })
  name?: string;

  @nullable()
  @IsString()
  @MaxLength(80, { message: 'Fabricante: até 80 caracteres.' })
  manufacturer?: string | null;

  @nullable()
  @IsString()
  @MaxLength(80, { message: 'Código: até 80 caracteres.' })
  partNumber?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 10, { message: 'Unidade: 1 a 10 caracteres (ex.: un, m, cx).' })
  unit?: string;

  @IsOptional()
  @Matches(decimalPattern(10, 4), { message: 'Preço cobrado: número com até 4 casas decimais (ex.: 12.5).' })
  billedPrice?: string;

  @nullable()
  @Matches(decimalPattern(10, 4), { message: 'Custo real: número com até 4 casas decimais.' })
  realCost?: string | null;

  @nullable()
  @IsString()
  @MaxLength(60, { message: 'Referência no formulário do cliente: até 60 caracteres.' })
  clientRef?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'Ativo: sim ou não.' })
  active?: boolean;
}

export class CreateDestinationDto {
  @IsString({ message: 'Informe o nome do destino.' })
  @Length(2, 120, { message: 'Destino: 2 a 120 caracteres.' })
  name!: string;

  @Matches(decimalPattern(6, 2), { message: 'Km ida e volta: número com até 2 casas decimais.' })
  kmRoundTrip!: string;

  @IsOptional()
  @Matches(decimalPattern(8, 2), { message: 'Pedágio por dia: número com até 2 casas decimais.' })
  tollPerDay?: string;

  @nullable()
  @IsString()
  @MaxLength(300, { message: 'Rota / fonte: até 300 caracteres.' })
  routeNotes?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'Ativo: sim ou não.' })
  active?: boolean;
}

/** Mesmos campos, todos opcionais. */
export class UpdateDestinationDto {
  @IsOptional()
  @IsString({ message: 'Informe o nome do destino.' })
  @Length(2, 120, { message: 'Destino: 2 a 120 caracteres.' })
  name?: string;

  @IsOptional()
  @Matches(decimalPattern(6, 2), { message: 'Km ida e volta: número com até 2 casas decimais.' })
  kmRoundTrip?: string;

  @IsOptional()
  @Matches(decimalPattern(8, 2), { message: 'Pedágio por dia: número com até 2 casas decimais.' })
  tollPerDay?: string;

  @nullable()
  @IsString()
  @MaxLength(300, { message: 'Rota / fonte: até 300 caracteres.' })
  routeNotes?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'Ativo: sim ou não.' })
  active?: boolean;
}
