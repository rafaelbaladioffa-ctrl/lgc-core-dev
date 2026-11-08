import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from './outbox.service.js';
import { costCenterEventPayload } from '../cost-centers/cost-centers.service.js';
import { collaboratorStatePayload } from '../collaborators/collaborators.service.js';
import { siteEventPayload } from '../sites/sites.service.js';

export interface MasterDataResyncResult {
  costCenters: number;
  collaborators: number;
  allocations: number;
  sites: number;
}

/**
 * Reenvia aos satélites o estado atual dos cadastros que eles guardam em cache: centros de custo,
 * colaboradores, a alocação vigente de cada colaborador e os sites dos clientes
 * (docs/integracao-centros-de-custo.md §6).
 *
 * Serve para a carga inicial de um satélite que passou a assinar esses eventos depois de os cadastros
 * existirem. Os eventos são os mesmos das escritas normais (`cost_center.updated`,
 * `collaborator.updated`, `collaborator.cost_center_changed`), então quem recebe trata como
 * atualização e pode receber o reenvio mais de uma vez sem duplicar. Do histórico de alocação vai só
 * a vigente: o satélite que precisar do histórico anterior não o recebe por aqui.
 */
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

      const sites = await tx.site.findMany({ orderBy: [{ clientId: 'asc' }, { code: 'asc' }] });
      for (const s of sites) await this.outbox.record(tx, 'site.updated', siteEventPayload(s));

      return { costCenters: costCenters.length, collaborators: collaborators.length, allocations, sites: sites.length };
    });
  }
}
