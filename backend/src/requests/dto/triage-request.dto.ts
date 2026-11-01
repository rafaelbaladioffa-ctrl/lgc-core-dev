import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class TriageRequestDto {
  @IsIn(['aceitar', 'devolver', 'recategorizar'])
  action!: 'aceitar' | 'devolver' | 'recategorizar';

  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;

  @IsOptional()
  @IsUUID()
  newCategoryId?: string;
}
