import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import type { CreateMaterialDto, ListMaterialsQuery, UpdateMaterialDto } from './materials.dto.js';

const COST_FIELDS = ['averageCost', 'lastCost'] as const;

@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Custo só é exposto a quem tem `material:read_cost` (7.2). */
  private present<T extends Record<string, unknown>>(material: T, user: AuthenticatedUser): T {
    if (user.permissions.includes('material:read_cost')) return material;
    const copy: Record<string, unknown> = { ...material };
    for (const f of COST_FIELDS) delete copy[f];
    return copy as T;
  }

  private validateRules(m: { lotControlled?: boolean; expiryControlled?: boolean; minShelfLifeDays?: number | null; serialControlled?: boolean; exitMethod?: string; requiresAuthorization?: boolean; authorizationBy?: string | null }) {
    if (m.expiryControlled && !m.lotControlled) throw new BadRequestException('Material com controle de validade exige controle por lote.');
    if (m.minShelfLifeDays != null && !m.expiryControlled) throw new BadRequestException('A vida útil mínima só se aplica a material com controle de validade.');
    if (m.serialControlled && m.exitMethod && m.exitMethod !== 'SERIE_ESPECIFICA') {
      throw new BadRequestException('Material controlado por número de série deve usar o método de saída SERIE_ESPECIFICA.');
    }
    if (m.exitMethod === 'FEFO' && !m.expiryControlled) throw new BadRequestException('O método FEFO exige controle de validade.');
    if (m.requiresAuthorization && !m.authorizationBy) throw new BadRequestException('Informe quem autoriza (HSE, Qualidade, TI ou gestor).');
  }

  async list(query: ListMaterialsQuery, user: AuthenticatedUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const useRevisedCatalog = process.env.SEED_REVISED_CATALOG === 'true';
    const where: Prisma.MaterialWhereInput = {
      ...(query.type && { type: query.type }),
      ...(query.category && { category: query.category }),
      status: query.status ?? 'ATIVO',
      ...(useRevisedCatalog ? { code: { startsWith: 'REV-' } } : {}),
      ...(query.q && {
        OR: [
          { code: { contains: query.q, mode: 'insensitive' } },
          { shortDescription: { contains: query.q, mode: 'insensitive' } },
          { technicalDescription: { contains: query.q, mode: 'insensitive' } },
          { barcodes: { some: { code: query.q } } },
        ],
      }),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.material.count({ where }),
      this.prisma.material.findMany({ where, orderBy: { code: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, include: { stockUom: { select: { code: true, name: true } } } }),
    ]);
    return { total, page, pageSize, items: items.map((m) => this.present(m, user)) };
  }

  async purchaseCatalog() {
    const useRevisedCatalog = process.env.SEED_REVISED_CATALOG === 'true';
    const items = await this.prisma.material.findMany({
      where: {
        status: 'ATIVO',
        ...(useRevisedCatalog ? { code: { startsWith: 'REV-' } } : {}),
      },
      orderBy: [{ category: 'asc' }, { subcategory: 'asc' }, { shortDescription: 'asc' }],
      select: {
        id: true, code: true, shortDescription: true, technicalDescription: true,
        category: true, subcategory: true,
        stockUom: { select: { code: true, name: true } },
        averageCost: true, lastCost: true,
      },
    });
    // O preço exibido para compra é sempre o último custo cadastrado; quando ainda não
    // existe, usa o custo médio. Nunca devolve materiais sem valor cadastrado.
    return items.map((item) => ({
      id: item.id,
      code: item.code,
      shortDescription: item.shortDescription,
      technicalDescription: item.technicalDescription,
      category: item.category,
      subcategory: item.subcategory,
      unit: item.stockUom.code,
      unitPrice: item.lastCost?.toString() ?? item.averageCost?.toString() ?? null,
    })).filter((item) => item.unitPrice !== null);
  }

  async get(id: string, user: AuthenticatedUser) {
    const material = await this.prisma.material.findUnique({ where: { id }, include: { stockUom: true, barcodes: true } });
    if (!material) throw new NotFoundException('Material não encontrado.');
    return this.present(material, user);
  }

  async versions(id: string) {
    await this.get(id, { permissions: [] } as unknown as AuthenticatedUser);
    return this.prisma.materialVersion.findMany({ where: { materialId: id }, orderBy: { version: 'desc' } });
  }

  /** Próximo código da família+subcódigo (ex.: EPI-CAP-0004), serializado por trava de transação. */
  private async nextCode(tx: Prisma.TransactionClient, prefix: string, sub: string): Promise<string> {
    const stem = `${prefix}-${sub}-`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'material-code:' + stem}))`;
    const rows = await tx.material.findMany({ where: { code: { startsWith: stem } }, select: { code: true } });
    let max = 0;
    for (const r of rows) { const m = /^(\d{4,})$/.exec(r.code.slice(stem.length)); if (m) max = Math.max(max, Number(m[1])); }
    if (max >= 9999) throw new UnprocessableEntityException(`A sequência ${stem}#### chegou ao limite (9999). Use outro subcódigo.`);
    return `${stem}${String(max + 1).padStart(4, '0')}`;
  }

  async create(input: CreateMaterialDto, user: AuthenticatedUser) {
    const { family, subcode, ...rest } = input;
    if (rest.code !== undefined && !user.permissions.includes('material:set_code')) throw new BadRequestException('O código do material é gerado automaticamente; não informe o código.');
    if (rest.code === undefined && (!family || !subcode)) throw new BadRequestException('Informe a família e o subcódigo (3 letras) para gerar o código do material.');
    // Item seriado sai por série específica; sem isso o default FIFO do banco quebraria qualquer PATCH posterior.
    const dto = { ...rest, exitMethod: input.exitMethod ?? (input.serialControlled ? ('SERIE_ESPECIFICA' as const) : undefined) };
    this.validateRules(dto);
    const uom = await this.prisma.unitOfMeasure.findUnique({ where: { id: dto.stockUomId } });
    if (!uom || !uom.active) throw new BadRequestException('Unidade de estoque inexistente ou inativa.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const code = dto.code ?? (await this.nextCode(tx, family!, subcode!));
        const material = await tx.material.create({ data: { ...dto, code, createdBy: user.userId } });
        await tx.materialVersion.create({ data: { materialId: material.id, version: 1, snapshot: this.snapshot(material), changedBy: user.userId, changeReason: 'Criação' } });
        await this.audit.record(user.userId, 'material.created', 'material', material.id, { code: material.code }, tx);
        return this.present(material, user);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`Já existe um material com este código${dto.code ? ` (${dto.code})` : ''}.`);
      throw e;
    }
  }

  /** Alteração material cria nova versão com snapshot completo (7.3.6). */
  async update(id: string, dto: UpdateMaterialDto, user: AuthenticatedUser) {
    const current = await this.prisma.material.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Material não encontrado.');
    if (current.status !== 'ATIVO') throw new BadRequestException('Material inativo ou substituído não aceita alterações.');
    const { changeReason, ...fields } = dto;
    const merged = { ...current, ...fields };
    this.validateRules(merged);
    if (dto.stockUomId && dto.stockUomId !== current.stockUomId) {
      const uom = await this.prisma.unitOfMeasure.findUnique({ where: { id: dto.stockUomId } });
      if (!uom?.active) throw new BadRequestException('Unidade de estoque inexistente ou inativa.');
    }
    return this.prisma.$transaction(async (tx) => {
      const next = current.currentVersion + 1;
      const material = await tx.material.update({ where: { id }, data: { ...fields, currentVersion: next, updatedBy: user.userId } });
      await tx.materialVersion.create({ data: { materialId: id, version: next, snapshot: this.snapshot(material), changedBy: user.userId, changeReason } });
      await this.audit.record(user.userId, 'material.updated', 'material', id, { version: next, fields: Object.keys(fields) }, tx);
      return this.present(material, user);
    });
  }

  /** Material sem movimentação, lote nem série nunca entrou no estoque: pode ser excluído de verdade. Com histórico, só inativar (7.3.7). */
  async deletability(id: string): Promise<{ deletable: boolean; reason?: string }> {
    const exists = await this.prisma.material.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Material não encontrado.');
    const [movements, lots, serials, balances] = await Promise.all([
      this.prisma.stockMovement.count({ where: { materialId: id } }),
      this.prisma.lot.count({ where: { materialId: id } }),
      this.prisma.serialNumber.count({ where: { materialId: id } }),
      this.prisma.stockBalance.count({ where: { materialId: id } }),
    ]);
    if (movements + lots + serials + balances > 0) return { deletable: false, reason: 'O material possui movimentações, lotes, séries ou saldo; use Inativar.' };
    return { deletable: true };
  }

  async remove(id: string, user: AuthenticatedUser) {
    const current = await this.prisma.material.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Material não encontrado.');
    const d = await this.deletability(id);
    if (!d.deletable) throw new ConflictException(d.reason);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.materialBarcode.deleteMany({ where: { materialId: id } });
        await tx.materialVersion.deleteMany({ where: { materialId: id } });
        await tx.material.delete({ where: { id } });
        await this.audit.record(user.userId, 'material.deleted', 'material', id, { code: current.code, shortDescription: current.shortDescription, version: current.currentVersion }, tx);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') throw new ConflictException('O material é usado em outros registros (pedidos, recebimentos, políticas); use Inativar.');
      throw e;
    }
    return { id, code: current.code, deleted: true };
  }

  /** Inativa (mantém o histórico). */
  async deactivate(id: string, user: AuthenticatedUser) {
    const current = await this.prisma.material.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Material não encontrado.');
    if (current.status === 'INATIVO') return this.present(current, user);
    return this.prisma.$transaction(async (tx) => {
      const next = current.currentVersion + 1;
      const material = await tx.material.update({ where: { id }, data: { status: 'INATIVO', currentVersion: next, updatedBy: user.userId } });
      await tx.materialVersion.create({ data: { materialId: id, version: next, snapshot: this.snapshot(material), changedBy: user.userId, changeReason: 'Inativação' } });
      await this.audit.record(user.userId, 'material.deactivated', 'material', id, { version: next }, tx);
      return this.present(material, user);
    });
  }

  private snapshot(material: object): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(material)) as Prisma.InputJsonValue;
  }
}
