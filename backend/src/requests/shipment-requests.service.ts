import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { isShipment } from '../request-categories/category-kind.js';
import { resolveShipmentApprover, shipmentOf } from './envio-material.js';

/** Aviso gravado em `shipment.warnings` quando não há responsável de CC; some quando o aprovador é encontrado. */
export const NO_APPROVER_WARNING_PREFIX = 'Sem responsável no centro de custo do projeto';

/**
 * Operações do envio de material para obra fora do fluxo genérico de requisições (PT-06). Hoje: "Reavaliar
 * aprovador" — depois do admin de Requisições cadastrar o responsável do centro de custo (ou do CC pai), a
 * requisição que ficou `aguardando_aprovacao` sem aprovador ganha a linha `centro_custo` (PA-09).
 */
@Injectable()
export class ShipmentRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveApprover(requestId: string, actorId: string) {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      include: { approvals: true, categoryVersion: { include: { category: true } } },
    });
    if (!request) throw new NotFoundException('Requisição não encontrada');
    if (!isShipment(request.categoryVersion.category)) throw new BadRequestException('Esta requisição não é um envio de material para obra.');
    if (request.status !== 'aguardando_aprovacao') throw new BadRequestException('A requisição não está aguardando aprovação.');
    if (request.approvals.some((a) => a.status === 'pendente')) throw new BadRequestException('A requisição já tem um aprovador pendente.');
    if (!request.costCenterId) throw new BadRequestException('A requisição não tem centro de custo.');
    const costCenterId = request.costCenterId;

    return this.prisma.$transaction(async (tx) => {
      const approver = await resolveShipmentApprover(tx, costCenterId);
      if (!approver) {
        throw new BadRequestException('O centro de custo do projeto (e o centro de custo pai) continua sem responsável. Cadastre o responsável e tente de novo.');
      }
      const nextStep = Math.max(0, ...request.approvals.map((a) => a.stepOrder)) + 1;
      await tx.requestApproval.create({
        data: { requestId, stepOrder: nextStep, approverId: approver.approverId, completionRule: 'todos', approvalSource: 'centro_custo' },
      });
      const shipment = shipmentOf(request.formData);
      const formData = shipment
        ? { ...(request.formData as Record<string, unknown>), shipment: { ...shipment, warnings: shipment.warnings.filter((w) => !w.startsWith(NO_APPROVER_WARNING_PREFIX)) } }
        : undefined;
      const updated = formData
        ? await tx.request.update({ where: { id: requestId }, data: { formData: formData as unknown as Prisma.InputJsonValue } })
        : request;
      await tx.auditEvent.create({
        data: {
          aggregateType: 'request',
          aggregateId: requestId,
          event: 'request.shipment_approver_resolved',
          actorId,
          afterJson: { approverId: approver.approverId, ...(approver.fallback ? { approverFallback: approver.fallback } : {}) },
          source: 'api',
        },
      });
      return updated;
    });
  }
}
