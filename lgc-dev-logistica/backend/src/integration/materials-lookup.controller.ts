import { BadRequestException, Controller, Get, Injectable, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Public } from '../auth/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AvailabilityService } from '../stock/availability.service.js';
import { IntegrationApiKeyGuard } from './api-key.guard.js';

export const MATERIALS_LOOKUP_MAX = 200;
export const MATERIALS_SEARCH_DEFAULT_LIMIT = 20;
export const MATERIALS_SEARCH_MAX_LIMIT = 50;
export const MATERIALS_SEARCH_MIN_CHARS = 2;

/** `codes=A,B` (ou `codes=A&codes=B`): separa por vírgula, tira espaços e vazios e remove repetidos, mantendo a ordem. */
export const splitCodes = (value: unknown): unknown => {
  const raw = Array.isArray(value) ? value.join(',') : value;
  return typeof raw === 'string' ? [...new Set(raw.split(',').map((c) => c.trim()).filter(Boolean))] : value;
};

/** Consulta por códigos (`codes`) ou por texto (`search`): exatamente um dos dois. */
export class MaterialsLookupQuery {
  @IsOptional()
  @Transform(({ value }) => splitCodes(value))
  @IsArray({ message: 'Informe codes com os códigos dos materiais separados por vírgula.' })
  @ArrayMinSize(1, { message: 'Informe ao menos um código em codes.' })
  @ArrayMaxSize(MATERIALS_LOOKUP_MAX, { message: `No máximo ${MATERIALS_LOOKUP_MAX} códigos por consulta.` })
  @IsString({ each: true }) @MaxLength(40, { each: true, message: 'Código de material com mais de 40 caracteres.' })
  codes?: string[];

  /** Texto a buscar em código ou descrição (contém, sem diferenciar maiúsculas). */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Informe search como texto.' })
  @MinLength(MATERIALS_SEARCH_MIN_CHARS, { message: `Informe ao menos ${MATERIALS_SEARCH_MIN_CHARS} caracteres em search.` })
  @MaxLength(80, { message: 'search com mais de 80 caracteres.' })
  search?: string;

  /** Máximo de itens da busca (padrão 20; acima de 50 vale 50). Ignorado com `codes`. */
  @IsOptional()
  @Type(() => Number) @IsInt({ message: 'limit inválido.' }) @Min(1, { message: 'limit deve ser ao menos 1.' })
  @Transform(({ value }) => (typeof value === 'number' && value > MATERIALS_SEARCH_MAX_LIMIT ? MATERIALS_SEARCH_MAX_LIMIT : value))
  limit?: number;

  /** Almoxarifado da disponibilidade; sem ele vale o padrão (`DEFAULT_WAREHOUSE_CODE`) e, se não houver, todos. */
  @IsOptional() @IsString() @MaxLength(30) warehouse_code?: string;
}

export interface MaterialLookupItem {
  id: string;
  code: string;
  shortDescription: string;
  unit: string;
  averageCost: string | null;
  lastCost: string | null;
  available: string;
  active: boolean;
}

const SELECT = { id: true, code: true, shortDescription: true, status: true, averageCost: true, lastCost: true, stockUom: { select: { code: true } } } satisfies Prisma.MaterialSelect;
type Row = Prisma.MaterialGetPayload<{ select: typeof SELECT }>;

/** Consulta de materiais, custo e disponibilidade para o Core e o Financeiro (só materiais ATIVO). */
@Injectable()
export class MaterialsLookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly config: ConfigService,
  ) {}

  private async resolveWarehouseId(code?: string): Promise<string | undefined> {
    const wanted = code ?? this.config.get<string>('DEFAULT_WAREHOUSE_CODE');
    if (!wanted) return undefined;
    const wh = await this.prisma.warehouse.findFirst({ where: { code: wanted }, select: { id: true } });
    if (!wh && code) throw new BadRequestException(`Almoxarifado ${code} não encontrado.`);
    return wh?.id; // padrão configurado mas inexistente: considera todos os almoxarifados
  }

  private async present(rows: Row[], warehouseId?: string): Promise<MaterialLookupItem[]> {
    const availability = rows.length > 0 ? await this.availability.compute(rows.map((m) => m.id), { warehouseId }) : [];
    const stock = new Map(availability.map((a) => [a.material_id, a.available]));
    return rows.map((m) => ({
      id: m.id, code: m.code, shortDescription: m.shortDescription, unit: m.stockUom.code,
      averageCost: m.averageCost?.toFixed(4) ?? null, lastCost: m.lastCost?.toFixed(4) ?? null,
      available: stock.get(m.id) ?? '0', active: m.status === 'ATIVO',
    }));
  }

  /** Itens na ordem pedida; código inexistente ou de material inativo volta em `notFound`. Custos com 4 casas (como a coluna). */
  async lookup(codes: string[], warehouseCode?: string): Promise<{ items: MaterialLookupItem[]; notFound: string[] }> {
    const warehouseId = await this.resolveWarehouseId(warehouseCode); // almoxarifado inexistente: 400 antes de consultar
    const materials = await this.prisma.material.findMany({ where: { code: { in: codes }, status: 'ATIVO' }, select: SELECT });
    const byCode = new Map(materials.map((m) => [m.code, m]));
    const found = codes.map((c) => byCode.get(c)).filter((m): m is Row => !!m);
    return { items: await this.present(found, warehouseId), notFound: codes.filter((c) => !byCode.has(c)) };
  }

  /**
   * Busca por "contém", sem diferenciar maiúsculas, em código ou descrição. Ordem: código igual ao termo, depois os que começam com
   * o termo (código ou descrição), depois o resto; em cada grupo, por código. `notFound` vem sempre vazio.
   */
  async search(term: string, limit = MATERIALS_SEARCH_DEFAULT_LIMIT, warehouseCode?: string): Promise<{ items: MaterialLookupItem[]; notFound: string[] }> {
    const warehouseId = await this.resolveWarehouseId(warehouseCode);
    const ci = (v: string) => ({ contains: v, mode: 'insensitive' as const });
    const tiers: Prisma.MaterialWhereInput[] = [
      { code: { equals: term, mode: 'insensitive' } },
      { OR: [{ code: { startsWith: term, mode: 'insensitive' } }, { shortDescription: { startsWith: term, mode: 'insensitive' } }] },
      { OR: [{ code: ci(term) }, { shortDescription: ci(term) }] },
    ];
    const rows: Row[] = [];
    for (const tier of tiers) {
      if (rows.length >= limit) break;
      rows.push(...(await this.prisma.material.findMany({
        where: { status: 'ATIVO', ...tier, id: { notIn: rows.map((r) => r.id) } },
        orderBy: { code: 'asc' }, take: limit - rows.length, select: SELECT,
      })));
    }
    return { items: await this.present(rows, warehouseId), notFound: [] };
  }
}

/** Fora do JWT de usuário (`@Public()`); autenticado só pela chave `X-Api-Key` (a mesma `INTEGRATION_API_KEY`). */
@Public()
@UseGuards(IntegrationApiKeyGuard)
@Controller('integration')
export class MaterialsLookupController {
  constructor(private readonly svc: MaterialsLookupService) {}

  @Get('materials')
  lookup(@Query() q: MaterialsLookupQuery) {
    if (q.codes !== undefined && q.search !== undefined) throw new BadRequestException('Informe codes ou search, não os dois.');
    if (q.codes !== undefined) return this.svc.lookup(q.codes, q.warehouse_code); // limit só vale com search
    if (q.search !== undefined) return this.svc.search(q.search, q.limit, q.warehouse_code);
    throw new BadRequestException('Informe codes (códigos separados por vírgula) ou search (texto a buscar).');
  }
}
