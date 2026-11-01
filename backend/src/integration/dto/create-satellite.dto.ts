import { ArrayNotEmpty, IsArray, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateSatelliteDto {
  @IsString()
  @MaxLength(60)
  name!: string;

  @IsUrl({ require_tld: false })
  webhookUrl!: string;

  // Frontend humano do satélite (ex.: https://logistica.lgc.com.br) — opcional; sem isso, o
  // botão "Abrir" em Integrações não aparece pra este satélite.
  @IsOptional()
  @IsUrl({ require_tld: false })
  frontendUrl?: string;

  /** Event types this satellite subscribes to, e.g. ["collaborator.created", "ticket.escalated"]. */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  subscribedEvents!: string[];
}
