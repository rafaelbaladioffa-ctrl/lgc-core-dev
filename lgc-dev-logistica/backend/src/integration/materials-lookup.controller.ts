import { BadRequestException, Controller, Get, Injectable, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../auth/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AvailabilityService } from '../stock/availability.service.js';
import { IntegrationApiKeyGuard } from './api-key.guard.js';

export const MATERIALS_LOOKUP_MAX = 200;

/** `codes=A,B` (ou `codes=A&codes=B`): separa por vírgula, tira espaços e vazios e remove repetidos, mantendo a ordem. */
export const splitCodes = (value: unknown): unknown => {
  const raw = Array.isArray(value) ? value.join(',') : value;
  return typeof raw === 'string' ? [...new Set(raw.split(',').map((c) => c.trim()).filter(Boolean))] : value;
};

export class MaterialsLookupQuery {
  @Transform(({ value }) => splitCodes(value))
  @IsArray({ message: 'Informe codes com os códigos dos materiais separados por vírgula.' })
  @ArrayMinSize(1, { message: 'Informe ao menos um código em codes.' })
  @ArrayMaxSize(MATERIALS_LOOKUP_MAX, { message: `No máximo ${MATERIALS_LOOKUP_MAX} códigos por consulta.` })
  @IsString({ each: true }) @MaxLength(40, { each: true, message: 'Código de material com mais de 40 caracteres.' })
  codes!: string[];

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

/** Consulta de materiais, custo e disponibilidade para o Core (envio de material para obra: preço da requisição, plano PT-04). */
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

  /** Itens na ordem pedida; código que não existe no catálogo volta em `notFound`. Custos com 4 casas (como a coluna). */
  async lookup(codes: string[], warehouseCode?: string): Promise<{ items: MaterialLookupItem[]; notFound: string[] }> {
    const warehouseId = await this.resolveWarehouseId(warehouseCode);
    const materials = await this.prisma.material.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true, shortDescription: true, status: true, averageCost: true, lastCost: true, stockUom: { select: { code: true } } },
    });
    const byCode = new Map(materials.map((m) => [m.code, m]));
    const availability = materials.length > 0 ? await this.availability.compute(materials.map((m) => m.id), { warehouseId }) : [];
    const stock = new Map(availability.map((a) => [a.material_id, a.available]));
    const items: MaterialLookupItem[] = [];
    const notFound: string[] = [];
    for (const code of codes) {
      const m = byCode.get(code);
      if (!m) { notFound.push(code); continue; }
      items.push({
        id: m.id, code: m.code, shortDescription: m.shortDescription, unit: m.stockUom.code,
        averageCost: m.averageCost?.toFixed(4) ?? null, lastCost: m.lastCost?.toFixed(4) ?? null,
        available: stock.get(m.id) ?? '0', active: m.status === 'ATIVO',
      });
    }
    return { items, notFound };
  }
}

/** Fora do JWT de usuário (`@Public()`); autenticado só pela chave `X-Api-Key` (a mesma `INTEGRATION_API_KEY`). */
@Public()
@UseGuards(IntegrationApiKeyGuard)
@Controller('integration')
export class MaterialsLookupController {
  constructor(private readonly svc: MaterialsLookupService) {}

  @Get('materials')
  lookup(@Query() q: MaterialsLookupQuery) { return this.svc.lookup(q.codes, q.warehouse_code); }
}
