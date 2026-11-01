import { IsDateString, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateHolidayDto {
  @IsDateString()
  date!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}
