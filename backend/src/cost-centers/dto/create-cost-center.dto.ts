import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { CostCenterKind } from '@prisma/client';

/** Sigla do centro de custo (docs/integracao-centros-de-custo.md §1): maiúsculas, dígitos e hífen. */
export const COST_CENTER_SHORT_CODE_PATTERN = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

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

  /** Omitido = `administrativo` (padrão do banco). */
  @IsOptional()
  @IsEnum(CostCenterKind)
  kind?: CostCenterKind;

  /** Sigla legível opcional e única (ex.: `DC-001-JAI`). Vazio ou `null` limpa. Normalizada para maiúsculas. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value))
  @IsString()
  @MaxLength(30)
  @Matches(COST_CENTER_SHORT_CODE_PATTERN, { message: 'shortCode must use only uppercase letters, digits and hyphens (e.g. DC-001-JAI)' })
  shortCode?: string | null;
}
