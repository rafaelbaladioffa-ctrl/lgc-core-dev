import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsEnum, IsOptional, Matches } from 'class-validator';
import { CollaboratorStatus } from '@prisma/client';
import { CreateCollaboratorDto } from './create-collaborator.dto.js';

export class UpdateCollaboratorDto extends PartialType(CreateCollaboratorDto) {
  // Not on CreateCollaboratorDto: every new collaborator starts "ativo" — status transitions
  // (ativo/afastado/ferias/desligado) only make sense on an existing record. Changing to
  // "desligado" here has the same effect as POST :id/offboard (offboarded_at, allocation closed,
  // collaborator.offboarded) — see CollaboratorsService.update.
  @IsOptional()
  @IsEnum(CollaboratorStatus)
  status?: CollaboratorStatus;

  /** Início da nova alocação quando `costCenterId` muda (`AAAA-MM-DD`). Padrão: hoje em São Paulo.
   * Não pode ser anterior ao início da alocação vigente (docs/integracao-centros-de-custo.md §2). */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'costCenterEffectiveFrom must be a date in YYYY-MM-DD format' })
  @IsDateString({ strict: true })
  costCenterEffectiveFrom?: string;
}
