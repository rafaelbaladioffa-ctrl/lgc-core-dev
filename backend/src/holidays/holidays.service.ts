import { Injectable, NotFoundException } from '@nestjs/common';
import type { Holiday } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { CreateHolidayDto } from './dto/create-holiday.dto.js';

/**
 * Estado do feriado em `holiday.created` e `holiday.updated` (este só no reenvio de cadastros: não há edição de
 * feriado). `date` é a coluna `DATE` em `AAAA-MM-DD`. Contrato: docs/dominio/cadastros.md e
 * docs/mapa-interoperabilidade.md §6.
 */
export function holidayEventPayload(holiday: Pick<Holiday, 'id' | 'date' | 'name'>): Record<string, unknown> {
  return { holiday_id: holiday.id, date: holiday.date.toISOString().slice(0, 10), name: holiday.name, active: true };
}

@Injectable()
export class HolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  create(dto: CreateHolidayDto) {
    return this.prisma.$transaction(async (tx) => {
      const holiday = await tx.holiday.create({ data: { date: new Date(dto.date), name: dto.name } });
      await this.outbox.record(tx, 'holiday.created', holidayEventPayload(holiday));
      return holiday;
    });
  }

  findAll() {
    return this.prisma.holiday.findMany({ orderBy: { date: 'asc' } });
  }

  async remove(id: string) {
    const holiday = await this.prisma.holiday.findUnique({ where: { id } });
    if (!holiday) throw new NotFoundException('Feriado não encontrado');
    await this.prisma.$transaction(async (tx) => {
      await tx.holiday.delete({ where: { id } });
      await this.outbox.record(tx, 'holiday.deleted', { ...holidayEventPayload(holiday), active: false, deleted: true });
    });
  }
}
