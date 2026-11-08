import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from './outbox.service.js';
import { costCenterEventPayload } from '../cost-centers/cost-centers.service.js';
import { collaboratorStatePayload } from '../collaborators/collaborators.service.js';
import { siteEventPayload } from '../sites/sites.service.js';
import { clientEventPayload } from '../clients/clients.service.js';
import { SNAPSHOT_INCLUDE, projectEventPayload } from '../projects/projects.service.js';
import { userEventPayload, userEventType } from '../users/users.service.js';
import { jobTitleEventPayload } from '../job-titles/job-titles.service.js';
import { holidayEventPayload } from '../holidays/holidays.service.js';

export interface MasterDataResyncResult {
  costCenters: number;
  collaborators: number;
  allocations: number;
  sites: number;
  clients: number;
  projects: number;
  users: number;
  jobTitles: number;
  holidays: number;
}

/**
 * Reenvia aos satélites o estado atual dos cadastros que eles guardam em cache: centros de custo,
 * colaboradores, a alocação vigente de cada colaborador, clientes, sites, projetos, usuários, cargos e
 * feriados (docs/integracao-centros-de-custo.md §6 e docs/mapa-interoperabilidade.md §6).
 *
 * Serve para a carga inicial de um satélite que passou a assinar esses eventos depois de os cadastros
 * existirem. Os eventos são os mesmos das escritas normais (`cost_center.updated`,
 * `collaborator.updated`, `collaborator.cost_center_changed`, `client.updated`, `site.updated`,
 * `project.updated`, `user.updated`/`user.disabled`, `job_title.updated`, `holiday.updated`), com o
 * estado completo, então quem recebe trata como atualização e pode receber o reenvio mais de uma vez
 * sem duplicar. Do histórico de alocação vai só a vigente: o satélite que precisar do histórico
 * anterior não o recebe por aqui. Fica de fora o que é do sistema (colaborador e usuário "Axis (automático)").
 */
/** Um insert no outbox por cadastro: o limite padrão de 5 s da transação interativa não basta para a base inteira. */
const RESYNC_TRANSACTION = { maxWait: 10_000, timeout: 120_000 };

@Injectable()
export class MasterDataResyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async resync(): Promise<MasterDataResyncResult> {
    return this.prisma.$transaction(async (tx) => {
      const costCenters = await tx.costCenter.findMany({ orderBy: { code: 'asc' } });
      for (const cc of costCenters) await this.outbox.record(tx, 'cost_center.updated', costCenterEventPayload(cc));

      const collaborators = await tx.collaborator.findMany({
        where: { isSystem: false },
        include: { jobTitle: true, workSchedule: true, costCenter: true },
        orderBy: { fullName: 'asc' },
      });
      for (const c of collaborators) await this.outbox.record(tx, 'collaborator.updated', collaboratorStatePayload(c));

      const byId = new Map(collaborators.map((c) => [c.id, c]));
      const open = await tx.collaboratorCostCenterAllocation.findMany({ where: { validTo: null }, orderBy: { validFrom: 'asc' } });
      let allocations = 0;
      for (const a of open) {
        const c = byId.get(a.collaboratorId);
        if (!c) continue;
        await this.outbox.record(tx, 'collaborator.cost_center_changed', {
          collaborator_id: c.id,
          name: c.fullName,
          job_title_id: c.jobTitleId,
          job_title_name: c.jobTitle.name,
          previous_cost_center_id: null,
          cost_center_id: a.costCenterId,
          valid_from: a.validFrom.toISOString().slice(0, 10),
        });
        allocations++;
      }

      // Cliente antes de site e projeto: quem recebe na ordem de criação já tem o cliente no cache.
      const clients = await tx.client.findMany({ orderBy: { code: 'asc' } });
      for (const c of clients) await this.outbox.record(tx, 'client.updated', clientEventPayload(c));

      const sites = await tx.site.findMany({ orderBy: [{ clientId: 'asc' }, { code: 'asc' }] });
      for (const s of sites) await this.outbox.record(tx, 'site.updated', siteEventPayload(s));

      const projects = await tx.project.findMany({ include: SNAPSHOT_INCLUDE, orderBy: { code: 'asc' } });
      for (const p of projects) await this.outbox.record(tx, 'project.updated', projectEventPayload(p));

      const users = await tx.user.findMany({
        where: { NOT: { collaborator: { isSystem: true } } },
        include: { collaborator: { select: { fullName: true } }, userRoles: { include: { role: { select: { name: true } } } } },
        orderBy: { email: 'asc' },
      });
      for (const u of users) await this.outbox.record(tx, userEventType(u.status), userEventPayload(u));

      const jobTitles = await tx.jobTitle.findMany({ orderBy: { name: 'asc' } });
      for (const j of jobTitles) await this.outbox.record(tx, 'job_title.updated', jobTitleEventPayload(j));

      const holidays = await tx.holiday.findMany({ orderBy: { date: 'asc' } });
      for (const h of holidays) await this.outbox.record(tx, 'holiday.updated', holidayEventPayload(h));

      return {
        costCenters: costCenters.length,
        collaborators: collaborators.length,
        allocations,
        sites: sites.length,
        clients: clients.length,
        projects: projects.length,
        users: users.length,
        jobTitles: jobTitles.length,
        holidays: holidays.length,
      };
    }, RESYNC_TRANSACTION);
  }
}
