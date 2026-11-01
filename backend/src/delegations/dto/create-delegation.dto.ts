import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class CreateDelegationDto {
  @IsUUID()
  delegateId!: string;

  @IsOptional()
  @IsUUID()
  sectorId?: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;
}
