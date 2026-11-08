import { IsEmail, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// Campos opcionais aceitam `null` para limpar o valor na edição (`@IsOptional` ignora null/undefined).
export class CreateClientDto {
  @IsString()
  @MaxLength(255)
  legalName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  tradeName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(18)
  cnpj?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid e-mail address' })
  @MaxLength(255)
  email?: string | null;

  // Endereço: a tela preenche pelo CEP (ViaCEP), mas todos os campos continuam editáveis,
  // porque o ViaCEP às vezes vem incompleto ou errado.
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'cep must be in the format 00000-000 or 00000000' })
  cep?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressStreet?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  addressNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  addressComplement?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  addressDistrict?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  addressCity?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: 'addressState must be a 2-letter UF' })
  addressState?: string | null;

  /** Legado: JSON livre, sem campo na tela. */
  @IsOptional()
  @IsObject()
  contacts?: Array<{ name: string; phone?: string; email?: string }>;

  /** Legado: JSON livre, sem campo na tela. Use os campos address* acima. */
  @IsOptional()
  @IsObject()
  address?: Record<string, unknown>;
}
