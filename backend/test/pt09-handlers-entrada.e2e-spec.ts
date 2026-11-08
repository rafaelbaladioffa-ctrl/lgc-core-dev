import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
import { ProjectApprovalService } from '../src/projects/project-approval.service.js';
import { ProjectsService } from '../src/projects/projects.service.js';
import { RequestsService } from '../src/requests/requests.service.js';
import { OutboxService } from '../src/integration/outbox.service.js';
import { DelegationsService } from '../src/delegations/delegations.service.js';
import { InboundEventsService } from '../src/integration/inbound/inbound-events.service.js';
import { InboundHandlerRegistry } from '../src/integration/inbound/inbound-handler.registry.js';
import { LogisticsFulfillmentHandler } from '../src/integration/inbound/handlers/logistics-fulfillment.handler.js';
import { FieldProjectHandler } from '../src/integration/inbound/handlers/field-project.handler.js';
import { deliveredByMaterial, logisticsOf } from '../src/requests/envio-logistica.js';
import { requireTestDatabaseUrl } from './support/test-database.js';

/**
 * PT-09 contra um PostgreSQL de verdade (banco `_test` com as migrações aplicadas): o receptor real da inbox com os
 * handlers da Logística e do Field, na transação real (travas `FOR UPDATE`, JSON, decimais e a volta atrás quando o
 * handler falha). Só roda com TEST_DATABASE_URL; todo registro é sintético.
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)('PT-09 — handlers de entrada (banco real)', () => {
  let prisma: PrismaClient;
  let inbound: InboundEventsService;
  let projects: ProjectsService;
  const tag = `pt09-${randomUUID().slice(0, 8)}`;
  const ids: Record<string, string> = {};
  const sats: Record<string, { id: string; name: string }> = {};
  let seq = 0;

  const send = (satellite: 'logistica' | 'field' | 'financeiro', eventType: string, payload: Record<string, unknown>, occurredAt = new Date()) => {
    seq += 1;
    return inbound.receive(
      sats[satellite],
      { event_id: `${tag}-ev-${seq}`, event_type: eventType, occurred_at: occurredAt.toISOString(), source: satellite, payload },
      {},
    );
  };
  const requestRow = () => prisma.request.findUniqueOrThrow({ where: { id: ids.request } });
  const projectRow = () => prisma.project.findUniqueOrThrow({ where: { id: ids.project } });
  const outboxTypes = async (id: string) =>
    (await prisma.integrationOutbox.findMany({ orderBy: { createdAt: 'asc' } })).filter((r) => JSON.stringify(r.payload).includes(id)).map((r) => r.eventType);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: requireTestDatabaseUrl() } } });
    await prisma.$connect();
    const outbox = new OutboxService();
    const registry = new InboundHandlerRegistry([new LogisticsFulfillmentHandler(outbox), new FieldProjectHandler(outbox)]);
    inbound = new InboundEventsService(prisma as any, registry);
    projects = new ProjectsService(prisma as any, outbox);
    const logistics = {
      lookup: vi.fn().mockResolvedValue({ ok: true, notFound: [], materials: new Map([[`${tag}-CAB`, { id: 'mat-1', code: `${tag}-CAB`, averageCost: '3.3000' }]]) }),
    };
    const approval = new ProjectApprovalService(prisma as any, outbox, logistics as any, { get: () => undefined } as any);
    const requests = new RequestsService(prisma as any, outbox, new DelegationsService(prisma as any), {} as any, {} as any);

    for (const name of ['logistica', 'field', 'financeiro'] as const) {
      const satellite = await prisma.integrationSatellite.create({ data: { name: `${tag}-${name}`, webhookUrl: 'http://localhost:0', hmacSecretEnc: 'x', apiKeyHash: 'x' } });
      sats[name] = { id: satellite.id, name: satellite.name };
    }
    const sector = await prisma.sector.create({ data: { code: tag, name: `${tag}-setor` } });
    const jobTitle = await prisma.jobTitle.create({ data: { name: `${tag}-cargo` } });
    const responsible = await prisma.collaborator.create({
      data: { fullName: `${tag}-resp`, rgEnc: 'synthetic', cpfEnc: 'synthetic', cpfHash: `${tag}-resp`, corporateEmail: `${tag}-resp@example.invalid`, matricula: `${tag}-resp`, sectorId: sector.id, jobTitleId: jobTitle.id },
    });
    const costCenter = await prisma.costCenter.create({ data: { code: tag, name: `${tag}-cc`, sectorId: sector.id, responsibleCollaboratorId: responsible.id } });
    const client = await prisma.client.create({ data: { code: randomInt(1_000_000, 2_000_000_000), legalName: `${tag}-cliente` } });
    const site = await prisma.site.create({ data: { clientId: client.id, code: 'GRU53', name: `${tag}-site`, addressCity: 'Guarulhos', addressState: 'SP' } });
    const project = await prisma.project.create({
      data: { code: `${tag}-PROP`, name: `${tag}-projeto`, clientId: client.id, costCenterId: costCenter.id, responsibleCollaboratorId: responsible.id, siteId: site.id, plannedStartDate: new Date('2026-12-07T00:00:00Z'), proposalSequence: 1 },
    });
    const user = await prisma.user.create({ data: { email: `${tag}@example.invalid`, passwordHash: '!', status: 'disabled' } });
    await prisma.projectQuote.create({
      data: {
        projectId: project.id,
        satelliteId: sats.financeiro.id,
        externalRevisionId: `${tag}-rev`,
        revisionNumber: 1,
        workDays: new Prisma.Decimal('10'),
        team: [],
        fieldPeople: 5,
        totalHours: new Prisma.Decimal('400'),
        materials: { create: [{ materialCode: `${tag}-CAB`, description: 'Cabo óptico 12F', unit: 'm', quantity: new Prisma.Decimal('1200') }] },
      },
    });
    const approved = await approval.approve(project.id, { clientPoNumber: 'PO-9' }, user.id);
    await requests.approve(approved.materialRequest!.id, responsible.id, {} as any);
    Object.assign(ids, { project: project.id, request: approved.materialRequest!.id, responsible: responsible.id });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('a requisição de envio acompanha a Logística até o encerramento', async () => {
    expect((await requestRow()).status).toBe('em_atendimento');

    // Fora de ordem de propósito: o expedido chega antes do criado.
    const dispatchedAt = new Date('2026-11-12T13:00:00Z');
    await send('logistica', 'shipment.dispatched', { axis_request_id: ids.request, request_version: 1, order_code: 'ATD-1', status: 'EXPEDIDA', shipment_id: 'sh-1', manifest: 'ROM-9', carrier: 'Rápido', dispatched_at: dispatchedAt.toISOString(), items: [{ material_code: `${tag}-CAB`, quantity: '1200.000' }] }, dispatchedAt);
    expect((await requestRow()).status).toBe('aguardando_entrega');

    await send('logistica', 'fulfillment.created', { axis_request_id: ids.request, request_version: 1, order_code: 'ATD-1', status: 'RESERVADA_PARCIAL', items: [{ material_code: `${tag}-CAB`, quantity: '1200.000', reserved: '900.000', shortage: '300.000' }] }, new Date('2026-11-10T10:00:00Z'));
    let request = await requestRow();
    expect(request.status).toBe('aguardando_entrega');
    expect(logisticsOf(request.formData)).toMatchObject({ orderCode: 'ATD-1', status: 'EXPEDIDA', stage: 2 });

    await send('logistica', 'delivery.partial', { axis_request_id: ids.request, request_version: 1, status: 'EXPEDIDA', shipment_id: 'sh-1', pending_packages: 1, delivered_at: '2026-11-13T10:00:00Z', items: [{ material_code: `${tag}-CAB`, quantity: '800.000' }] });
    await send('logistica', 'delivery.confirmed', { axis_request_id: ids.request, request_version: 1, status: 'ENTREGUE', shipment_id: 'sh-1', pending_packages: 0, delivered_at: '2026-11-14T10:00:00Z', receiver_name: 'Fulano', items: [{ material_code: `${tag}-CAB`, quantity: '400.000' }] });

    request = await requestRow();
    expect(request.status).toBe('encerrada');
    expect(request.closedAt?.toISOString()).toBe('2026-11-14T10:00:00.000Z');
    expect(request.completedAt).not.toBeNull();
    expect(request.requesterAcceptedAt).not.toBeNull();
    expect(deliveredByMaterial(logisticsOf(request.formData)!).get(`${tag}-CAB`)!.toFixed(3)).toBe('1200.000');

    const comments = await prisma.requestComment.findMany({ where: { requestId: ids.request }, orderBy: { createdAt: 'asc' }, include: { author: true } });
    expect(comments.some((c) => c.body.startsWith('Expedido para o site GRU53'))).toBe(true);
    expect(comments.every((c) => c.author.isSystem || c.authorId)).toBe(true);
    const types = await outboxTypes(ids.request);
    expect(types).toEqual(expect.arrayContaining(['request.completed', 'request.status_changed']));
    expect(await prisma.integrationInbox.count({ where: { satelliteId: sats.logistica.id, status: 'processed' } })).toBe(4);
  });

  it('repetir o evento devolve o mesmo resultado sem reprocessar', async () => {
    const before = (await prisma.requestComment.count({ where: { requestId: ids.request } }));
    const eventId = `${tag}-repetido`;
    const body = { event_id: eventId, event_type: 'delivery.refused', occurred_at: new Date().toISOString(), payload: { axis_request_id: ids.request, request_version: 1, status: 'DIVERGENCIA', reason: 'Avaria', items: [] } };
    const first = await inbound.receive(sats.logistica, body, {});
    const second = await inbound.receive(sats.logistica, body, {});
    expect(first).toMatchObject({ status: 'processed', duplicate: false });
    expect(second).toMatchObject({ status: 'processed', duplicate: true });
    expect(await prisma.requestComment.count({ where: { requestId: ids.request } })).toBe(before + 1);
  });

  it('evento do satélite errado ou de requisição inexistente vira failed com motivo legível e nada fica gravado', async () => {
    const before = await prisma.requestComment.count({ where: { requestId: ids.request } });
    await expect(send('financeiro', 'shipment.dispatched', { axis_request_id: ids.request, status: 'EXPEDIDA' })).rejects.toThrow();
    await expect(send('logistica', 'field.project.started', { axis_project_id: ids.project, field_project_id: 1 })).rejects.toThrow();
    await expect(send('logistica', 'delivery.confirmed', { axis_request_id: randomUUID(), status: 'ENTREGUE' })).rejects.toThrow();
    const failed = await prisma.integrationInbox.findMany({ where: { status: 'failed', satelliteId: { in: [sats.logistica.id, sats.financeiro.id] } } });
    expect(failed).toHaveLength(3);
    expect(failed.map((row) => row.error)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('só é aceito do satélite Logística, mas chegou de'),
        expect.stringContaining('só é aceito do satélite Field, mas chegou de'),
        expect.stringContaining('não encontrada no Core'),
      ]),
    );
    expect(await prisma.requestComment.count({ where: { requestId: ids.request } })).toBe(before);
  });

  it('o Field cria, inicia (projeto em execução), avança e conclui a obra', async () => {
    const base = { axis_project_id: ids.project, field_project_id: 42 };
    await send('field', 'field.project.progress', { ...base, date: '2026-11-16', percent_complete: '25.50', tasks_total: 12, tasks_done: 3, real_man_hours: '40.50', planned_man_hours: '400.00' }, new Date('2026-11-16T22:00:00Z'));
    await send('field', 'field.project.created', { ...base, field_project_code: 'CSTR-PROJ-0042', url: 'https://field.example/projetos/42', status: 'planning', sow_plan_status: 'generated', tasks_count: 12, created_at: '2026-11-09T10:00:00Z' });
    await send('field', 'field.project.progress', { ...base, date: '2026-11-15', percent_complete: '10.00', tasks_total: 12, tasks_done: 1, real_man_hours: '10.00', planned_man_hours: '400.00' }, new Date('2026-11-15T22:00:00Z'));
    expect((await projectRow()).status).toBe('aprovado');

    await send('field', 'field.project.started', { ...base, started_at: '2026-11-15T08:00:00Z' });
    expect((await projectRow()).status).toBe('em_execucao');
    await send('field', 'field.project.started', { ...base, started_at: '2026-11-15T08:00:00Z' });

    const work = await prisma.projectFieldWork.findUniqueOrThrow({ where: { projectId: ids.project } });
    expect(work).toMatchObject({ fieldProjectId: '42', fieldProjectCode: 'CSTR-PROJ-0042', sowPlanStatus: 'generated', tasksCount: 12, tasksDone: 3 });
    expect(work.percentComplete?.toFixed(2)).toBe('25.50');
    expect(work.realManHours?.toFixed(2)).toBe('40.50');
    expect(work.progressDate?.toISOString().slice(0, 10)).toBe('2026-11-16');
    expect((await outboxTypes(ids.project)).filter((t) => t === 'project.status_changed')).toHaveLength(2); // proposta→aprovado e aprovado→em_execucao
    const audit = await prisma.auditLog.findFirst({ where: { resourceId: ids.project, action: 'change_project_status' } });
    expect(audit).not.toBeNull();

    await send('field', 'field.project.completed', { ...base, completed_at: '2026-11-30T17:00:00Z' });
    expect((await projectRow()).status).toBe('em_execucao');
    const alerts = await projects.fieldAlerts(ids.responsible);
    expect(alerts).toEqual([expect.objectContaining({ projectId: ids.project, fieldProjectCode: 'CSTR-PROJ-0042', completedAt: '2026-11-30T17:00:00.000Z' })]);

    // Encerrar (manual) tira o aviso.
    await projects.updateStatus(ids.project, { status: 'encerrado' } as any);
    expect(await projects.fieldAlerts(ids.responsible)).toEqual([]);
  });
});
