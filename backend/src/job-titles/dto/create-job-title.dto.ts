import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateJobTitleDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isTechnician?: boolean;
}
