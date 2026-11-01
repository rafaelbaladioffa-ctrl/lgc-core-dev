import { IsEnum } from 'class-validator';
import { ProjectStatus } from '@prisma/client';

export class UpdateProjectStatusDto {
  @IsEnum(ProjectStatus)
  status!: ProjectStatus;
}
