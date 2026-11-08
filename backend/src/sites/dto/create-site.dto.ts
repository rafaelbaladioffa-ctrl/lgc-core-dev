import { Transform } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Campo opcional de texto: vazio vira `null` (apaga na edição). */
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const upperTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export const SITE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;

/**
 * Campos comuns de criação e edição. Endereço no mesmo padrão de colunas do cliente
 * (cep, address_*); o CEP guarda só os 8 dígitos.
 */
export class SiteFieldsDto {
  /** Código informado por quem cadastra (ex.: GRU53), em maiúsculas, único dentro do cliente. */
  @Transform(upperTrim)
  @IsString({ message: 'Informe o código do site.' })
  @IsNotEmpty({ message: 'Informe o código do site.' })
  @Matches(SITE_CODE_PATTERN, { message: 'Código do site inválido. Use letras, números, ponto, hífen ou sublinhado (até 20 caracteres).' })
  code!: string;

  @Transform(trim)
  @IsString({ message: 'Informe o nome do site.' })
  @IsNotEmpty({ message: 'Informe o nome do site.' })
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') || null : value))
  @Matches(/^\d{8}$/, { message: 'CEP inválido.' })
  cep?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(255)
  addressStreet?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(30)
  addressNumber?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(100)
  addressComplement?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(100)
  addressDistrict?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(100)
  addressCity?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value))
  @Matches(/^[A-Z]{2}$/, { message: 'UF inválida. Use a sigla com duas letras.' })
  addressState?: string | null;

  @IsOptional()
  @IsLatitude({ message: 'Latitude inválida.' })
  latitude?: number | null;

  @IsOptional()
  @IsLongitude({ message: 'Longitude inválida.' })
  longitude?: number | null;
}

export class CreateSiteDto extends SiteFieldsDto {
  @IsUUID(undefined, { message: 'Selecione o cliente.' })
  clientId!: string;
}
