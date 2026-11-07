import { ArrayMinSize, IsArray, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PurchaseDeliveryDto {
  @IsString()
  @IsNotEmpty()
  groupId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  orderNumber?: string;

  /** Data (aaaa-mm-dd) em que o pedido foi feito ao fornecedor. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'orderDate deve estar no formato aaaa-mm-dd' })
  @IsISO8601({ strict: true })
  orderDate!: string;

  /** Data (aaaa-mm-dd) prevista para a entrega; não pode ser anterior à data do pedido. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expectedDeliveryDate deve estar no formato aaaa-mm-dd' })
  @IsISO8601({ strict: true })
  expectedDeliveryDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class PurchaseOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseDeliveryDto)
  deliveries!: PurchaseDeliveryDto[];
}

export class ConfirmReceiptDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  groupIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
