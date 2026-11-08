import { Controller, Get, Injectable, Query, UseGuards } from '@nestjs/common';
import { Matches } from 'class-validator';
import { Public } from '../auth/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { IntegrationApiKeyGuard } from './api-key.guard.js';
import { aggregateConsumption, aggregateCustody, competenceRange } from './cost-report.js';

export class CompetenceQuery {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Competência inválida: informe month no formato AAAA-MM.' })
  month!: string;
}

/** Leituras de custo para o Financeiro (contrato em docs/integracao-centros-de-custo.md §5). */
@Injectable()
export class FinanceIntegrationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Saídas de entrega e seus estornos lançados na competência (mês em America/Sao_Paulo). */
  async consumptionByCostCenter(month: string) {
    const { start, end } = competenceRange(month);
    const rows = await this.prisma.stockMovement.findMany({
      where: { type: 'SAIDA_ENTREGA', effectiveAt: { gte: start, lt: end } },
      select: { quantity: true, unitCost: true, costCenterAxisId: true, projectAxisId: true, reversesMovementId: true },
    });
    return aggregateConsumption(rows);
  }

  /** Bens em custódia ativa (termos `ATIVO`) por colaborador custodiante, valorizados pelo custo do material. */
  async custodyValue() {
    // custody_terms não tem relação Prisma com materials: busca os custos à parte (sem mudar o schema).
    const terms = await this.prisma.custodyTerm.findMany({ where: { status: 'ATIVO' }, select: { custodianAxisId: true, materialId: true, quantity: true, returnedQty: true } });
    const ids = [...new Set(terms.map((t) => t.materialId))];
    const mats = ids.length === 0 ? [] : await this.prisma.material.findMany({ where: { id: { in: ids } }, select: { id: true, averageCost: true, lastCost: true } });
    const cost = new Map(mats.map((m) => [m.id, { averageCost: m.averageCost, lastCost: m.lastCost }]));
    return aggregateCustody(terms.map((t) => ({ ...t, material: cost.get(t.materialId) ?? { averageCost: null, lastCost: null } })));
  }
}

/** Fora do JWT de usuário (`@Public()`); autenticado só pela chave `X-Api-Key`. */
@Public()
@UseGuards(IntegrationApiKeyGuard)
@Controller('integration')
export class FinanceIntegrationController {
  constructor(private readonly svc: FinanceIntegrationService) {}

  @Get('consumption-by-cost-center')
  consumption(@Query() q: CompetenceQuery) { return this.svc.consumptionByCostCenter(q.month); }

  @Get('custody-value')
  custody() { return this.svc.custodyValue(); }
}
