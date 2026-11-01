import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateSectorDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  // Empty/omitted = root sector. Code is never accepted from the client — it's generated
  // hierarchically from this (see SectorsService.create).
  @IsOptional()
  @IsUUID()
  parentSectorId?: string;

  @IsOptional()
  @IsUUID()
  responsibleCollaboratorId?: string;
}
