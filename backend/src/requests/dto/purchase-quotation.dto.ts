import { IsArray, IsBoolean, IsNumberString, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class PurchaseQuotationDto {
  @IsOptional()
  @IsString()
  quotationId?: string;
  @IsString()
  @MinLength(2)
  supplier!: string;

  @IsOptional()
  @IsString()
  quoteNumber?: string;

  @IsNumberString()
  totalValue!: string;

  @IsOptional()
  @IsBoolean()
  selected?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  attachmentIds?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}
