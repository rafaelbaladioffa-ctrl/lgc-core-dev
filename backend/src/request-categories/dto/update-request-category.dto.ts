import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CONFIDENTIALITIES } from '../category-schema.validator.js';

/** Dados da categoria (não da versão). `code` e `kind` não mudam depois de criados. */
export class UpdateRequestCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  /** Afeta só requisições novas. */
  @IsOptional()
  @IsUUID()
  sectorId?: string;

  @IsOptional()
  @IsIn(CONFIDENTIALITIES)
  confidentiality?: (typeof CONFIDENTIALITIES)[number];

  @IsOptional()
  @IsBoolean()
  requiresAcceptance?: boolean;

  @IsOptional()
  @IsBoolean()
  useDynamicAuthority?: boolean;

  /** Desativar tira a categoria do catálogo e impede novas requisições; as abertas seguem. */
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
