import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ProjectStatus } from '@prisma/client';

export class UpdateProjectStatusDto {
  @IsEnum(ProjectStatus)
  status!: ProjectStatus;

  /** Só com `status: aprovado` (PA-07): cotação (revisão) que o cliente aceitou; padrão = a vigente. */
  @IsOptional()
  @IsUUID('all', { message: 'Cotação aceita inválida.' })
  acceptedQuoteId?: string;

  /** Só com `status: aprovado`: número do pedido de compra (PO) do cliente. O arquivo do PO vai como documento `po`. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  @MaxLength(60)
  clientPoNumber?: string;
}

/** Os campos da aprovação do projeto (`PUT /projects/:id/status` com `status: aprovado`). */
export type ApproveProjectDto = Pick<UpdateProjectStatusDto, 'acceptedQuoteId' | 'clientPoNumber'>;
