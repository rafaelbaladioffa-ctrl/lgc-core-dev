import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const SECRET = process.env.JWT_SECRET!;
const tokenFor = (roles: string[], sub: string) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });

describe('Sprint 7 — inventário: contagem cega, recontagem e ajuste com aprovação', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const gestor = tokenFor(['gestor'], 'gestor-s7');
  const admin = tokenFor(['admin'], 'admin-s7');
  const c1 = tokenFor(['tecnico'], `cnt1-${sfx}`);
  const c2 = tokenFor(['tecnico'], `cnt2-${sfx}`);
  const outsider = tokenFor(['tecnico'], `out7-${sfx}`);
  const colab = tokenFor(['colaborador'], 'colab-s7');
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());

  let wh: string, un: string;
  const locs: string[] = [];

  const newLoc = async () => { const code = `L${locs.length}-${sfx}`; const id = (await api().post(`/api/v1/warehouses/${wh}/locations`).set(A(gestor)).send({ code, level: 'AREA' }).expect(201)).body.id as string; locs.push(id); return id; };
  const mk = async (s: string, extra: Record<string, unknown> = {}) =>
    (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S7-${s}-${sfx}`, shortDescription: `Material ${s}`, category: 'Teste', type: 'CONSUMO', stockUomId: un, ...extra }).expect(201)).body.id as string;
  const stockIn = (materialId: string, quantity: number, to: string, extra: Record<string, unknown> = {}) =>
    api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ type: 'ENTRADA_RECEBIMENTO', materialId, quantity, toLocationId: to, reason: 'Carga de teste', ...extra });
  const qty = async (materialId: string, locationId: string) => Number((await prisma.stockBalance.aggregate({ where: { materialId, locationId }, _sum: { quantity: true } }))._sum.quantity ?? 0);
  const create = (body: Record<string, unknown>, token = gestor) => api().post('/api/v1/stock-counts').set(A(token)).send({ type: 'ENDERECO', warehouseId: wh, ...body });
  const act = (id: string, action: string, body: Record<string, unknown> = {}, token = gestor) => api().post(`/api/v1/stock-counts/${id}/${action}`).set(A(token)).send(body);
  const submit = (id: string, lineId: string, quantity: number, token = c1) => act(id, 'counts', { lineId, quantity }, token);
  const lines = async (id: string) => (await api().get(`/api/v1/stock-counts/${id}`).set(A(gestor)).expect(200)).body.lines as Array<{ id: string; materialId: string; locationId: string; serialId: string | null; status: string; systemQty: string; varianceQty: string | null }>;
  const lineOf = (ls: Awaited<ReturnType<typeof lines>>, materialId: string, serialId?: string) => ls.find((l) => l.materialId === materialId && (serialId ? l.serialId === serialId : true))!;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    un = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
    wh = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: `S7-${sfx}`, name: 'Almox Sprint 7', type: 'CENTRAL' }).expect(201)).body.id;
    for (const u of [`cnt1-${sfx}`, `cnt2-${sfx}`]) await api().put(`/api/v1/rbac/users/${u}/warehouses`).set(A(admin)).send({ warehouseIds: [wh] }).expect(200);
  });
  afterAll(async () => app.close());

  it('abertura: validações de escopo, permissões e um inventário ativo por endereço (com congelamento)', async () => {
    const l1 = await newLoc(); const l2 = await newLoc();
    const m = await mk('FRZ'); await stockIn(m, 10, l1).expect(201);
    await create({ type: 'ENDERECO' }).expect(400); // sem locationIds
    await create({ type: 'ITEM', scope: { materialIds: [randomUUID()] } }).expect(422); // nada a inventariar
    await create({ type: 'PROJETO' }).expect(422); // almoxarifado sem projeto
    await create({ type: 'ROTATIVO_ABC', scope: { criticality: 'Z' } }).expect(400);
    await create({ type: 'ENDERECO', scope: { locationIds: [l1] }, tolerancePct: 101 }).expect(400);
    await create({ type: 'ENDERECO', scope: { locationIds: [l1] } }, c1).expect(403); // contador não abre
    await create({ type: 'ENDERECO', scope: { locationIds: [l1] } }, outsider).expect(403);
    await create({ type: 'ENDERECO', scope: { locationIds: [l1] } }, colab).expect(403);

    const c = (await create({ type: 'ENDERECO', scope: { locationIds: [l1] } }).expect(201)).body;
    expect(c.code).toMatch(/^INV-\d{8}$/);
    expect(c.lines).toBe(1);
    await create({ type: 'ENDERECO', scope: { locationIds: [l1] } }).expect(409); // endereço já em inventário
    const blocked = await stockIn(m, 1, l1).expect(422);
    expect(blocked.body.message).toMatch(/congelado/);
    await stockIn(m, 1, l2).expect(201); // outros endereços seguem livres
    await act(c.id, 'cancel', { reason: 'x' }).expect(400);
    await act(c.id, 'cancel', { reason: 'Teste concluído' }).expect(200);
    await stockIn(m, 1, l1).expect(201); // cancelado descongela
    await act(c.id, 'cancel', { reason: 'De novo' }).expect(409);
  });

  it('fluxo completo: contagem cega → recontagem por outro operador → apuração → ajuste só com aprovação do Axis', async () => {
    const loc = await newLoc();
    const a = await mk('A'); await prisma.material.update({ where: { id: a }, data: { averageCost: 10 } }); // custo vem do Axis
    const s = await mk('SER', { serialControlled: true, assetTagged: true, type: 'EQUIPAMENTO', exitMethod: 'SERIE_ESPECIFICA' });
    const sns = await Promise.all([1, 2, 3].map(async (i) => (await api().post('/api/v1/serial-numbers').set(A(gestor)).send({ materialId: s, serial: `S7SN${i}-${sfx}` }).expect(201)).body.id as string));
    await stockIn(a, 10, loc).expect(201);
    for (const sid of sns) await stockIn(s, 1, loc, { serialId: sid }).expect(201);

    const cnt = (await create({ type: 'ENDERECO', scope: { locationIds: [loc] } }).expect(201)).body;
    expect(cnt.lines).toBe(4);
    await api().get(`/api/v1/stock-counts/${cnt.id}/sheet`).set(A(c1)).expect(409); // ainda não iniciada
    await act(cnt.id, 'start', {}, c1).expect(403);
    await act(cnt.id, 'start').expect(200);
    await act(cnt.id, 'start').expect(409);

    // contagem cega: a folha não traz saldo do sistema
    const sheet = (await api().get(`/api/v1/stock-counts/${cnt.id}/sheet`).set(A(c1)).expect(200)).body;
    expect(sheet.round).toBe(1);
    expect(sheet.lines).toHaveLength(4);
    expect(JSON.stringify(sheet)).not.toMatch(/systemQty|system_qty/);
    await api().get(`/api/v1/stock-counts/${cnt.id}`).set(A(c1)).expect(403); // detalhe com saldo é só da gestão

    const all = await lines(cnt.id);
    const la = lineOf(all, a), l1 = lineOf(all, s, sns[0]), l2 = lineOf(all, s, sns[1]), l3 = lineOf(all, s, sns[2]);
    const r = await submit(cnt.id, la.id, 8);
    expect(r.body).toEqual({ lineId: la.id, recorded: true });
    await submit(cnt.id, la.id, 8).expect(409); // já contada
    await submit(cnt.id, l1.id, 1); await submit(cnt.id, l2.id, 0);
    await act(cnt.id, 'close-round').expect(422); // falta a linha 3
    await submit(cnt.id, l3.id, 1);
    await submit(cnt.id, randomUUID(), 1).expect(404); // linha de outro inventário
    await submit(cnt.id, la.id, -1).expect(400);
    await act(cnt.id, 'counts', { lineId: la.id, quantity: 1.5 }, c1).expect(400);

    const round1 = (await act(cnt.id, 'close-round').expect(200)).body;
    expect(round1).toMatchObject({ status: 'EM_RECONTAGEM', recount: 2 }); // A (−2) e série 2 (ausente); séries 1 e 3 conferem
    expect((await lines(cnt.id)).filter((l) => l.status === 'CONFERIDO')).toHaveLength(2);

    // recontagem: outro operador; quem contou primeiro não recebe a linha nem consegue contar
    const mine = (await api().get(`/api/v1/stock-counts/${cnt.id}/sheet`).set(A(c1)).expect(200)).body;
    expect(mine.round).toBe(2);
    expect(mine.lines).toHaveLength(0);
    await act(cnt.id, 'counts', { lineId: la.id, quantity: 8 }, c1).expect(403);
    const theirs = (await api().get(`/api/v1/stock-counts/${cnt.id}/sheet`).set(A(c2)).expect(200)).body;
    expect(theirs.lines.map((l: { id: string }) => l.id).sort()).toEqual([la.id, l2.id].sort());
    await act(cnt.id, 'counts', { lineId: l1.id, quantity: 1 }, c2).expect(409); // linha conferida não recontamos
    await act(cnt.id, 'close-round').expect(422); // faltam recontagens
    await act(cnt.id, 'counts', { lineId: la.id, quantity: 8 }, c2).expect(200);
    await act(cnt.id, 'counts', { lineId: l2.id, quantity: 0 }, c2).expect(200);
    const closed = (await act(cnt.id, 'close-round').expect(200)).body;
    expect(closed).toEqual({ status: 'APURADA', variances: 2 });
    expect(await prisma.integrationMessage.count({ where: { eventType: 'inventory.variance_detected', payload: { path: ['count_id'], equals: cnt.id } } })).toBe(1);

    // relatório antes/depois (com valor em R$ para quem vê custo) e plano de ação
    const rep = (await api().get(`/api/v1/stock-counts/${cnt.id}/report`).set(A(gestor)).expect(200)).body;
    expect(rep.items).toHaveLength(2);
    const ra = rep.items.find((i: { lineId: string }) => i.lineId === la.id);
    expect(ra).toMatchObject({ before: '10', after: '8', variance: '-2', variance_value: '-20', recurrent: false });
    expect(rep.summary).toMatchObject({ CONFERIDO: 2, DIVERGENTE: 2 });
    await api().put(`/api/v1/stock-counts/${cnt.id}/action-plan`).set(A(gestor)).send({ text: 'x' }).expect(400);
    await api().put(`/api/v1/stock-counts/${cnt.id}/action-plan`).set(A(gestor)).send({ text: 'Revisar baixa manual de consumo no endereço' }).expect(200);

    // ajuste: exige aprovação + motivo padronizado para cada divergência + permissão específica
    const adj = (body: Record<string, unknown>, token = gestor) => act(cnt.id, 'adjustments', body, token);
    await adj({ approvalRef: 'APR-1', lines: [] }, gestor).expect(400);
    await adj({ lines: [{ lineId: la.id, reason: 'PERDA' }] }).expect(400); // sem aprovação do Axis
    await adj({ approvalRef: 'APR-S7', lines: [{ lineId: la.id, reason: 'PERDA' }] }).expect(422); // falta a série
    await adj({ approvalRef: 'APR-S7', lines: [{ lineId: la.id, reason: 'INVENTADO' }, { lineId: l2.id, reason: 'PERDA' }] }).expect(400);
    await adj({ approvalRef: 'APR-S7', lines: [{ lineId: la.id, reason: 'PERDA' }, { lineId: l1.id, reason: 'PERDA' }] }).expect(422); // l1 não diverge... e falta l2
    await adj({ approvalRef: 'APR-S7', lines: [{ lineId: la.id, reason: 'PERDA' }, { lineId: l2.id, reason: 'ROUBO_EXTRAVIO' }] }, c1).expect(403);
    expect(await qty(a, loc)).toBe(10); // nada mudou até aqui
    await stockIn(a, 1, loc).expect(422); // continua congelado

    const done = await adj({ approvalRef: 'APR-S7', lines: [{ lineId: la.id, reason: 'PERDA', notes: 'Quebra no manuseio' }, { lineId: l2.id, reason: 'ROUBO_EXTRAVIO' }] }).expect(200);
    expect(done.body).toEqual({ status: 'CONCLUIDA', adjusted: 2 });
    expect(await qty(a, loc)).toBe(8);
    expect((await prisma.serialNumber.findUniqueOrThrow({ where: { id: sns[1] } })).currentLocationId).toBeNull();
    expect((await prisma.serialNumber.findUniqueOrThrow({ where: { id: sns[0] } })).currentLocationId).toBe(loc);
    const mv = await prisma.stockMovement.findMany({ where: { correlationId: cnt.id }, orderBy: { seq: 'asc' } });
    expect(mv.map((x) => x.type)).toEqual(['AJUSTE_NEGATIVO', 'AJUSTE_NEGATIVO']);
    expect(mv.every((x) => x.axisApprovalRef === 'APR-S7' && x.logisticsDocumentRef === cnt.code)).toBe(true);
    expect(mv.map((x) => x.reason).join('|')).toMatch(/PERDA — Quebra no manuseio/); // a ordem de aplicação entre linhas não é contrato
    await adj({ approvalRef: 'APR-S7', lines: [{ lineId: la.id, reason: 'PERDA' }, { lineId: l2.id, reason: 'PERDA' }] }).expect(409);
    await stockIn(a, 1, loc).expect(201); // descongelado
  });

  it('tolerância aceita diferença pequena sem recontagem; sobra vira ajuste positivo; recorrência é sinalizada', async () => {
    const loc = await newLoc();
    const m = await mk('TOL'); await prisma.material.update({ where: { id: m }, data: { averageCost: 4 } }); await stockIn(m, 20, loc).expect(201);
    const c = (await create({ type: 'ITEM', scope: { materialIds: [m] }, tolerancePct: 10 }).expect(201)).body;
    await act(c.id, 'start').expect(200);
    const [line] = await lines(c.id);
    await submit(c.id, line.id, 21); // +5% ≤ 10%
    const res = (await act(c.id, 'close-round').expect(200)).body;
    expect(res).toEqual({ status: 'APURADA', variances: 1 }); // sem recontagem
    const adj = (await act(c.id, 'adjustments', { approvalRef: 'APR-TOL', lines: [{ lineId: line.id, reason: 'ERRO_LANCAMENTO' }] }).expect(200)).body;
    expect(adj.adjusted).toBe(1);
    expect(await qty(m, loc)).toBe(21);
    expect((await prisma.stockMovement.findFirstOrThrow({ where: { correlationId: c.id } })).type).toBe('AJUSTE_POSITIVO');

    // novo inventário no mesmo item/endereço com divergência de novo → recorrente
    const c2x = (await create({ type: 'ITEM', scope: { materialIds: [m] }, tolerancePct: 10 }).expect(201)).body;
    await act(c2x.id, 'start').expect(200);
    const [l2x] = await lines(c2x.id);
    await submit(c2x.id, l2x.id, 20);
    await act(c2x.id, 'close-round').expect(200);
    const rep = (await api().get(`/api/v1/stock-counts/${c2x.id}/report`).set(A(gestor)).expect(200)).body;
    expect(rep.items[0].recurrent).toBe(true);
    expect(rep.recurrentCount).toBe(1);
    await act(c2x.id, 'cancel', { reason: 'Fim do teste' }).expect(200);
  });

  it('sem divergência o inventário conclui sozinho; recontagem que confere vira CONFERIDO', async () => {
    const loc = await newLoc();
    const m = await mk('OK'); await stockIn(m, 5, loc).expect(201);
    const c = (await create({ type: 'ENDERECO', scope: { locationIds: [loc] } }).expect(201)).body;
    await act(c.id, 'start').expect(200);
    const [l] = await lines(c.id);
    await submit(c.id, l.id, 5);
    expect((await act(c.id, 'close-round').expect(200)).body).toEqual({ status: 'CONCLUIDA', variances: 0 });
    await stockIn(m, 1, loc).expect(201); // descongelou

    const c2x = (await create({ type: 'ENDERECO', scope: { locationIds: [loc] } }).expect(201)).body;
    await act(c2x.id, 'start').expect(200);
    const [l2x] = await lines(c2x.id);
    await submit(c2x.id, l2x.id, 4); // errou na primeira
    expect((await act(c2x.id, 'close-round').expect(200)).body.status).toBe('EM_RECONTAGEM');
    await act(c2x.id, 'counts', { lineId: l2x.id, quantity: 6 }, c2).expect(200); // saldo real: 6
    expect((await act(c2x.id, 'close-round').expect(200)).body).toEqual({ status: 'CONCLUIDA', variances: 0 });
    expect((await lines(c2x.id))[0].status).toBe('CONFERIDO');
    expect(await qty(m, loc)).toBe(6);
  });

  it('tipos de inventário: item, lote, rotativo ABC, amostragem e geral; e relatório em documento', async () => {
    const loc = await newLoc();
    const x = await mk('TX', { criticality: 'A' }); const y = await mk('TY'); const z = await mk('TZ');
    const lm = await mk('TLOT', { lotControlled: true });
    const lot = (await api().post('/api/v1/lots').set(A(gestor)).send({ materialId: lm, lotNumber: `LT-${sfx}` }).expect(201)).body.id as string;
    await stockIn(x, 3, loc).expect(201); await stockIn(y, 3, loc).expect(201); await stockIn(z, 3, loc).expect(201); await stockIn(lm, 3, loc, { lotId: lot }).expect(201);

    const abc = (await create({ type: 'ROTATIVO_ABC', scope: { criticality: 'A' } }).expect(201)).body;
    expect(abc.lines).toBe(1); // só o item A do endereço (os demais A de outros testes já estão em inventário? não: sem saldo no almoxarifado inteiro)
    await act(abc.id, 'cancel', { reason: 'Só validando o escopo' }).expect(200);
    const item = (await create({ type: 'ITEM', scope: { materialIds: [y, z] } }).expect(201)).body;
    expect(item.lines).toBe(2);
    await act(item.id, 'cancel', { reason: 'Só validando o escopo' }).expect(200);
    const lt = (await create({ type: 'LOTE', scope: { lotIds: [lot] } }).expect(201)).body;
    expect(lt.lines).toBe(1);
    await act(lt.id, 'cancel', { reason: 'Só validando o escopo' }).expect(200);
    const sample = (await create({ type: 'AMOSTRAGEM', scope: { sampleSize: 2 } }).expect(201)).body;
    expect(sample.lines).toBe(2);
    await act(sample.id, 'cancel', { reason: 'Só validando o escopo' }).expect(200);
    await create({ type: 'AMOSTRAGEM', scope: { sampleSize: 0 } }).expect(400);

    // documento: relatório de inventário (antes/depois, R$)
    const c = (await create({ type: 'ENDERECO', scope: { locationIds: [loc] } }).expect(201)).body;
    await act(c.id, 'start').expect(200);
    for (const l of await lines(c.id)) await submit(c.id, l.id, Number(l.systemQty));
    expect((await act(c.id, 'close-round').expect(200)).body.status).toBe('CONCLUIDA');
    const doc = (await api().get(`/api/v1/documents/stock-counts/${c.id}`).set(A(gestor)).expect(200)).body;
    expect(doc.title).toBe('Relatório de inventário');
    expect(doc.number).toBe(c.code);
    expect(doc.table.columns).toEqual(expect.arrayContaining(['Antes (sistema)', 'Depois (apurado)', 'Valor divergência']));
    expect(doc.table.rows).toHaveLength(4);
    expect(doc.header['Concluído em']).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    await api().get(`/api/v1/documents/stock-counts/${c.id}`).set(A(colab)).expect(403);
    await api().get(`/api/v1/documents/stock-counts/${randomUUID()}`).set(A(gestor)).expect(404);
  });
});
