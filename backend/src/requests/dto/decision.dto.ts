import { IsOptional, IsString } from 'class-validator';

export class ApproveRequestDto {
  @IsOptional()
  @IsString()
  comment?: string;
}

export class RejectRequestDto {
  @IsString()
  comment!: string;
}
