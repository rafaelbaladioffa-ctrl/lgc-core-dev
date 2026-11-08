import { Body, Controller, ForbiddenException, Param, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service.js';
import { SatelliteApiKeyGuard, type SatelliteRequest } from '../integration/guards/satellite-api-key.guard.js';
import { SatelliteThrottlerGuard } from '../integration/guards/satellite-throttler.guard.js';
import { COST_CENTER_BUDGET_SUBSCRIPTION_EVENT, CostCentersService } from './cost-centers.service.js';
import { ReceiveCostCenterBudgetStatusDto } from './dto/budget-status.dto.js';

/**
 * Satélite → Core: o Financeiro informa a situação do orçamento do centro de custo
 * (docs/integracao-centros-de-custo.md §4). Mesmo mecanismo da devolução da cotação do projeto:
 * API key do satélite, não usuário — por isso não há @RequirePermissions/@AuditAction; a
 * auditoria é gravada pelo serviço em `audit_events` com o satélite como origem. Só o satélite que
 * assina `cost_center.updated` (quem mantém o cadastro de CC em cache) pode enviar.
 */
@Controller('integration/cost-centers')
@UseGuards(SatelliteApiKeyGuard, SatelliteThrottlerGuard)
@Throttle({ default: { limit: 100, ttl: 60_000 } })
export class CostCentersIntegrationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costCenters: CostCentersService,
  ) {}

  @Put(':id/budget-status')
  async receiveBudgetStatus(@Param('id') id: string, @Body() dto: ReceiveCostCenterBudgetStatusDto, @Req() req: SatelliteRequest) {
    const subscription = await this.prisma.integrationSubscription.findUnique({
      where: { satelliteId_eventType: { satelliteId: req.satellite.id, eventType: COST_CENTER_BUDGET_SUBSCRIPTION_EVENT } },
    });
    if (!subscription) {
      throw new ForbiddenException(`O satélite precisa assinar ${COST_CENTER_BUDGET_SUBSCRIPTION_EVENT} para informar o orçamento.`);
    }
    return this.costCenters.receiveBudgetStatus(id, { id: req.satellite.id, name: req.satellite.name }, dto);
  }
}
