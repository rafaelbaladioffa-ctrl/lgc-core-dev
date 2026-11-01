import { IsOptional, IsUUID } from 'class-validator';

export class UpdateProjectDto {
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @IsOptional()
  @IsUUID()
  responsibleCollaboratorId?: string;
}
