import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PurchaseAnalysisItemDto {
  @IsUUID()
  materialId!: string;

  @IsIn(['disponivel', 'parcial', 'indisponivel'])
  stockStatus!: 'disponivel' | 'parcial' | 'indisponivel';

  @IsInt()
  @Min(0)
  availableQuantity!: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  needsQuotation?: boolean;
}

export class PurchaseAnalysisDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseAnalysisItemDto)
  items!: PurchaseAnalysisItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
