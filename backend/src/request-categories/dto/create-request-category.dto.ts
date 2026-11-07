import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Max, Min } from 'class-validator';
import { CATEGORY_CODE_REGEX, CATEGORY_KINDS, CONFIDENTIALITIES, MAX_SLA_MINUTES } from '../category-schema.validator.js';

/** Cria a categoria e a versão 1 em **rascunho**. O conteúdo (formulário, fluxo, SLA) é
 * opcional na criação e validado a fundo (category-schema.validator) quando enviado. */
export class CreateRequestCategoryDto {
  @IsString()
  @MaxLength(40)
  @Matches(CATEGORY_CODE_REGEX, { message: 'code: use letras maiúsculas, números e "-", começando por letra (2 a 40 caracteres).' })
  code!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsUUID()
  sectorId!: string;

  /** Só pode ser definido aqui; não muda depois. */
  @IsOptional()
  @IsIn(CATEGORY_KINDS)
  kind?: (typeof CATEGORY_KINDS)[number];

  @IsOptional()
  @IsIn(CONFIDENTIALITIES)
  confidentiality?: (typeof CONFIDENTIALITIES)[number];

  @IsOptional()
  @IsArray()
  formSchema?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  workflowSchema?: Record<string, unknown>[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SLA_MINUTES)
  slaFirstResponseMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SLA_MINUTES)
  slaResolutionMinutes?: number;

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
