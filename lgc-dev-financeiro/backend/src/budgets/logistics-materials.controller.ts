import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { LogisticsClient, MIN_SEARCH_LENGTH, type LogisticsMaterial } from '../cost-centers/logistics.client.js';

/**
 * Consulta o catálogo de materiais da Logística (busca por texto ou código exato), para vincular o material da
 * cotação (P-06 / PA-08).
 * A consulta é feita aqui, com a chave da Logística do servidor; o navegador não fala com a Logística.
 */
@Controller('logistics-materials')
export class LogisticsMaterialsController {
  constructor(private readonly logistics: LogisticsClient) {}

  /** `?search=` busca por texto (2+ caracteres); `?code=` confere um código exato. Não vão juntos. */
  @Get()
  @RequirePermissions('budget:read')
  find(@Query('search') search?: string, @Query('code') code?: string): Promise<LogisticsMaterial[]> {
    const term = (search ?? '').trim();
    const exact = (code ?? '').trim();
    if (term && exact) throw new BadRequestException('Informe search ou code, não os dois.');
    if (exact) {
      if (exact.length < 2 || exact.length > 40) throw new BadRequestException('Informe o código do material na Logística (2 a 40 caracteres).');
      return this.logistics.materialsByCodes([exact]);
    }
    if (term.length < MIN_SEARCH_LENGTH) throw new BadRequestException('Digite ao menos 2 caracteres para buscar na Logística.');
    return this.logistics.searchMaterials(term.slice(0, 80));
  }
}
