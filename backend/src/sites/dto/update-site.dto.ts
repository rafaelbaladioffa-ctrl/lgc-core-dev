import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateSiteDto } from './create-site.dto.js';

/**
 * Edição parcial. O cliente não muda depois de criado: os projetos que usam o site já foram
 * conferidos contra ele. `active = false` inativa o site (não há exclusão).
 */
export class UpdateSiteDto extends PartialType(OmitType(CreateSiteDto, ['clientId'] as const)) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
