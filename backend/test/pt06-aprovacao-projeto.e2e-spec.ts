import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
import { ProjectApprovalService } from '../src/projects/project-approval.service.js';
import { RequestsService } from '../src/requests/requests.service.js';
import { ShipmentRequestsService } from '../src/requests/shipment-requests.service.js';
import { OutboxService } from '../src/integration/outbox.service.js';
import { DelegationsService } from '../src/delegations/delegations.service.js';
import { requireTestDatabaseUrl } from './support/test-database.js';

/**
 * PT-06 contra um PostgreSQL de verdade (banco `_test` com as migrações aplicadas, inclusive a do usuário de sistema
 * e da categoria `envio_material`): aprovação do projeto, requisição automática única, aprovação pelo responsável do
 * CC com o evento para a Logística e cancelamento. Só roda com TEST_DATABASE_URL; todo registro é sintético.
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)('PT-06 — aprovar projeto e requisição de envio de material (banco real)', () => {
  let prisma: PrismaClient;
  let approval: ProjectApprovalService;
  let requests: RequestsService;
  let shipments: ShipmentRequestsService;
  let outbox: OutboxService;
  const tag = `pt06-${randomUUID().slice(0, 8)}`;
  const ids: Record<string, string> = {};

  const eventsOf = async (projectOrRequestId: string) => {
    const rows = await prisma.integrationOutbox.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.filter((r) => JSON.stringify(r.payload).includes(projectOrRequestId));
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: requireTestDatabaseUrl() } } });
    await prisma.$connect();
    outbox = new OutboxService();
    const logistics = {
      lookup: vi.fn().mockResolvedValue({
        ok: true,
        notFound: [],
        materials: new Map([[`${tag}-CAB`, { id: 'mat-1', code: `${tag}-CAB`, averageCost: '3.3000' }]]),
      }),
    };
    const config = { get: () => undefined };
    approval = new ProjectApprovalService(prisma as any, outbox, logistics as any, config as any);
    requests = new RequestsService(prisma as any, outbox, new DelegationsService(prisma as any), {} as any, {} as any);
    shipments = new ShipmentRequestsService(prisma as any);

    const sector = await prisma.sector.create({ data: { code: tag, name: `${tag}-setor` } });
    const jobTitle = await prisma.jobTitle.create({ data: { name: `${tag}-cargo` } });
    const person = (suffix: string) =>
      prisma.collaborator.create({
        data: {
          fullName: `${tag}-${suffix}`,
          rgEnc: 'synthetic',
          cpfEnc: 'synthetic',
          cpfHash: `${tag}-${suffix}`,
          corporateEmail: `${tag}-${suffix}@example.invalid`,
          matricula: `${tag}-${suffix}`,
          sectorId: sector.id,
          jobTitleId: jobTitle.id,
        },
      });
    // O responsável do projeto é também o responsável do CC: o solicitante é o sistema, então ele continua aprovando.
    const responsible = await person('resp');
    const costCenter = await prisma.costCenter.create({
      data: { code: tag, name: `${tag}-cc`, sectorId: sector.id, responsibleCollaboratorId: responsible.id },
    });
    const client = await prisma.client.create({ data: { code: randomInt(1_000_000, 2_000_000_000), legalName: `${tag}-cliente` } });
    const site = await prisma.site.create({
      data: { clientId: client.id, code: 'GRU53', name: `${tag}-site`, addressStreet: 'Rod. X', addressNumber: '100', addressCity: 'Guarulhos', addressState: 'SP', latitude: -23.4, longitude: -46.5 },
    });
    const project = await prisma.project.create({
      data: {
        code: `${tag}-PROP`,
        name: `${tag}-projeto`,
        clientId: client.id,
        costCenterId: costCenter.id,
        responsibleCollaboratorId: responsible.id,
        siteId: site.id,
        plannedStartDate: new Date('2026-12-07T00:00:00Z'),
        proposalSequence: 1,
      },
    });
    const user = await prisma.user.create({ data: { email: `${tag}@example.invalid`, passwordHash: '!', status: 'disabled' } });
    const satellite = await prisma.integrationSatellite.create({
      data: { name: `${tag}-financeiro`, webhookUrl: 'http://localhost:0', hmacSecretEnc: 'x', apiKeyHash: 'x' },
    });
    const quote = await prisma.projectQuote.create({
      data: {
        projectId: project.id,
        satelliteId: satellite.id,
        externalRevisionId: `${tag}-rev`,
        revisionNumber: 1,
        workDays: new Prisma.Decimal('10'),
        plannedStartDate: new Date('2026-12-07T00:00:00Z'),
        plannedEndDate: new Date('2026-12-18T00:00:00Z'),
        team: [{ role_key: 'tecnico', role_name: 'Técnico', field_role: true, people: 5, days: 10, hours: 400 }],
        fieldPeople: 5,
        totalHours: new Prisma.Decimal('400'),
        materials: { create: [{ materialCode: `${tag}-CAB`, description: 'Cabo óptico 12F', unit: 'm', quantity: new Prisma.Decimal('1200') }] },
      },
    });
    Object.assign(ids, { sector: sector.id, responsible: responsible.id, project: project.id, user: user.id, quote: quote.id, costCenter: costCenter.id, client: client.id });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('o usuário de sistema não faz login e o colaborador dele fica fora das listas', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'axis-automatico@sistema.axis.local' }, include: { collaborator: true } });
    expect(user.status).toBe('disabled');
    expect(user.passwordHash).toBe('!');
    expect(user.collaborator).toMatchObject({ isSystem: true, status: 'desligado', fullName: 'Axis (automático)' });
  });

  it('aprovar o projeto grava status, aceite, requisição e eventos numa transação só', async () => {
    const result = await approval.approve(ids.project, { clientPoNumber: 'PO-123' }, ids.user);

    expect(result.status).toBe('aprovado');
    expect(result.materialRequest).toMatchObject({ status: 'aguardando_aprovacao' });
    const acceptance = await prisma.projectAcceptance.findUniqueOrThrow({ where: { projectId: ids.project } });
    expect(acceptance).toMatchObject({ projectQuoteId: ids.quote, clientPoNumber: 'PO-123', acceptedByUserId: ids.user });

    const request = await prisma.request.findUniqueOrThrow({ where: { id: result.materialRequest!.id }, include: { approvals: true, requester: true } });
    expect(request).toMatchObject({ origin: 'projeto_aprovado', sourceRef: ids.quote, projectId: ids.project, costCenterId: ids.costCenter, status: 'aguardando_aprovacao' });
    expect(request.requester.isSystem).toBe(true);
    expect(request.beneficiaryId).toBe(request.requesterId);
    expect(request.estimatedValue?.toFixed(2)).toBe('3960.00'); // 1200 × 3,30
    expect(request.neededBy?.toISOString().slice(0, 10)).toBe('2026-11-30');
    expect(request.approvals).toHaveLength(1);
    expect(request.approvals[0]).toMatchObject({ approverId: ids.responsible, approvalSource: 'centro_custo', status: 'pendente' });
    ids.request = request.id;

    const types = (await eventsOf(ids.project)).map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(['project.status_changed', 'project.approved']));
    expect((await eventsOf(request.id)).map((e) => e.eventType)).toContain('request.submitted');
    const approved = (await eventsOf(ids.project)).find((e) => e.eventType === 'project.approved')!.payload as Record<string, any>;
    expect(approved).toMatchObject({ project_id: ids.project, status: 'aprovado', material_request_id: request.id, client_po_number: 'PO-123', approved_by_user_id: ids.user });
    expect(approved.accepted_quote).toMatchObject({ project_quote_id: ids.quote, revision_number: 1, work_days: 10, planned_start_date: '2026-12-07' });
  });

  it('aprovar de novo não duplica: o status barra e o índice (origin, source_ref) é a trava final', async () => {
    await expect(approval.approve(ids.project, {}, ids.user)).rejects.toThrow(/Não é possível mudar o projeto de "aprovado" para "aprovado"/);
    const base = await prisma.request.findUniqueOrThrow({ where: { id: ids.request } });
    await expect(
      prisma.request.create({
        data: {
          code: `${tag}-DUP`,
          categoryVersionId: base.categoryVersionId,
          sectorId: base.sectorId,
          requesterId: base.requesterId,
          beneficiaryId: base.beneficiaryId,
          title: 'duplicada',
          description: 'duplicada',
          origin: 'projeto_aprovado',
          sourceRef: ids.quote,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.request.count({ where: { origin: 'projeto_aprovado', sourceRef: ids.quote } })).toBe(1);
  });

  it('o aceite e a requisição aparecem em GET /projects/:id/acceptance', async () => {
    const view = await approval.getAcceptance(ids.project);
    expect(view.acceptance).toMatchObject({ revisionNumber: 1, clientPoNumber: 'PO-123' });
    expect(view.materialRequest).toMatchObject({ id: ids.request, status: 'aguardando_aprovacao', estimatedValue: '3960.00', neededBy: '2026-11-30' });
  });

  it('o responsável do CC (que também é o responsável do projeto) aprova e a Logística recebe material_request.approved', async () => {
    const updated = await requests.approve(ids.request, ids.responsible, {} as any);
    expect(updated.status).toBe('em_atendimento');

    const events = await eventsOf(ids.request);
    const sent = events.find((e) => e.eventType === 'material_request.approved')!.payload as Record<string, any>;
    expect(sent).toMatchObject({
      request_id: ids.request,
      version: 1,
      project_id: ids.project,
      cost_center_id: ids.costCenter,
      requester_id: null,
      recipient_id: ids.responsible,
      warehouse_code: null,
      needed_by: '2026-11-30',
      destination: { site_code: 'GRU53', address: 'Rod. X, 100', city: 'Guarulhos', state: 'SP', latitude: -23.4, longitude: -46.5 },
      items: [{ material_code: `${tag}-CAB`, quantity: '1200.000' }],
    });
    const stored = await prisma.request.findUniqueOrThrow({ where: { id: ids.request }, include: { slaClocks: true } });
    expect(stored.status).toBe('em_atendimento');
    expect(stored.slaClocks.every((c) => c.stoppedAt !== null)).toBe(true);
  });

  it('cancelar depois de aprovada emite material_request.cancel_requested', async () => {
    const cancelled = await requests.cancel(ids.request, ids.responsible, true, { reason: 'Obra suspensa' } as any, ['admin']);
    expect(cancelled.status).toBe('cancelada');
    const cancel = (await eventsOf(ids.request)).find((e) => e.eventType === 'material_request.cancel_requested')!;
    expect(cancel.payload).toMatchObject({ request_id: ids.request, reason: 'Obra suspensa' });
  });

  it('sem materiais na cotação aceita: aprova o projeto e não cria requisição', async () => {
    const project = await prisma.project.create({
      data: { code: `${tag}-SEMMAT`, name: `${tag}-sem-materiais`, clientId: ids.client, costCenterId: ids.costCenter, responsibleCollaboratorId: ids.responsible, siteId: (await prisma.site.findFirstOrThrow({ where: { clientId: ids.client } })).id, proposalSequence: 2 },
    });
    const satellite = await prisma.integrationSatellite.findFirstOrThrow({ where: { name: `${tag}-financeiro` } });
    await prisma.projectQuote.create({
      data: { projectId: project.id, satelliteId: satellite.id, externalRevisionId: `${tag}-rev-vazia`, revisionNumber: 1, workDays: new Prisma.Decimal('5'), team: [], fieldPeople: 0, totalHours: new Prisma.Decimal('0') },
    });
    const result = await approval.approve(project.id, {}, ids.user);
    expect(result).toMatchObject({ status: 'aprovado', materialRequest: null, withoutMaterials: true });
    expect(await prisma.request.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.projectAcceptance.count({ where: { projectId: project.id } })).toBe(1);
  });

  it('sem responsável no CC nem no pai: fica sem aprovador e "Reavaliar aprovador" cria a linha depois do cadastro', async () => {
    const costCenter = await prisma.costCenter.create({ data: { code: `${tag}-sem`, name: `${tag}-cc-sem-resp`, sectorId: ids.sector } });
    const site = await prisma.site.findFirstOrThrow({ where: { clientId: ids.client } });
    const project = await prisma.project.create({
      data: { code: `${tag}-SEMAPR`, name: `${tag}-sem-aprovador`, clientId: ids.client, costCenterId: costCenter.id, responsibleCollaboratorId: ids.responsible, siteId: site.id, proposalSequence: 3 },
    });
    const satellite = await prisma.integrationSatellite.findFirstOrThrow({ where: { name: `${tag}-financeiro` } });
    await prisma.projectQuote.create({
      data: {
        projectId: project.id,
        satelliteId: satellite.id,
        externalRevisionId: `${tag}-rev-sem-aprovador`,
        revisionNumber: 1,
        workDays: new Prisma.Decimal('5'),
        team: [],
        fieldPeople: 0,
        totalHours: new Prisma.Decimal('0'),
        materials: { create: [{ materialCode: `${tag}-CAB`, description: 'Cabo', unit: 'm', quantity: new Prisma.Decimal('10') }] },
      },
    });
    const result = await approval.approve(project.id, {}, ids.user);
    const request = await prisma.request.findUniqueOrThrow({ where: { id: result.materialRequest!.id }, include: { approvals: true } });
    expect(request.status).toBe('aguardando_aprovacao');
    expect(request.approvals).toHaveLength(0);

    await expect(shipments.resolveApprover(request.id, ids.responsible)).rejects.toThrow(/continua sem responsável/);
    await prisma.costCenter.update({ where: { id: costCenter.id }, data: { responsibleCollaboratorId: ids.responsible } });
    await shipments.resolveApprover(request.id, ids.responsible);
    const after = await prisma.requestApproval.findMany({ where: { requestId: request.id } });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ approverId: ids.responsible, approvalSource: 'centro_custo', status: 'pendente' });
  });
});
