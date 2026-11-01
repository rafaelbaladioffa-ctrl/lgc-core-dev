import { ArrayMinSize, IsArray, IsIn, IsNumberString, IsOptional, IsUUID } from 'class-validator';

const LEVELS = ['colaborador', 'supervisor', 'coordenador', 'gerente', 'diretor'] as const;

export class CreateApprovalAuthorityRuleDto {
  @IsOptional()
  @IsUUID()
  sectorId?: string;

  @IsNumberString()
  minValue!: string;

  @IsOptional()
  @IsNumberString()
  maxValue?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(LEVELS, { each: true })
  levels!: Array<(typeof LEVELS)[number]>;
}
