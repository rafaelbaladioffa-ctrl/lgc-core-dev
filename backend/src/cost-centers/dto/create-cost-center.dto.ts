import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateCostCenterDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsUUID()
  sectorId!: string;

  // Empty/omitted = root cost center. Code is never accepted from the client — it's generated
  // hierarchically from this (see CostCentersService.create).
  @IsOptional()
  @IsUUID()
  parentCostCenterId?: string;

  @IsOptional()
  @IsUUID()
  responsibleCollaboratorId?: string;
}
