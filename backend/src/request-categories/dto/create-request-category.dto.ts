import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';

const CONFIDENTIALITY = ['interna', 'confidencial', 'restrita'] as const;

/** Creates a category AND its first published version in one call — there is no separate
 * draft/publish admin UI in Fase 1 (REQUISICOES_SPEC.md §23 defers that to later phases); the
 * catalog is seeded as data, extensible later without a migration. */
export class CreateRequestCategoryDto {
  @IsString()
  @MaxLength(40)
  code!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsUUID()
  sectorId!: string;

  @IsOptional()
  @IsUUID()
  parentCategoryId?: string;

  @IsOptional()
  @IsIn(CONFIDENTIALITY)
  confidentiality?: 'interna' | 'confidencial' | 'restrita';

  @IsArray()
  formSchema!: Record<string, unknown>[];

  @IsArray()
  workflowSchema!: Record<string, unknown>[];

  @IsInt()
  @Min(1)
  slaFirstResponseMinutes!: number;

  @IsInt()
  @Min(1)
  slaResolutionMinutes!: number;

  // §15.2/§11: categorias de entrega/mudança/serviço exigem aceite do solicitante antes de
  // ENCERRADA — ver RequestsService.close.
  @IsOptional()
  @IsBoolean()
  requiresAcceptance?: boolean;

  // §9.2: resolve a cadeia de aprovação pela matriz de alçada por valor em vez do
  // workflowSchema fixo — ver RequestsService.triage/findAuthorityRule.
  @IsOptional()
  @IsBoolean()
  useDynamicAuthority?: boolean;
}
