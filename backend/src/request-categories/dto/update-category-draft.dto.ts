import { IsArray, IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_SLA_MINUTES } from '../category-schema.validator.js';

/** Edição do rascunho: o que não for enviado permanece como está. */
export class UpdateCategoryDraftDto {
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
}
