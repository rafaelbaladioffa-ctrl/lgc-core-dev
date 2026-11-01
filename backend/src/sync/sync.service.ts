import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { Type, plainToInstance } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsObject, IsString, IsUUID, MaxLength, MinLength, ValidateNested, validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { ShippingService } from '../shipping/shipping.service.js';
import { ReceivingService } from '../receiving/receiving.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ScanDto } from '../shipping/shipping.dto.js';
import { ConfirmPutawayDto } from '../receiving/receiving.dto.js';
import { SubmitCountDto } from '../inventory/inventory.dto.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';

/** Tipos de operação aceitos offline e a permissão local exigida de cada um (validada no backend, sempre). */
const OPS = {
  'picking.start': 'picking:execute',
  'picking.scan': 'picking:execute',
  'picking.complete': 'picking:execute',
  'putaway.confirm': 'receipt:execute',
  'count.submit': 'stockcount:count',
} as const;
type OpType = keyof typeof OPS;

export class OfflineOpDto {
  @IsUUID('all', { message: 'opId deve ser um UUID gerado no dispositivo.' }) opId!: string;
  @IsIn(Object.keys(OPS), { message: `Tipo de operação inválido. Use: ${Object.keys(OPS).join(', ')}.` }) type!: OpType;
  @IsObject({ message: 'payload inválido.' }) payload!: Record<string, unknown>;
  /** Momento em que o operador executou a ação (relógio do dispositivo). */
  @IsDateString({}, { message: 'clientAt inválido (ISO 8601).' }) clientAt!: string;
}

export class SyncBatchDto {
  @IsString({ message: 'Informe o dispositivo.' }) @MinLength(4) @MaxLength(80) deviceId!: string;
  @IsArray() @ArrayMinSize(1, { message: 'Envie ao menos uma operação.' }) @ArrayMaxSize(200, { message: 'No máximo 200 operações por lote.' })
  @ValidateNested({ each: true }) @Type(() => OfflineOpDto)
  operations!: OfflineOpDto[];
}

export interface OpResult {
  opId: string;
  status: 'APLICADA' | 'DUPLICADA' | 'CONFLITO' | 'REJEITADA' | 'ERRO';
  message?: string;
  code?: string;
  result?: unknown;
}

const hash = (type: string, payload: unknown) => createHash('sha256').update(type + JSON.stringify(payload, Object.keys((payload as object) ?? {}).sort())).digest('hex');

/**
 * Sincronização do PWA (15.2, 11.17): cada operação carrega um opId gerado no dispositivo; repetir o envio
 * devolve o resultado original sem reaplicar. Conflito (409) e rejeição (4xx) são registrados e informados;
 * falha transitória (5xx) volta como ERRO e NÃO é gravada, para o dispositivo tentar de novo.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly shipping: ShippingService,
    private readonly receiving: ReceivingService,
    private readonly inventory: InventoryService,
  ) {}

  private async parse<T extends object>(cls: new () => T, payload: Record<string, unknown>) {
    const dto = plainToInstance(cls, payload);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) throw new BadRequestException(errors.flatMap((e) => Object.values(e.constraints ?? {})));
    return dto;
  }

  private async apply(op: OfflineOpDto, user: AuthenticatedUser): Promise<unknown> {
    const id = op.payload['id'];
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('payload.id (tarefa/inventário) obrigatório.');
    const { id: _id, ...rest } = op.payload;
    void _id;
    switch (op.type) {
      case 'picking.start': return this.shipping.start(id, user);
      case 'picking.scan': return this.shipping.scan(id, await this.parse(ScanDto, rest), user);
      case 'picking.complete': return this.shipping.complete(id, user);
      case 'putaway.confirm': return this.receiving.confirmPutaway(id, await this.parse(ConfirmPutawayDto, rest), user);
      case 'count.submit': return this.inventory.submit(id, await this.parse(SubmitCountDto, rest), user);
    }
  }

  async batch(dto: SyncBatchDto, user: AuthenticatedUser): Promise<{ results: OpResult[] }> {
    const results: OpResult[] = [];
    for (const op of dto.operations) {
      const h = hash(op.type, op.payload);
      const prev = await this.prisma.offlineOperation.findUnique({ where: { deviceId_opId: { deviceId: dto.deviceId, opId: op.opId } } });
      if (prev) {
        results.push(prev.payloadHash !== h || prev.userId !== user.userId
          ? { opId: op.opId, status: 'REJEITADA', code: 'OP_ID_REUTILIZADO', message: 'opId já usado com outro conteúdo ou outro usuário.' }
          : { opId: op.opId, status: 'DUPLICADA', message: prev.message ?? undefined, code: prev.code ?? undefined, result: prev.result ?? undefined });
        continue;
      }
      // Permissão por tipo: o PWA nunca amplia o que o usuário pode fazer (6).
      if (!user.permissions.includes(OPS[op.type])) {
        results.push(await this.record(dto.deviceId, op, h, user, 'REJEITADA', `Permissão insuficiente. Necessário: ${OPS[op.type]}.`, 'FORBIDDEN'));
        continue;
      }
      try {
        const out = await this.apply(op, user);
        results.push(await this.record(dto.deviceId, op, h, user, 'APLICADA', undefined, undefined, out));
      } catch (e) {
        if (e instanceof HttpException) {
          const status = e.getStatus();
          const body = e.getResponse() as { message?: string | string[]; code?: string } | string;
          const message = typeof body === 'string' ? body : Array.isArray(body.message) ? body.message.join('; ') : body.message ?? e.message;
          const code = typeof body === 'object' ? body.code : undefined;
          if (status < 500) {
            results.push(await this.record(dto.deviceId, op, h, user, status === 409 ? 'CONFLITO' : 'REJEITADA', message, code ?? String(status)));
            continue;
          }
        }
        results.push({ opId: op.opId, status: 'ERRO', message: 'Falha temporária no servidor; tente novamente.' });
      }
    }
    return { results };
  }

  private async record(deviceId: string, op: OfflineOpDto, payloadHash: string, user: AuthenticatedUser, status: 'APLICADA' | 'CONFLITO' | 'REJEITADA', message?: string, code?: string, result?: unknown): Promise<OpResult> {
    // Serializa uma vez: o que volta agora e o que fica guardado para reenvios são idênticos.
    const plain = status === 'APLICADA' ? (JSON.parse(JSON.stringify(result ?? null)) as Prisma.InputJsonValue) : undefined;
    try {
      await this.prisma.offlineOperation.create({ data: { deviceId, opId: op.opId, type: op.type, payloadHash, userId: user.userId, status, message, code, result: plain === null ? undefined : plain, clientAt: new Date(op.clientAt) } });
    } catch (e) {
      // Envio paralelo da mesma operação: a outra entrega venceu; devolve o que ficou gravado.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { opId: op.opId, status: 'DUPLICADA' };
      throw e;
    }
    return { opId: op.opId, status, message, code, result: plain ?? undefined };
  }

  // ---------------------------------------------------------------------------------------------
  // Dados para trabalhar offline
  // ---------------------------------------------------------------------------------------------

  async bootstrap(warehouseId: string, user: AuthenticatedUser) {
    await this.rbac.assertWarehouseAccess(user, warehouseId);
    const can = (p: string) => user.permissions.includes(p);
    const locations = await this.prisma.location.findMany({ where: { warehouseId, isVirtual: false }, select: { id: true, code: true, name: true } });
    const locCode = new Map(locations.map((l) => [l.id, l.code]));

    const tasks = can('picking:execute') ? await this.prisma.pickingTask.findMany({ where: { warehouseId, status: { in: ['ABERTA', 'EM_SEPARACAO'] } }, include: { items: true }, orderBy: [{ priority: 'desc' }, { seq: 'asc' }], take: 100 }) : [];
    const putaway = can('receipt:execute') ? await this.prisma.putawayTask.findMany({ where: { warehouseId, status: 'ABERTA' }, orderBy: { seq: 'asc' }, take: 200 }) : [];
    const counts = can('stockcount:count') ? await this.prisma.stockCount.findMany({ where: { warehouseId, status: { in: ['EM_CONTAGEM', 'EM_RECONTAGEM'] } } }) : [];
    const sheets = [];
    for (const c of counts) sheets.push(await this.inventory.sheet(c.id, user));

    const materialIds = [...new Set([...tasks.flatMap((t) => t.items.map((i) => i.materialId)), ...putaway.map((p) => p.materialId), ...sheets.flatMap((s) => s.lines.map((l) => l.materialId))])];
    const materials = await this.prisma.material.findMany({ where: { id: { in: materialIds } }, include: { stockUom: true, barcodes: true } });
    const lotIds = [...new Set([...tasks.flatMap((t) => t.items.flatMap((i) => (i.lotId ? [i.lotId] : []))), ...putaway.flatMap((p) => (p.lotId ? [p.lotId] : []))])];
    const lots = await this.prisma.lot.findMany({ where: { id: { in: lotIds } }, select: { id: true, lotNumber: true, expiresAt: true } });

    return {
      generatedAt: new Date().toISOString(),
      warehouseId,
      locations: locations.map((l) => ({ id: l.id, code: l.code, name: l.name })),
      materials: materials.map((m) => ({ id: m.id, code: m.code, description: m.shortDescription, uom: m.stockUom.code, uomPrecision: m.stockUom.precision, serialControlled: m.serialControlled, barcodes: m.barcodes.map((b) => ({ code: b.code, factor: b.factor.toString() })) })),
      lots,
      pickingTasks: tasks.map((t) => ({ id: t.id, code: `SEP-${String(t.seq).padStart(8, '0')}`, status: t.status, priority: t.priority, items: t.items.map((i) => ({ id: i.id, materialId: i.materialId, locationId: i.locationId, locationCode: locCode.get(i.locationId), lotId: i.lotId, planned: i.quantityPlanned.toString(), picked: i.quantityPicked.toString(), status: i.status })) })),
      putawayTasks: putaway.map((p) => ({ id: p.id, code: `ARM-${String(p.seq).padStart(8, '0')}`, materialId: p.materialId, lotId: p.lotId, quantity: p.quantity.toString(), suggestedLocationId: p.suggestedLocationId, suggestedLocationCode: p.suggestedLocationId ? locCode.get(p.suggestedLocationId) : null })),
      countSheets: sheets.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, locationCode: locCode.get(l.locationId) })) })),
    };
  }
}
