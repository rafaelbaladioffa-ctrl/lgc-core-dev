import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { todaySaoPaulo } from './cc-engine.js';
import { CostCentersService } from './cost-centers.service.js';

/** Competências da rotina diária: a do mês corrente e a do anterior (movimento que chega depois do fechamento do mês). */
export function scheduledMonths(today = todaySaoPaulo()): string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const previous = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  return [previous, today.slice(0, 7)];
}

/**
 * Importa todo dia o consumo de material da Logística no CC (antes só pelo botão "Importar da Logística").
 * Ligado só com `SCHEDULER_ENABLED=true`, em UMA instância (o mesmo agendador do outbox). Idempotente: reimportar
 * a competência sem mudança não lança nada. Falha de um mês (Logística fora do ar ou sem chave) não impede o outro
 * e não derruba o agendador; a próxima rodada tenta de novo.
 */
@Injectable()
export class LogisticsImportScheduler {
  private readonly logger = new Logger(LogisticsImportScheduler.name);

  constructor(
    private readonly costCenters: CostCentersService,
    private readonly config: ConfigService,
  ) {}

  /** 03:30 em São Paulo, depois do movimento do dia anterior. */
  @Cron('30 3 * * *', { timeZone: 'America/Sao_Paulo' })
  async scheduled() {
    if (this.config.get<string>('SCHEDULER_ENABLED') !== 'true') return;
    await this.runOnce();
  }

  async runOnce(today = todaySaoPaulo()) {
    const results: Array<Awaited<ReturnType<CostCentersService['importLogisticsScheduled']>> | { month: string; error: string }> = [];
    for (const month of scheduledMonths(today)) {
      try {
        const r = await this.costCenters.importLogisticsScheduled(month);
        this.logger.log(`Consumo da Logística ${month}: ${r.created} novos, ${r.replaced} refeitos, ${r.unchanged} iguais, ${r.withoutCostCenter} sem centro de custo.`);
        if (r.unknownCostCenters.length || r.unknownProjects.length) {
          this.logger.warn(`Consumo da Logística ${month}: ids fora do cache do Core — centros de custo [${r.unknownCostCenters.join(', ')}], projetos [${r.unknownProjects.join(', ')}].`);
        }
        results.push(r);
      } catch (e) {
        const error = (e as Error).message;
        this.logger.warn(`Importação diária da Logística ${month} falhou: ${error}`);
        results.push({ month, error });
      }
    }
    return results;
  }
}
