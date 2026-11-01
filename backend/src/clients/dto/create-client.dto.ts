import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateClientDto {
  @IsString()
  @MaxLength(255)
  legalName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(18)
  cnpj?: string;

  @IsOptional()
  @IsObject()
  contacts?: Array<{ name: string; phone?: string; email?: string }>;

  @IsOptional()
  @IsObject()
  address?: Record<string, unknown>;
}
