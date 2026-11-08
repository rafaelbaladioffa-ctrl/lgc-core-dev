import { IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class UpdateProjectDto {
  /** Opcional na edição, mas não pode ser apagado (null ou vazio). */
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Informe o nome do projeto.' })
  @IsNotEmpty({ message: 'Informe o nome do projeto.' })
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @IsOptional()
  @IsUUID()
  responsibleCollaboratorId?: string;

  /** Site do mesmo cliente do projeto; `null` desvincula. */
  @IsOptional()
  @IsUUID()
  siteId?: string | null;

  /** AAAA-MM-DD; `null` apaga a data. */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Início previsto inválido.' })
  @Matches(DATE_ONLY, { message: 'Início previsto inválido.' })
  plannedStartDate?: string | null;

  /** AAAA-MM-DD; `null` apaga a data. */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Conclusão prevista inválida.' })
  @Matches(DATE_ONLY, { message: 'Conclusão prevista inválida.' })
  plannedEndDate?: string | null;
}
