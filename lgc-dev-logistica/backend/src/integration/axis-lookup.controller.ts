import { BadRequestException, Controller, Get, Injectable, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { AXIS_KINDS, type AxisKind } from '../common/axis-cache.js';
import { splitCodes } from './materials-lookup.controller.js';

export const AXIS_LOOKUP_MAX_IDS = 200;
export const AXIS_LOOKUP_DEFAULT_LIMIT = 20;
export const AXIS_LOOKUP_MAX_LIMIT = 50;

/**
 * Consulta do cache de cadastros do Core para seletores e para trocar ids por nomes nas telas.
 * `kind` aceita um tipo ou vários separados por vírgula (ex.: `COLLABORATOR,USER` para pessoas).
 */
export class AxisLookupQuery {
  @Transform(({ value }) => splitCodes(value))
  @IsArray({ message: 'Informe kind (PROJECT, COST_CENTER, COLLABORATOR, USER, SITE ou CLIENT).' })
  @ArrayMinSize(1, { message: 'Informe kind (PROJECT, COST_CENTER, COLLABORATOR, USER, SITE ou CLIENT).' })
  @IsIn([...AXIS_KINDS], { each: true, message: 'kind inválido: use PROJECT, COST_CENTER, COLLABORATOR, USER, SITE ou CLIENT.' })
  kind!: AxisKind[];

  /** Texto a buscar no nome ou no código (contém, sem diferenciar maiúsculas). Sem texto, lista os primeiros por nome. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Informe search como texto.' }) @MaxLength(80, { message: 'search com mais de 80 caracteres.' })
  search?: string;

  /** Ids do Core a resolver (até 200, separados por vírgula): devolve ativos e inativos. */
  @IsOptional()
  @Transform(({ value }) => splitCodes(value))
  @IsArray() @ArrayMaxSize(AXIS_LOOKUP_MAX_IDS, { message: `No máximo ${AXIS_LOOKUP_MAX_IDS} ids por consulta.` })
  @IsString({ each: true }) @MaxLength(60, { each: true, message: 'Id com mais de 60 caracteres.' })
  ids?: string[];

  /** Na busca, inclui inativos (padrão: só ativos, que são os que podem ser escolhidos). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeInactive?: boolean;

  @IsOptional()
  @Type(() => Number) @IsInt({ message: 'limit inválido.' }) @Min(1, { message: 'limit deve ser ao menos 1.' })
  @Transform(({ value }) => (typeof value === 'number' && value > AXIS_LOOKUP_MAX_LIMIT ? AXIS_LOOKUP_MAX_LIMIT : value))
  @Max(AXIS_LOOKUP_MAX_LIMIT)
  limit?: number;
}

export interface AxisLookupItem {
  kind: string;
  id: string;
  code: string | null;
  name: string | null;
  active: boolean;
}

@Injectable()
export class AxisLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(q: AxisLookupQuery): Promise<{ items: AxisLookupItem[] }> {
    if (q.ids !== undefined && q.search !== undefined) throw new BadRequestException('Informe ids ou search, não os dois.');
    const select = { kind: true, axisId: true, code: true, name: true, active: true } satisfies Prisma.AxisMasterCacheSelect;
    let rows: Array<Prisma.AxisMasterCacheGetPayload<{ select: typeof select }>>;
    if (q.ids !== undefined) {
      if (q.ids.length === 0) return { items: [] };
      rows = await this.prisma.axisMasterCache.findMany({ where: { kind: { in: q.kind }, axisId: { in: q.ids } }, select });
    } else {
      const term = q.search;
      rows = await this.prisma.axisMasterCache.findMany({
        where: {
          kind: { in: q.kind },
          ...(!q.includeInactive && { active: true }),
          ...(term && { OR: [{ name: { contains: term, mode: 'insensitive' } }, { code: { contains: term, mode: 'insensitive' } }] }),
        },
        orderBy: [{ name: 'asc' }, { code: 'asc' }],
        take: q.limit ?? AXIS_LOOKUP_DEFAULT_LIMIT,
        select,
      });
    }
    return { items: rows.map((r) => ({ kind: r.kind, id: r.axisId, code: r.code, name: r.name, active: r.active })) };
  }
}

/**
 * `GET /axis/lookup`: cadastros do Core guardados no cache (id, código, nome, ativo), para os seletores das telas.
 * Qualquer usuário com `stock:read` (leitura básica de todos os perfis operacionais e do solicitante); não expõe e-mail nem dados
 * pessoais além do nome.
 */
@Controller('axis')
export class AxisLookupController {
  constructor(private readonly svc: AxisLookupService) {}

  @Get('lookup')
  @RequirePermissions('stock:read')
  lookup(@Query() q: AxisLookupQuery) {
    return this.svc.lookup(q);
  }
}
