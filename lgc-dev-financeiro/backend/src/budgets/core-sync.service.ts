import { BadGatewayException, ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';

interface CoreProject {
  id: string;
  code: string;
  clientId: string;
  costCenterId?: string;
  responsibleCollaboratorId?: string;
  status: string;
  updatedAt: string;
}
interface CoreClient {
  id: string;
  code: number | string;
  legalName: string;
  cnpj?: string | null;
  updatedAt: string;
}

const INACTIVE_PROJECT_STATUS = ['encerrado'];

/**
 * Carga de projetos e clientes do Core para o cache, sem esperar o webhook (especificação §2.5).
 * Usa o access token de quem pediu: o Core aplica as permissões dessa pessoa (project:read, client:read).
 * Como no webhook, um registro mais antigo nunca sobrescreve um mais novo.
 */
@Injectable()
export class CoreSyncService {
  private readonly logger = new Logger(CoreSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl() {
    return (this.config.get<string>('AXIS_API_URL') || 'http://localhost:3000/api/v1').replace(/\/+$/, '');
  }

  private async fetchCore<T>(path: string, bearer: string, fetchFn: typeof fetch): Promise<T> {
    let res: Response;
    try {
      res = await fetchFn(`${this.baseUrl}${path}`, { headers: { Authorization: bearer }, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      this.logger.error(`Core indisponível em ${path}: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Não foi possível falar com o Axis Core. Tente novamente em instantes.');
    }
    if (res.status === 401 || res.status === 403) throw new ForbiddenException('O Axis Core recusou a consulta: seu usuário precisa ver projetos e clientes no Core.');
    if (!res.ok) throw new BadGatewayException(`O Axis Core respondeu ${res.status} ao listar ${path.slice(1)}.`);
    return (await res.json()) as T;
  }

  async syncProjectsAndClients(user: AuthenticatedUser, bearer: string, fetchFn: typeof fetch = fetch) {
    const [clients, projects] = await Promise.all([this.fetchCore<CoreClient[]>('/clients', bearer, fetchFn), this.fetchCore<CoreProject[]>('/projects', bearer, fetchFn)]);
    let updated = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const c of clients) {
        updated += await this.upsert(tx, 'CLIENT', c.id, String(c.code), c.legalName, true, { client_id: c.id, code: c.code, name: c.legalName, cnpj: c.cnpj ?? null }, c.updatedAt);
      }
      for (const p of projects) {
        const data = { project_id: p.id, code: p.code, status: p.status, client_id: p.clientId, cost_center_id: p.costCenterId ?? null, responsible_collaborator_id: p.responsibleCollaboratorId ?? null };
        updated += await this.upsert(tx, 'PROJECT', p.id, p.code, null, !INACTIVE_PROJECT_STATUS.includes(p.status), data, p.updatedAt);
      }
      await this.audit.record(user.userId, 'master_cache.synced', 'axis_master_cache', 'PROJECT', { clients: clients.length, projects: projects.length, updated }, tx);
    });
    return { clients: clients.length, projects: projects.length, updated };
  }

  private async upsert(tx: Prisma.TransactionClient, kind: string, axisId: string, code: string, name: string | null, active: boolean, data: Prisma.InputJsonValue, occurredAt: string) {
    const at = new Date(occurredAt);
    const existing = await tx.axisMasterCache.findUnique({ where: { kind_axisId: { kind, axisId } }, select: { sourceOccurredAt: true, name: true } });
    if (existing && existing.sourceOccurredAt > at) return 0;
    await tx.axisMasterCache.upsert({
      where: { kind_axisId: { kind, axisId } },
      create: { kind, axisId, code, name, active, data, sourceOccurredAt: at },
      update: { code, name: name ?? existing?.name ?? null, active, data, sourceOccurredAt: at, syncedAt: new Date() },
    });
    return 1;
  }
}
