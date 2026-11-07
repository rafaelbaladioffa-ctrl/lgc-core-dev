import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ReturnForAdjustmentDto {
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason!: string;
}

export class RequestInformationDto {
  @IsString()
  @MinLength(1)
  question!: string;
}

export class ResumeRequestDto {
  @IsOptional()
  @IsString()
  answer?: string;
}

export class CompleteRequestDto {
  @IsString()
  @MinLength(1)
  resolution!: string;
}

export class CancelRequestDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}

export class ReopenRequestDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
