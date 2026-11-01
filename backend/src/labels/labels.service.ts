import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';

export const fmtDate = (d?: Date | null) => (d ? d.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'); // colunas DATE
export const fmtDateTime = (d?: Date | null) => (d ? d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '') : '—');

const KINDS = ['LOCATION', 'MATERIAL', 'SERIAL', 'PACKAGE'] as const;
export type LabelKind = (typeof KINDS)[number];

export class PrintLabelDto {
  @IsIn(KINDS, { message: 'Tipo de etiqueta inválido (LOCATION, MATERIAL, SERIAL ou PACKAGE).' }) kind!: LabelKind;
  @IsUUID('all', { message: 'Referência inválida.' }) refId!: string;
  /** MATERIAL: lote opcional. */
  @IsOptional() @IsUUID('all', { message: 'Lote inválido.' }) lotId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1, { message: 'Mínimo de 1 cópia.' }) @Max(100, { message: 'Máximo de 100 cópias.' }) copies?: number;
  @IsOptional() @IsEnum({ json: 'json', zpl: 'zpl' }, { message: 'Formato inválido (json ou zpl).' }) format?: 'json' | 'zpl';
  /** Obrigatório a partir da segunda impressão do mesmo item (reimpressão auditada). */
  @IsOptional() @IsString() @MinLength(3, { message: 'O motivo deve ter ao menos 3 caracteres.' }) @MaxLength(300) reason?: string;
}

interface Label { kind: LabelKind; title: string; lines: string[]; code: string }

const zplSafe = (t: string) => t.replace(/[\^~\\]/g, ' ').slice(0, 60);

@Injectable()
export class LabelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  private async build(dto: PrintLabelDto, user: AuthenticatedUser): Promise<Label> {
    switch (dto.kind) {
      case 'LOCATION': {
        const l = await this.prisma.location.findUnique({ where: { id: dto.refId }, include: { warehouse: true } });
        if (!l) throw new NotFoundException('Endereço não encontrado.');
        await this.rbac.assertWarehouseAccess(user, l.warehouseId);
        return { kind: 'LOCATION', title: l.code, code: `LGC:LOC:${l.warehouse.code}:${l.code}`, lines: [l.warehouse.name, `Nível: ${l.level}`, l.status !== 'ATIVO' ? `STATUS: ${l.status}` : ''] .filter(Boolean) };
      }
      case 'MATERIAL': {
        const m = await this.prisma.material.findUnique({ where: { id: dto.refId }, include: { stockUom: true } });
        if (!m) throw new NotFoundException('Material não encontrado.');
        const lines = [m.shortDescription, `UM: ${m.stockUom.code}`];
        let code = `LGC:MAT:${m.code}`;
        if (dto.lotId) {
          const lot = await this.prisma.lot.findUnique({ where: { id: dto.lotId } });
          if (!lot || lot.materialId !== m.id) throw new BadRequestException('Lote não pertence ao material.');
          lines.push(`Lote: ${lot.lotNumber}`, `Validade: ${fmtDate(lot.expiresAt)}`, `Status: ${lot.status}`);
          code += `:LOT:${lot.lotNumber}`;
        }
        return { kind: 'MATERIAL', title: m.code, code, lines };
      }
      case 'SERIAL': {
        const s = await this.prisma.serialNumber.findUnique({ where: { id: dto.refId }, include: { material: true } });
        if (!s) throw new NotFoundException('Número de série não encontrado.');
        return { kind: 'SERIAL', title: s.material.code, code: `LGC:SER:${s.material.code}:${s.serial}`, lines: [s.material.shortDescription, `Série: ${s.serial}`, s.assetTag ? `Patrimônio: ${s.assetTag}` : '', `Condição: ${s.condition}`].filter(Boolean) };
      }
      case 'PACKAGE': {
        const p = await this.prisma.package.findUnique({ where: { id: dto.refId }, include: { shipment: { include: { packages: { orderBy: { seq: 'asc' }, select: { id: true } } } } } });
        if (!p) throw new NotFoundException('Volume não encontrado.');
        const order = await this.prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: p.orderId } });
        if (order.warehouseId) await this.rbac.assertWarehouseAccess(user, order.warehouseId);
        const idx = p.shipment.packages.findIndex((x) => x.id === p.id) + 1;
        const code = `VOL-${String(p.seq).padStart(8, '0')}`;
        return { kind: 'PACKAGE', title: code, code: `LGC:VOL:${code}`, lines: [`Ordem: ATD-${String(order.seq).padStart(8, '0')}`, `Destino: ${p.shipment.destination ?? '—'}`, `Projeto: ${order.projectAxisId ?? '—'}`, `Volume ${idx}/${p.shipment.packages.length}`, p.seal ? `Lacre: ${p.seal}` : ''].filter(Boolean) };
      }
    }
  }

  private zpl(l: Label) {
    const rows = [l.title, ...l.lines].map((t, i) => `^FO30,${30 + i * 36}^A0N,28,28^FD${zplSafe(t)}^FS`).join('');
    return `^XA^CI28${rows}^FO420,30^BQN,2,5^FDLA,${zplSafe(l.code)}^FS^FO30,${40 + (l.lines.length + 1) * 36}^BCN,60,Y,N,N^FD${zplSafe(l.code)}^FS^XZ`;
  }

  async print(dto: PrintLabelDto, user: AuthenticatedUser) {
    const label = await this.build(dto, user);
    const key = `${dto.refId}${dto.lotId ? `:${dto.lotId}` : ''}`;
    const previous = await this.prisma.labelPrint.count({ where: { kind: dto.kind, refId: key } });
    if (previous > 0 && !dto.reason) throw new BadRequestException('Reimpressão exige o motivo (reason).');
    const copies = dto.copies ?? 1;
    const format = dto.format ?? 'json';
    const rec = await this.prisma.labelPrint.create({ data: { kind: dto.kind, refId: key, copies, format, isReprint: previous > 0, reason: dto.reason, printedBy: user.userId } });
    return { printId: rec.id, isReprint: rec.isReprint, copies, ...label, ...(format === 'zpl' ? { zpl: this.zpl(label) } : {}) };
  }
}
