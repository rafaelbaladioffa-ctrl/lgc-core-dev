import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateRequestCommentDto {
  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsIn(['publico', 'interno'])
  visibility?: 'publico' | 'interno';
}
