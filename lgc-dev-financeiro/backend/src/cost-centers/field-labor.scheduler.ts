import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { isoDate, todaySaoPaulo } from './cc-engine.js';
import { FIELD_SCHEDULER_ACTOR, FieldLaborService } from './field-labor.service.js';

/**
 * Janela da rotina diária: do primeiro dia do mês corrente até ontem; na virada do mês (ontem é do mês anterior),
 * só ontem. Horas só entram no dia seguinte, quando o dia fecha. No máximo 31 dias, dentro do limite do Field.
 */
export function scheduledWindow(today = todaySaoPaulo()): { from: string; to: string } {
  const yesterday = isoDate(new Date(new Date(`${today}T00:00:00Z`).getTime() - 86_400_000));
  const monthStart = `${today.slice(0, 7)}-01`;
  return { from: yesterday < monthStart ? yesterday : monthStart, to: yesterday };
}

/**
 * Importa todo dia as horas reais do Field como mão de obra do projeto (PT-10). Ligado só com
 * `SCHEDULER_ENABLED=true`, em UMA instância (o mesmo agendador do outbox e da Logística). Idempotente por
 * (colaborador, projeto, dia). Falha (Field fora do ar ou sem chave) não derruba o agendador; a próxima rodada tenta de novo.
 */
@Injectable()
export class FieldLaborScheduler {
  private readonly logger = new Logger(FieldLaborScheduler.name);

  constructor(
    private readonly labor: FieldLaborService,
    private readonly config: ConfigService,
  ) {}

  /** 04:00 em São Paulo, depois da importação da Logística (03:30). */
  @Cron('0 4 * * *', { timeZone: 'America/Sao_Paulo' })
  async scheduled() {
    if (this.config.get<string>('SCHEDULER_ENABLED') !== 'true') return;
    await this.runOnce();
  }

  async runOnce(today = todaySaoPaulo()) {
    const { from, to } = scheduledWindow(today);
    try {
      const r = await this.labor.import(from, to, FIELD_SCHEDULER_ACTOR);
      this.logger.log(`Horas do Field ${from} a ${to}: ${r.hours} h, ${r.created} lançamentos novos, ${r.replaced} refeitos, ${r.unchanged} iguais, ${r.pending.length} pendência(s).`);
      return r;
    } catch (e) {
      const error = (e as Error).message;
      this.logger.warn(`Importação diária das horas do Field ${from} a ${to} falhou: ${error}`);
      return { from, to, error };
    }
  }
}
