import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { LogisticsClient, type LogisticsMaterial } from '../cost-centers/logistics.client.js';

/**
 * Consulta o catálogo de materiais da Logística por código, para vincular o material da cotação (P-06 / PA-08).
 * A consulta é feita aqui, com a chave da Logística do servidor; o navegador não fala com a Logística.
 */
@Controller('logistics-materials')
export class LogisticsMaterialsController {
  constructor(private readonly logistics: LogisticsClient) {}

  @Get()
  @RequirePermissions('budget:read')
  byCode(@Query('code') code?: string): Promise<LogisticsMaterial[]> {
    const text = (code ?? '').trim();
    if (text.length < 2 || text.length > 40) throw new BadRequestException('Informe o código do material na Logística (2 a 40 caracteres).');
    return this.logistics.materialsByCodes([text]);
  }
}
