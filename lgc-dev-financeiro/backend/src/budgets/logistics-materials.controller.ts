import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { LogisticsClient, type LogisticsMaterial } from '../cost-centers/logistics.client.js';

/**
 * Busca no catálogo de materiais da Logística para vincular o material da cotação (P-06 / PA-08).
 * A consulta é feita aqui, com a chave da Logística do servidor; o navegador não fala com a Logística.
 */
@Controller('logistics-materials')
export class LogisticsMaterialsController {
  constructor(private readonly logistics: LogisticsClient) {}

  @Get()
  @RequirePermissions('budget:read')
  search(@Query('search') search?: string): Promise<LogisticsMaterial[]> {
    const text = (search ?? '').trim();
    if (text.length < 2) throw new BadRequestException('Digite ao menos 2 caracteres para buscar na Logística.');
    return this.logistics.searchMaterials(text.slice(0, 80));
  }
}
