import { IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ProjectStatus } from '@prisma/client';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateProjectDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Informe o nome do projeto.' })
  @IsNotEmpty({ message: 'Informe o nome do projeto.' })
  @MaxLength(200)
  name!: string;

  @IsUUID()
  clientId!: string;

  @IsUUID()
  costCenterId!: string;

  @IsUUID()
  responsibleCollaboratorId!: string;

  /** Site do cliente onde a obra acontece. Opcional por enquanto; obrigatório só para aprovar o projeto. */
  @IsOptional()
  @IsUUID()
  siteId?: string | null;

  /** Data no formato AAAA-MM-DD. */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Início previsto inválido.' })
  @Matches(DATE_ONLY, { message: 'Início previsto inválido.' })
  plannedStartDate?: string | null;

  /** Data no formato AAAA-MM-DD. */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Conclusão prevista inválida.' })
  @Matches(DATE_ONLY, { message: 'Conclusão prevista inválida.' })
  plannedEndDate?: string | null;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}
