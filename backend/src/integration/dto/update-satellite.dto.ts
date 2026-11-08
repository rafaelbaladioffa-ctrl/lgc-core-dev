import { ArrayNotEmpty, ArrayUnique, IsArray, IsString } from 'class-validator';

/** Edição da assinatura de um satélite já cadastrado (`PATCH /integration/satellites/:id`). */
export class UpdateSatelliteDto {
  /** Lista completa de eventos assinados: substitui a anterior. Só tipos do catálogo (`GET /integration/event-types`). */
  @IsArray()
  @ArrayNotEmpty({ message: 'Escolha ao menos um evento.' })
  @ArrayUnique()
  @IsString({ each: true })
  subscribedEvents!: string[];
}
