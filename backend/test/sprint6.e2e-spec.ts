import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const SECRET = process.env.JWT_SECRET!;
const tokenFor = (roles: string[], sub: string) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });

describe('Sprint 6 — devoluções, custódia, etiquetas e documentos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = Date.now().toString(36).toUpperCase();
  const gestor = tokenFor(['gestor'], 'gestor-s6');
  const admin = tokenFor(['admin'], 'admin-s6');
  const rec = tokenFor(['tecnico'], `rec6-${sfx}`);
  const colab = tokenFor(['colaborador'], `emp-${sfx}`); // custodiante comum
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());

  let whCode: string, wh: string, doca: string, shelf: string, un: string;
  const emp = `emp-${sfx}`;

  const mk = async (s: string, extra: Record<string, unknown> = {}) =>
    (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S6-${s}-${sfx}`, shortDescription: `Material ${s}`, category: 'Teste', type: 'FERRAMENTA', returnable: true, stockUomId: un, ...extra }).expect(201)).body.id as string;
  const stockIn = (materialId: string, quantity: number, extra: Record<string, unknown> = {}) =>
    api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ type: 'ENTRADA_RECEBIMENTO', materialId, quantity, toLocationId: shelf, reason: 'Carga de teste', unitCost: 12.5, ...extra }).expect(201);
  const sums = async (materialId: string, condition?: string) => Number((await prisma.stockBalance.aggregate({ where: { materialId, ...(condition && { condition: condition as never }) }, _sum: { quantity: true } }))._sum.quantity ?? 0);
  const reserved = async (materialId: string) => Number((await prisma.stockBalance.aggregate({ where: { materialId }, _sum: { reservedQty: true } }))._sum.reservedQty ?? 0);

  /** Ordem → separação → embalagem → despacho. Devolve ids; `deliver` confirma a entrega com custódia. */
  const flow = async (code: string, quantity: number, serialIds: string[] = []) => {
    const order = (await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S6-${randomUUID()}`, warehouseCode: whCode, projectAxisId: 'prj-s6', items: [{ materialCode: code, quantity }] }).expect(201)).body;
    const rel = (await api().post(`/api/v1/fulfillment-orders/${order.id}/release-picking`).set(A(gestor)).send({}).expect(201)).body;
    const picker = tokenFor(['gestor'], 'picker-s6');
    const t = (a: string, b: Record<string, unknown> = {}) => api().post(`/api/v1/picking-tasks/${rel.id}/${a}`).set(A(picker)).send(b);
    await t('start').expect(200);
    const item = rel.items[0];
    if (serialIds.length) for (const sid of serialIds) await t('scan', { pickingItemId: item.id, locationId: item.locationId, materialId: item.materialId, serialId: sid, quantity: 1 }).expect(200);
    else await t('scan', { pickingItemId: item.id, locationId: item.locationId, materialId: item.materialId, quantity }).expect(200);
    const done = (await t('complete').expect(200)).body;
    if (done.status === 'EM_CONFERENCIA') await api().post(`/api/v1/picking-tasks/${rel.id}/check`).set(A(tokenFor(['gestor'], 'checker-s6'))).send({}).expect(200);
    const pack = (await api().post(`/api/v1/fulfillment-orders/${order.id}/pack`).set(A(gestor)).send({ packages: [{ items: [{ pickingItemId: item.id, quantity }] }] }).expect(201)).body;
    return { order, task: rel, shipment: pack, dispatch: () => api().post(`/api/v1/shipments/${pack.id}/dispatch`).set(A(gestor)).send({ carrier: 'Frota' }),
      deliver: (extra: Record<string, unknown> = {}) => api().post(`/api/v1/shipments/${pack.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'ENTREGUE', receiverName: 'Fulano', receiverAxisId: emp, signatureRef: 'ASS-1', expectedReturnAt: '2030-01-31', ...extra }) };
  };
  const newReturn = (body: Record<string, unknown>, token = rec) => api().post('/api/v1/returns').set(A(token)).send({ type: 'FERRAMENTA', warehouseId: wh, receivingLocationId: doca, ...body });
  const classify = (rid: string, iid: string, body: Record<string, unknown>, token = rec) => api().post(`/api/v1/returns/${rid}/items/${iid}/classify`).set(A(token)).send(body);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    un = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
    whCode = `S6-${sfx}`;
    wh = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: whCode, name: 'Almox Sprint 6', type: 'CENTRAL' }).expect(201)).body.id;
    const loc = async (code: string) => (await api().post(`/api/v1/warehouses/${wh}/locations`).set(A(gestor)).send({ code, level: 'AREA' }).expect(201)).body.id as string;
    doca = await loc('DEV'); shelf = await loc('PRAT');
    await api().put(`/api/v1/rbac/users/rec6-${sfx}/warehouses`).set(A(admin)).send({ warehouseIds: [wh] }).expect(200);
  });
  afterAll(async () => app.close());

  describe('custódia na entrega e devolução', () => {
    it('entrega de ferramenta gera termo de custódia visível ao custodiante; outro colaborador não vê', async () => {
      const m = await mk('TOOL'); await stockIn(m, 3);
      const f = await flow(`S6-TOOL-${sfx}`, 2);
      await f.dispatch().expect(200);
      await f.deliver().expect(200);
      const terms = await prisma.custodyTerm.findMany({ where: { materialId: m } });
      expect(terms).toHaveLength(1);
      expect(terms[0]).toMatchObject({ custodianAxisId: emp, status: 'ATIVO', acceptanceRef: 'ASS-1', projectAxisId: 'prj-s6' });
      expect(Number(terms[0].quantity)).toBe(2);
      expect(terms[0].expectedReturnAt?.toISOString().slice(0, 10)).toBe('2030-01-31');
      const own = await api().get('/api/v1/custody').set(A(colab)).expect(200);
      expect(own.body.items.map((t: { id: string }) => t.id)).toContain(terms[0].id);
      expect(own.body.items[0].code).toMatch(/^CUS-\d{8}$/);
      await api().get('/api/v1/custody').query({ custodianAxisId: 'outro' }).set(A(colab)).expect(403);
      const all = await api().get('/api/v1/custody').query({ custodianAxisId: emp, status: 'ATIVO' }).set(A(gestor)).expect(200);
      expect(all.body.total).toBeGreaterThanOrEqual(1);
      expect(await prisma.integrationMessage.count({ where: { eventType: 'asset.custody.changed', payload: { path: ['custody_term_id'], equals: terms[0].id } } })).toBe(1);
    });

    it('devolução parcial e total baixam a custódia; excesso e item divergente são recusados; inspeção libera ao disponível', async () => {
      const m = await mk('TOOL2'); await stockIn(m, 2);
      const f = await flow(`S6-TOOL2-${sfx}`, 2);
      await f.dispatch().expect(200); await f.deliver().expect(200);
      const term = await prisma.custodyTerm.findFirstOrThrow({ where: { materialId: m } });
      const other = await mk('OTHER');

      await newReturn({ custodyTermId: term.id, items: [{ materialId: m, quantity: 3 }] }).expect(422); // mais que o pendente
      await newReturn({ custodyTermId: term.id, items: [{ materialId: other, quantity: 1 }] }).expect(422); // não é o item do termo
      await newReturn({ items: [{ materialId: m, quantity: 0 }] }).expect(400);
      await newReturn({ items: [{ materialId: m, quantity: 1 }] }, tokenFor(['tecnico'], `nobody-${sfx}`)).expect(403);
      await newReturn({ type: 'XYZ', items: [{ materialId: m, quantity: 1 }] }).expect(400);

      const r1 = (await newReturn({ custodyTermId: term.id, items: [{ materialId: m, quantity: 1 }] }).expect(201)).body;
      expect(r1.code).toMatch(/^DEV-\d{8}$/);
      expect(r1.returnedByAxisId).toBe(emp);
      let t = await prisma.custodyTerm.findUniqueOrThrow({ where: { id: term.id } });
      expect(t.status).toBe('ATIVO'); expect(Number(t.returnedQty)).toBe(1);
      expect(await sums(m, 'QUARENTENA')).toBe(1); // aguardando inspeção
      const cl = await classify(r1.id, r1.items[0].id, { disposition: 'DISPONIVEL', notes: 'Em perfeito estado' }).expect(200);
      expect(cl.body.status).toBe('CLASSIFICADO');
      expect(await sums(m, 'DISPONIVEL')).toBe(1);
      await classify(r1.id, r1.items[0].id, { disposition: 'DISPONIVEL', notes: 'De novo' }).expect(409);
      expect((await prisma.return.findUniqueOrThrow({ where: { id: r1.id } })).status).toBe('ENCERRADA');

      await newReturn({ custodyTermId: term.id, items: [{ materialId: m, quantity: 1 }] }).expect(201);
      t = await prisma.custodyTerm.findUniqueOrThrow({ where: { id: term.id } });
      expect(t.status).toBe('DEVOLVIDO'); expect(t.closedAt).not.toBeNull();
      await newReturn({ custodyTermId: term.id, items: [{ materialId: m, quantity: 1 }] }).expect(409); // termo encerrado
    });

    it('item seriado: devolução recoloca a série; manutenção, reparo e sucata (com aprovação do Axis)', async () => {
      const m = await mk('ASSET', { serialControlled: true, assetTagged: true, type: 'EQUIPAMENTO', exitMethod: 'SERIE_ESPECIFICA' });
      const sns = await Promise.all([1, 2, 3].map(async (i) => (await api().post('/api/v1/serial-numbers').set(A(gestor)).send({ materialId: m, serial: `S6SN${i}-${sfx}`, assetTag: `S6PAT${i}-${sfx}` }).expect(201)).body.id as string));
      for (const sid of sns) await stockIn(m, 1, { serialId: sid });
      const f = await flow(`S6-ASSET-${sfx}`, 3, sns);
      await f.dispatch().expect(200); await f.deliver().expect(200);
      const terms = await prisma.custodyTerm.findMany({ where: { materialId: m } });
      expect(terms).toHaveLength(3);
      expect(terms.every((x) => x.serialId && Number(x.quantity) === 1)).toBe(true);
      const bySerial = (sid: string) => terms.find((x) => x.serialId === sid)!;

      await newReturn({ type: 'ATIVO', items: [{ materialId: m, quantity: 1 }] }).expect(400); // sem série
      const r = (await newReturn({ type: 'ATIVO', custodyTermId: bySerial(sns[0]).id, items: [{ materialId: m, quantity: 1, serialId: sns[0] }] }).expect(201)).body;
      await newReturn({ type: 'ATIVO', items: [{ materialId: m, quantity: 1, serialId: sns[0] }] }).expect(422); // já em estoque: não duplica
      expect((await prisma.serialNumber.findUniqueOrThrow({ where: { id: sns[0] } })).currentLocationId).toBe(doca);

      await classify(r.id, r.items[0].id, { disposition: 'SUCATA', notes: 'Irrecuperável' }).expect(422);
      const man = await classify(r.id, r.items[0].id, { disposition: 'MANUTENCAO', notes: 'Calibrar antes de reusar' }).expect(200);
      expect(man.body.disposition).toBe('MANUTENCAO');
      expect((await prisma.serialNumber.findUniqueOrThrow({ where: { id: sns[0] } })).condition).toBe('EM_MANUTENCAO');
      expect(await sums(m, 'BLOQUEADO')).toBe(1);
      expect(await sums(m, 'DISPONIVEL')).toBe(0); // fora do disponível

      const r2 = (await newReturn({ type: 'AVARIA', items: [{ materialId: m, quantity: 1, serialId: sns[1] }] }).expect(201)).body;
      await classify(r2.id, r2.items[0].id, { disposition: 'AVARIADO_REPARO', notes: 'Carcaça quebrada' }).expect(200);
      expect((await prisma.serialNumber.findUniqueOrThrow({ where: { id: sns[1] } })).condition).toBe('AVARIADO');
      expect(await sums(m, 'AVARIADO')).toBe(1);

      const r3 = (await newReturn({ type: 'DEFEITUOSO', items: [{ materialId: m, quantity: 1, serialId: sns[2] }] }).expect(201)).body;
      await classify(r3.id, r3.items[0].id, { disposition: 'SUCATA', notes: 'Sem conserto', approvalRef: 'DSP-77' }).expect(200);
      const sn3 = await prisma.serialNumber.findUniqueOrThrow({ where: { id: sns[2] } });
      expect(sn3.condition).toBe('BAIXADO'); expect(sn3.currentLocationId).toBeNull();
      const mv = await prisma.stockMovement.findFirstOrThrow({ where: { materialId: m, type: 'DESCARTE' } });
      expect(mv.axisApprovalRef).toBe('DSP-77');
      await classify(r3.id, r3.items[0].id, { disposition: 'QUARENTENA', notes: 'x' }).expect(400);
    });

    it('colaborador desligado lista pendências de devolução; extravio exige aprovação e baixa a série', async () => {
      const m = await mk('LOST', { serialControlled: true, assetTagged: true, type: 'EQUIPAMENTO', exitMethod: 'SERIE_ESPECIFICA' });
      const sid = (await api().post('/api/v1/serial-numbers').set(A(gestor)).send({ materialId: m, serial: `LOST-${sfx}` }).expect(201)).body.id as string;
      await stockIn(m, 1, { serialId: sid });
      const f = await flow(`S6-LOST-${sfx}`, 1, [sid]);
      await f.dispatch().expect(200); await f.deliver({ receiverAxisId: `gone-${sfx}` }).expect(200);
      const term = await prisma.custodyTerm.findFirstOrThrow({ where: { materialId: m } });
      const before = await api().get('/api/v1/custody/offboarded-pending').set(A(gestor)).expect(200);
      expect(before.body.map((t: { id: string }) => t.id)).not.toContain(term.id);
      await prisma.axisMasterCache.create({ data: { kind: 'COLLABORATOR', axisId: `gone-${sfx}`, name: 'Ex-colaborador', active: false, sourceOccurredAt: new Date() } });
      const pend = await api().get('/api/v1/custody/offboarded-pending').set(A(gestor)).expect(200);
      expect(pend.body.map((t: { id: string }) => t.id)).toContain(term.id);
      await api().get('/api/v1/custody/offboarded-pending').set(A(rec)).expect(403);

      await api().post(`/api/v1/custody/${term.id}/mark-lost`).set(A(gestor)).send({ notes: 'Extraviado em campo' }).expect(400); // sem aprovação
      const lost = await api().post(`/api/v1/custody/${term.id}/mark-lost`).set(A(gestor)).send({ notes: 'Extraviado em campo', approvalRef: 'EXT-9' }).expect(200);
      expect(lost.body.status).toBe('PERDIDO');
      expect((await prisma.serialNumber.findUniqueOrThrow({ where: { id: sid } })).condition).toBe('BAIXADO');
      await api().post(`/api/v1/custody/${term.id}/mark-lost`).set(A(gestor)).send({ notes: 'De novo', approvalRef: 'EXT-9' }).expect(409);
    });
  });

  describe('cancelamento e recusa após a separação', () => {
    it('resolve-cancellation libera reservas, cancela tarefa e volume pronto; não resolve em trânsito nem após entrega', async () => {
      const m = await mk('CXL', { returnable: false, type: 'CONSUMO' }); await stockIn(m, 6);
      const f = await flow(`S6-CXL-${sfx}`, 2);
      expect(await reserved(m)).toBe(2);
      await api().post(`/api/v1/fulfillment-orders/${f.order.id}/resolve-cancellation`).set(A(gestor)).send({ reason: 'Ainda ativa' }).expect(409); // não solicitado
      const c = await api().post(`/api/v1/fulfillment-orders/${f.order.id}/cancel-request`).set(A(gestor)).send({ reason: 'Projeto parado' }).expect(200);
      expect(c.body.status).toBe('CANCELAMENTO_SOLICITADO');
      const res = await api().post(`/api/v1/fulfillment-orders/${f.order.id}/resolve-cancellation`).set(A(gestor)).send({ reason: 'Volumes devolvidos à prateleira' }).expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELADA', releasedReservations: 1 });
      expect(await reserved(m)).toBe(0);
      expect(await sums(m)).toBe(6);
      expect((await prisma.pickingTask.findUniqueOrThrow({ where: { id: f.task.id } })).status).toBe('CANCELADA');
      expect((await prisma.shipment.findUniqueOrThrow({ where: { id: f.shipment.id } })).status).toBe('RECUSADA');

      const g = await flow(`S6-CXL-${sfx}`, 1);
      await g.dispatch().expect(200);
      await api().post(`/api/v1/fulfillment-orders/${g.order.id}/cancel-request`).set(A(gestor)).send({ reason: 'Cliente desistiu' }).expect(200);
      await api().post(`/api/v1/fulfillment-orders/${g.order.id}/resolve-cancellation`).set(A(gestor)).send({ reason: 'x y z' }).expect(409); // em trânsito
      await api().post(`/api/v1/fulfillment-orders/${g.order.id}/resolve-cancellation`).set(A(colab)).send({ reason: 'sem permissão' }).expect(403);
    });

    it('entrega recusada (DIVERGENCIA) pode ser resolvida: estoque nunca saiu e a reserva é liberada', async () => {
      const m = await mk('REF', { returnable: false, type: 'CONSUMO' }); await stockIn(m, 3);
      const f = await flow(`S6-REF-${sfx}`, 3);
      await f.dispatch().expect(200);
      await f.deliver({ outcome: 'RECUSADA', notes: 'Cliente recusou' }).expect(200);
      expect((await prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe('DIVERGENCIA');
      await api().post(`/api/v1/fulfillment-orders/${f.order.id}/resolve-cancellation`).set(A(gestor)).send({ reason: 'Devolvido ao estoque' }).expect(200);
      expect(await reserved(m)).toBe(0);
      expect(await sums(m)).toBe(3);
    });
  });

  describe('etiquetas', () => {
    it('etiqueta de endereço, material com lote, série e volume; ZPL; formatos e limites', async () => {
      const loc = (await api().post('/api/v1/labels/print').set(A(rec)).send({ kind: 'LOCATION', refId: shelf }).expect(201)).body;
      expect(loc.code).toBe(`LGC:LOC:${whCode}:PRAT`);
      expect(loc.isReprint).toBe(false);
      const zpl = (await api().post('/api/v1/labels/print').set(A(rec)).send({ kind: 'LOCATION', refId: doca, format: 'zpl', copies: 3 }).expect(201)).body;
      expect(zpl.zpl).toMatch(/^\^XA.*\^BQN.*\^XZ$/);
      expect(zpl.copies).toBe(3);

      const lm = await mk('LBL', { returnable: false, type: 'CONSUMO', lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      const lot = (await api().post('/api/v1/lots').set(A(gestor)).send({ materialId: lm, lotNumber: `L-${sfx}`, expiresAt: '2031-05-20' }).expect(201)).body;
      const mat = (await api().post('/api/v1/labels/print').set(A(rec)).send({ kind: 'MATERIAL', refId: lm, lotId: lot.id }).expect(201)).body;
      expect(mat.code).toBe(`LGC:MAT:S6-LBL-${sfx}:LOT:L-${sfx}`);
      expect(mat.lines).toContain('Validade: 20/05/2031');
      await api().post('/api/v1/labels/print').set(A(rec)).send({ kind: 'MATERIAL', refId: lm, lotId: randomUUID() }).expect(400);

      const sm = await mk('LBLS', { serialControlled: true, assetTagged: true, type: 'EQUIPAMENTO', exitMethod: 'SERIE_ESPECIFICA' });
      const sn = (await api().post('/api/v1/serial-numbers').set(A(gestor)).send({ materialId: sm, serial: `SN-${sfx}`, assetTag: `PAT-${sfx}` }).expect(201)).body.id;
      const ser = (await api().post('/api/v1/labels/print').set(A(rec)).send({ kind: 'SERIAL', refId: sn }).expect(201)).body;
      expect(ser.lines).toEqual(expect.arrayContaining([`Série: SN-${sfx}`, `Patrimônio: PAT-${sfx}`]));

      const pm = await mk('LBLP', { returnable: false, type: 'CONSUMO' }); await stockIn(pm, 2);
      const f = await flow(`S6-LBLP-${sfx}`, 2);
      const pkg = (await api().post('/api/v1/labels/print').set(A(gestor)).send({ kind: 'PACKAGE', refId: f.shipment.packages[0].id }).expect(201)).body;
      expect(pkg.title).toMatch(/^VOL-\d{8}$/);
      expect(pkg.lines).toEqual(expect.arrayContaining(['Volume 1/1', 'Projeto: prj-s6']));

      await api().post('/api/v1/labels/print').set(A(rec)).send({ kind: 'LOCATION', refId: shelf, copies: 101 }).expect(400);
      await api().post('/api/v1/labels/print').set(A(rec)).send({ kind: 'BOX', refId: shelf }).expect(400);
      await api().post('/api/v1/labels/print').set(A(rec)).send({ kind: 'LOCATION', refId: randomUUID() }).expect(404);
      await api().post('/api/v1/labels/print').set(A(colab)).send({ kind: 'LOCATION', refId: shelf }).expect(403);
      await api().post('/api/v1/labels/print').set(A(tokenFor(['tecnico'], `nobody-${sfx}`))).send({ kind: 'LOCATION', refId: shelf }).expect(403); // fora do escopo do almoxarifado
    });

    it('reimpressão exige motivo e fica auditada', async () => {
      const body = { kind: 'LOCATION', refId: doca };
      await api().post('/api/v1/labels/print').set(A(rec)).send(body).expect(400); // doca já foi impressa no teste anterior
      const re = await api().post('/api/v1/labels/print').set(A(rec)).send({ ...body, reason: 'Etiqueta danificada' }).expect(201);
      expect(re.body.isReprint).toBe(true);
      const prints = await prisma.labelPrint.findMany({ where: { kind: 'LOCATION', refId: doca }, orderBy: { createdAt: 'asc' } });
      expect(prints.map((p) => p.isReprint)).toEqual([false, true]);
      expect(prints[1]).toMatchObject({ reason: 'Etiqueta danificada', printedBy: `rec6-${sfx}` });
    });
  });

  describe('documentos', () => {
    it('comprovante de recebimento (custo só com permissão), divergência e formatos pt-BR', async () => {
      const m = await mk('DOC', { returnable: false, type: 'CONSUMO' });
      const r = (await api().post('/api/v1/receipts').set(A(rec)).send({ warehouseId: wh, receivingLocationId: doca, axisPurchaseOrderId: 'PO-S6', invoiceNumber: 'NF-9', expectedItems: [{ materialId: m, quantity: 5 }] }).expect(201)).body;
      await api().post(`/api/v1/receipts/${r.id}/items:scan`).set(A(rec)).send({ materialId: m, quantity: 4, unitCost: 1234.5 }).expect(201);
      await api().post(`/api/v1/receipts/${r.id}/complete`).set(A(rec)).expect(200);
      const full = (await api().get(`/api/v1/documents/receipts/${r.id}`).set(A(gestor)).expect(200)).body;
      expect(full.title).toBe('Comprovante de recebimento');
      expect(full.number).toMatch(/^REC-\d{8}$/);
      expect(full.generatedAt).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
      expect(full.table.columns).toContain('Custo unit.');
      expect(full.table.rows[0].at(-1)).toMatch(/R\$\s1\.234,50/);
      expect(full.notes[0]).toMatch(/previsto 5, recebido 4/);
      const noCost = (await api().get(`/api/v1/documents/receipts/${r.id}`).set(A(rec)).expect(200)).body;
      expect(noCost.table.columns).not.toContain('Custo unit.');
      const div = (await api().get(`/api/v1/documents/receipts/${r.id}/divergence`).set(A(gestor)).expect(200)).body;
      expect(div.title).toBe('Relatório de divergência de recebimento');
      const ok = (await api().post('/api/v1/receipts').set(A(rec)).send({ warehouseId: wh, receivingLocationId: doca, axisPurchaseOrderId: 'PO-S6B' }).expect(201)).body;
      await api().get(`/api/v1/documents/receipts/${ok.id}/divergence`).set(A(gestor)).expect(422);
      await api().get(`/api/v1/documents/receipts/${randomUUID()}`).set(A(gestor)).expect(404);
      await api().get('/api/v1/documents/receipts/nao-uuid').set(A(gestor)).expect(400);
      await api().get(`/api/v1/documents/receipts/${r.id}`).set(A(colab)).expect(403);
      await api().get(`/api/v1/documents/receipts/${r.id}`).set(A(tokenFor(['tecnico'], `nobody-${sfx}`))).expect(403);
    });

    it('lista de separação, romaneio, comprovante de entrega, termo de custódia e certificado de descarte', async () => {
      const m = await mk('DOC2'); await stockIn(m, 2);
      const f = await flow(`S6-DOC2-${sfx}`, 2);
      const pick = (await api().get(`/api/v1/documents/picking-tasks/${f.task.id}`).set(A(gestor)).expect(200)).body;
      expect(pick.title).toBe('Lista de separação');
      expect(pick.header['Necessário até']).toBe('—');
      expect(pick.table.rows[0][0]).toBe('PRAT');
      await api().get(`/api/v1/documents/deliveries/${f.shipment.id}`).set(A(gestor)).expect(422); // sem comprovante ainda
      await f.dispatch().expect(200);
      const rom = (await api().get(`/api/v1/documents/shipments/${f.shipment.id}`).set(A(gestor)).expect(200)).body;
      expect(rom.title).toBe('Romaneio de expedição');
      expect(rom.number).toMatch(/^ROM-\d{8}$/);
      expect(rom.header['Expedido em']).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
      await f.deliver({ receiverName: 'Beltrano da Silva' }).expect(200);
      const del = (await api().get(`/api/v1/documents/deliveries/${f.shipment.id}`).set(A(gestor)).expect(200)).body;
      expect(del.table.rows[0].slice(0, 2)).toEqual(['ENTREGUE', 'Beltrano da Silva']);

      const term = await prisma.custodyTerm.findFirstOrThrow({ where: { materialId: m } });
      const mine = (await api().get(`/api/v1/documents/custody/${term.id}`).set(A(colab)).expect(200)).body;
      expect(mine.title).toBe('Termo de entrega e custódia');
      expect(mine.header['Devolução prevista']).toBe('31/01/2030');
      await api().get(`/api/v1/documents/custody/${term.id}`).set(A(tokenFor(['colaborador'], 'outro-colab'))).expect(422);
      await api().get(`/api/v1/documents/custody/${term.id}`).set(A(gestor)).expect(200);

      const r = (await newReturn({ type: 'DEFEITUOSO', custodyTermId: term.id, items: [{ materialId: m, quantity: 1 }] }).expect(201)).body;
      expect((await api().get(`/api/v1/documents/returns/${r.id}`).set(A(rec)).expect(200)).body.title).toBe('Comprovante de devolução');
      await classify(r.id, r.items[0].id, { disposition: 'SUCATA', notes: 'Sem conserto', approvalRef: 'DSP-1' }).expect(200);
      const cert = (await api().get(`/api/v1/documents/returns/${r.id}`).set(A(rec)).expect(200)).body;
      expect(cert.title).toBe('Certificado de devolução/descarte');
      expect(cert.table.rows[0]).toEqual(expect.arrayContaining(['SUCATA', 'DSP-1']));
    });

    it('romaneio de transferência e extrato de movimentações', async () => {
      const w2 = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: `S6B-${sfx}`, name: 'Almox destino', type: 'CENTRAL' }).expect(201)).body.id as string;
      const l2 = (await api().post(`/api/v1/warehouses/${w2}/locations`).set(A(gestor)).send({ code: 'D1', level: 'AREA' }).expect(201)).body.id as string;
      const m = await mk('EXT', { returnable: false, type: 'CONSUMO' }); await stockIn(m, 4);
      const t = (await api().post('/api/v1/transfers').set(A(gestor)).send({ toWarehouseId: w2, reason: 'Reposição', urgent: true, items: [{ materialId: m, fromLocationId: shelf, quantity: 2 }] }).expect(201)).body;
      await api().post(`/api/v1/transfers/${t.id}/approve`).set(A(admin)).expect(403); // admin técnico não aprova operações
      const doc = (await api().get(`/api/v1/documents/transfers/${t.id}`).set(A(gestor)).expect(200)).body;
      expect(doc.title).toBe('Romaneio de transferência');
      expect(doc.header.Urgente).toBe('Sim');

      const ext = (await api().get('/api/v1/documents/movements').query({ materialId: m }).set(A(gestor)).expect(200)).body;
      expect(ext.title).toBe('Extrato de movimentações');
      expect(ext.table.rows).toHaveLength(1);
      expect(ext.table.rows[0][0]).toMatch(/^MOV-\d{8}$/);
      expect(ext.table.rows[0][1]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
      expect(ext.table.rows[0].at(-1)).toMatch(/R\$\s12,50/);
      const noCost = (await api().get('/api/v1/documents/movements').query({ materialId: m }).set(A(rec)).expect(200)).body;
      expect(noCost.table.columns).not.toContain('Custo unit.');
      await api().get('/api/v1/documents/movements').query({ from: '31/12/2026' }).set(A(gestor)).expect(400);
      await api().get('/api/v1/documents/movements').query({ materialId: m }).set(A(colab)).expect(403);
      void l2;
    });
  });
});
