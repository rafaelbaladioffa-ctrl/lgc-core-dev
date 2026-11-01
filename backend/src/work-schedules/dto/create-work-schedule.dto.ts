import { ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];

export class CreateWorkScheduleDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be in HH:mm format' })
  startTime!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be in HH:mm format' })
  endTime!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  breakMinutes?: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Matches(new RegExp(`^(${WEEKDAYS.join('|')})$`), { each: true, message: `daysOfWeek entries must be one of ${WEEKDAYS.join(', ')}` })
  daysOfWeek!: string[];
}
