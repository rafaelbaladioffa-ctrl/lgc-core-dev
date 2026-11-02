import { IsString, IsUUID } from 'class-validator';

export class PurchaseQuotationSelectionDto {
  @IsString()
  @IsUUID('4')
  quotationId!: string;
}
