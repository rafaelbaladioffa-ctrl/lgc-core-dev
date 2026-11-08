import { Body, Controller, ForbiddenException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service.js';
import { SatelliteApiKeyGuard, type SatelliteRequest } from '../integration/guards/satellite-api-key.guard.js';
import { SatelliteThrottlerGuard } from '../integration/guards/satellite-throttler.guard.js';
import { PROJECT_QUOTE_REQUESTED_EVENT, ProjectQuotesService } from './project-quotes.service.js';
import { ReceiveProjectQuoteDto } from './dto/project-quote.dto.js';

/**
 * Satélite → Core: o Financeiro devolve a cotação aprovada para envio (Bid preenchida e equipe
 * orçada). Autenticado pela API key do satélite, não por usuário: por isso não há @AuditAction
 * (o registro guarda o satélite que enviou). Só o satélite que assina `project.quote_requested`
 * pode enviar. Contrato: docs/integracao-core-financeiro.md §4.
 */
@Controller('integration/projects')
@UseGuards(SatelliteApiKeyGuard, SatelliteThrottlerGuard)
@Throttle({ default: { limit: 100, ttl: 60_000 } })
export class ProjectQuotesIntegrationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotesService: ProjectQuotesService,
  ) {}

  @Post(':id/quotes')
  async receive(@Param('id') id: string, @Body() dto: ReceiveProjectQuoteDto, @Req() req: SatelliteRequest) {
    const subscription = await this.prisma.integrationSubscription.findUnique({
      where: { satelliteId_eventType: { satelliteId: req.satellite.id, eventType: PROJECT_QUOTE_REQUESTED_EVENT } },
    });
    if (!subscription) {
      throw new ForbiddenException(`O satélite precisa assinar ${PROJECT_QUOTE_REQUESTED_EVENT} para enviar cotações.`);
    }
    return this.quotesService.receive(id, req.satellite.id, dto);
  }
}
