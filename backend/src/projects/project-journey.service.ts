import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PROJECT_APPROVED_ORIGIN } from '../requests/envio-material.js';
import { buildJourney, currentStageSummary, type JourneyInput, type ProjectJourney } from './project-journey.js';

const JOURNEY_INCLUDE = {
  site: { select: { code: true, name: true } },
  quotes: { select: { id: true, revisionNumber: true, receivedAt: true, _count: { select: { materials: true } } }, orderBy: { revisionNumber: 'desc' } },
  quoteRequests: { select: { createdAt: true } },
  acceptance: { include: { projectQuote: { select: { revisionNumber: true } }, acceptedBy: { select: { email: true } } } },
  fieldWork: true,
} as const;

/**
 * Agregador da jornada do projeto (PT-11): lê o que o Core já tem (cotação, aceite, requisição de envio com a situação da
 * Logística, obra do Field) e entrega a linha do tempo pronta para a tela. Só leitura; nenhum valor de custo.
 */
@Injectable()
export class ProjectJourneyService {
  constructor(private readonly prisma: PrismaService) {}

  async journey(projectId: string): Promise<ProjectJourney> {
    const [input] = await this.load([projectId]);
    if (!input) throw new NotFoundException('Projeto não encontrado.');
    return buildJourney(input);
  }

  /** Etapa atual de cada projeto, em lote (uma consulta por tabela, não uma por projeto), para o selo da lista. */
  async currentStages(projectIds: string[]) {
    const inputs = await this.load(projectIds);
    return Object.fromEntries(inputs.map((input) => [input.project.id, currentStageSummary(buildJourney(input))]));
  }

  private async load(projectIds: string[]): Promise<JourneyInput[]> {
    if (projectIds.length === 0) return [];
    const [projects, requests, satellites] = await Promise.all([
      this.prisma.project.findMany({ where: { id: { in: projectIds } }, include: JOURNEY_INCLUDE }),
      this.prisma.request.findMany({
        where: { projectId: { in: projectIds }, origin: PROJECT_APPROVED_ORIGIN },
        select: {
          id: true,
          code: true,
          status: true,
          projectId: true,
          sourceRef: true,
          createdAt: true,
          closedAt: true,
          neededBy: true,
          formData: true,
          approvals: { select: { status: true, decidedAt: true, stepOrder: true, approver: { select: { fullName: true } } }, orderBy: { stepOrder: 'asc' } },
        },
      }),
      this.prisma.integrationSatellite.findMany({ where: { status: 'active' }, select: { name: true, frontendUrl: true } }),
    ]);
    // Satélites pelo nome (como a inbox faz: "logistica", "financeiro", "field", com ou sem prefixo de ambiente).
    const frontendOf = (part: string) => satellites.find((s) => s.frontendUrl && s.name.toLowerCase().includes(part))?.frontendUrl ?? null;
    const fieldFrontendUrl = frontendOf('field');
    const financeiroFrontendUrl = frontendOf('financeiro');

    return projects.map((project) => {
      const acceptance = project.acceptance;
      const projectRequests = requests.filter((r) => r.projectId === project.id);
      const request = (acceptance ? projectRequests.find((r) => r.sourceRef === acceptance.projectQuoteId) : null) ?? null;
      return {
        project: { id: project.id, code: project.code, name: project.name, status: project.status, siteId: project.siteId, site: project.site, updatedAt: project.updatedAt },
        quoteRequests: project.quoteRequests,
        quotes: project.quotes.map((q) => ({ id: q.id, revisionNumber: q.revisionNumber, receivedAt: q.receivedAt, materialsCount: q._count.materials })),
        acceptance: acceptance
          ? {
              projectQuoteId: acceptance.projectQuoteId,
              revisionNumber: acceptance.projectQuote.revisionNumber,
              clientPoNumber: acceptance.clientPoNumber,
              acceptedAt: acceptance.acceptedAt,
              acceptedByEmail: acceptance.acceptedBy.email,
            }
          : null,
        request: request
          ? {
              id: request.id,
              code: request.code,
              status: request.status,
              createdAt: request.createdAt,
              closedAt: request.closedAt,
              neededBy: request.neededBy,
              formData: request.formData,
              approvals: request.approvals.map((a) => ({ status: a.status, approverName: a.approver.fullName, decidedAt: a.decidedAt })),
            }
          : null,
        fieldWork: project.fieldWork,
        fieldFrontendUrl,
        financeiroFrontendUrl,
      };
    });
  }
}
