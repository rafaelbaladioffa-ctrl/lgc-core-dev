import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PurchaseSelectionDto {
  @IsString()
  @IsNotEmpty()
  materialId!: string;

  @IsString()
  @IsNotEmpty()
  quotationId!: string;
}

export const PURCHASE_DECISIONS = ['aprovar', 'reprovar', 'devolver_suprimentos'] as const;
export type PurchaseDecision = (typeof PURCHASE_DECISIONS)[number];

export class PurchaseDecisionDto {
  @IsIn(PURCHASE_DECISIONS)
  decision!: PurchaseDecision;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseSelectionDto)
  selections?: PurchaseSelectionDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
