import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PurchaseQuotationItemDto {
  @IsString()
  @IsNotEmpty()
  materialId!: string;

  /** Decimal em texto, maior que zero, com até 4 casas (ponto como separador). */
  @IsString()
  @Matches(/^\d{1,12}(\.\d{1,4})?$/, { message: 'unitPrice deve ser um decimal com até 4 casas.' })
  unitPrice!: string;
}

export class PurchaseQuotationDto {
  /** Ausente = cotação nova (o servidor gera o identificador). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  quotationId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  supplier!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  quoteNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  attachmentIds?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseQuotationItemDto)
  items!: PurchaseQuotationItemDto[];
}
