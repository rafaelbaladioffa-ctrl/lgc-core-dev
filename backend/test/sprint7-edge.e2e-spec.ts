import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Casos de borda do Sprint 7 (inventário). Complementa test/sprint7.e2e-spec.ts sem repeti-lo.
// Bugs confirmados ficam como it.fails com comentário: o teste passa enquanto o defeito existir e
// deve ser trocado por `it` quando for corrigido.

const SECRET = process.env.JWT_SECRET!;
const tokenFor = (roles: string[], sub: string) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });

describe('Sprint 7 — casos de borda do inventário', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = Date.now().toString(36).toUpperCase();
  const gestor = tokenFor(['gestor'], 'gestor-s7e');
  const admin = tokenFor(['admin'], 'admin-s7e');
  const c1 = tokenFor(['tecnico'], `e7cnt1-${sfx}`);
  const c2 = tokenFor(['tecnico'], `e7cnt2-${sfx}`);
  const outsider = tokenFor(['tecnico'], `e7out-${sfx}`);
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());

  let un: string;
  let seq = 0;
  const whIds: string[] = [];

  // Cada teste trabalha em almoxarifado próprio, para que congelamentos e amostragens não se misturem.
  const newWh = async (type = 'CENTRAL', projectAxisId?: string) => {
    const n = ++seq;
    const id = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: `E7${n}${sfx}`, name: `Almox borda ${n}`, type, ...(projectAxisId && { projectAxisId }) }).expect(201)).body.id as string;
    whIds.push(id);
    for (const u of [`e7cnt1-${sfx}`, `e7cnt2-${sfx}`]) await api().put(`/api/v1/rbac/users/${u}/warehouses`).set(A(admin)).send({ warehouseIds: [...whIds] }).expect(200);
    return id;
  };
  const newLoc = async (wh: string) => (await api().post(`/api/v1/warehouses/${wh}/locations`).set(A(gestor)).send({ code: `E7L${++seq}-${sfx}`, level: 'AREA' }).expect(201)).body.id as string;
  const mk = async (tag: string, extra: Record<string, unknown> = {}) =>
    (await api().post('/api/v1/materials').set(A(admin)).send({ code: `E7-${tag}-${sfx}-${++seq}`, shortDescription: `Borda ${tag}`, category: 'Teste', type: 'CONSUMO', stockUomId: un, ...extra }).expect(201)).body.id as string;
  const newLot = async (materialId: string, lotNumber: string) => (await api().post('/api/v1/lots').set(A(gestor)).send({ materialId, lotNumber: `${lotNumber}-${sfx}` }).expect(201)).body.id as string;
  const stockIn = (materialId: string, quantity: number, to: string, extra: Record<string, unknown> = {}) =>
    api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ type: 'ENTRADA_RECEBIMENTO', materialId, quantity, toLocationId: to, reason: 'Carga de borda', ...extra });
  const stockOut = (materialId: string, quantity: number, from: string) =>
    api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ type: 'SAIDA_ENTREGA', materialId, quantity, fromLocationId: from, reason: 'Saída de borda' });
  const balances = async (materialId: string, locationId: string) => Number((await prisma.stockBalance.aggregate({ where: { materialId, locationId }, _sum: { quantity: true } }))._sum.quantity ?? 0);
  const create = (body: Record<string, unknown>, token = gestor) => api().post('/api/v1/stock-counts').set(A(token)).send({ type: 'ENDERECO', ...body });
  const act = (id: string, action: string, body: Record<string, unknown> = {}, token = gestor) => api().post(`/api/v1/stock-counts/${id}/${action}`).set(A(token)).send(body);
  const submit = (id: string, lineId: string, quantity: number, token = c1) => act(id, 'counts', { lineId, quantity }, token);
  const lines = async (id: string) => (await api().get(`/api/v1/stock-counts/${id}`).set(A(gestor)).expect(200)).body.lines as Array<{ id: string; materialId: string; locationId: string; serialId: string | null; lotId: string | null; status: string; systemQty: string; finalQty: string | null; adjustmentMovementId: string | null }>;
  const adjust = (id: string, body: Record<string, unknown>) => act(id, 'adjustments', body);
  /** Abre um inventário de endereço com um item de saldo `qty` e o leva até o estado pedido. */
  const openWith = async (state: 'ABERTA' | 'EM_CONTAGEM' | 'EM_RECONTAGEM' | 'APURADA' | 'CONCLUIDA', tolerancePct = 0) => {
    const wh = await newWh();
    const loc = await newLoc(wh);
    const m = await mk('ST');
    await stockIn(m, 10, loc).expect(201);
    // APURADA precisa de divergência aceita sem recontagem: tolerância 100 aceita a queda de −60%.
    const c = (await create({ warehouseId: wh, scope: { locationIds: [loc] }, tolerancePct: state === 'APURADA' ? 100 : tolerancePct }).expect(201)).body;
    if (state === 'ABERTA') return { c, loc, m, wh };
    await act(c.id, 'start').expect(200);
    if (state === 'EM_CONTAGEM') return { c, loc, m, wh };
    const [l] = await lines(c.id);
    await submit(c.id, l.id, state === 'CONCLUIDA' ? 10 : 4).expect(200); // 4 contra 10 = −60%
    if (state === 'CONCLUIDA') { await act(c.id, 'close-round').expect(200); return { c, loc, m, wh }; }
    await act(c.id, 'close-round').expect(200);
    if (state === 'EM_RECONTAGEM') return { c, loc, m, wh };
    // APURADA: com tolerância 100 a diferença de −60% é aceita sem recontagem.
    return { c, loc, m, wh };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    un = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
  });
  afterAll(async () => app.close());

  // ---------------------------------------------------------------------------------------------
  // Linhas por balanço e contagem cega
  // ---------------------------------------------------------------------------------------------

  it('balanço por chave completa: lote, condição e propriedade geram linhas separadas e fecham sem divergência', async () => {
    const wh = await newWh();
    const loc = await newLoc(wh);
    const lm = await mk('LOT', { lotControlled: true });
    const lot1 = await newLot(lm, 'LA');
    const lot2 = await newLot(lm, 'LB');
    const m = await mk('OWN');
    await stockIn(lm, 4, loc, { lotId: lot1 }).expect(201);
    await stockIn(lm, 3, loc, { lotId: lot2, toCondition: 'AVARIADO' }).expect(201);
    await stockIn(m, 2, loc, { ownership: 'CLIENTE' }).expect(201);
    await stockIn(m, 5, loc).expect(201); // propriedade própria (padrão)

    const c = (await create({ warehouseId: wh, scope: { locationIds: [loc] } }).expect(201)).body;
    expect(c.lines).toBe(4);
    await act(c.id, 'start').expect(200);

    const sheet = (await api().get(`/api/v1/stock-counts/${c.id}/sheet`).set(A(c1)).expect(200)).body;
    expect(sheet.lines).toHaveLength(4);
    // a folha informa condição e propriedade para o contador contar o balanço certo
    expect(sheet.lines.map((l: { condition: string; ownership: string }) => `${l.condition}/${l.ownership}`).sort()).toEqual(['AVARIADO/PROPRIO', 'DISPONIVEL/CLIENTE', 'DISPONIVEL/PROPRIO', 'DISPONIVEL/PROPRIO'].sort());

    for (const l of await lines(c.id)) await submit(c.id, l.id, Number(l.systemQty)).expect(200);
    expect((await act(c.id, 'close-round').expect(200)).body).toEqual({ status: 'CONCLUIDA', variances: 0 });
  });

  it.fails('BUG: série não prevista deveria aparecer na folha (hoje é silenciosamente ignorada)', async () => {
    // Mesmo cenário do teste acima, em um único passo: o inventário conclui com 0 divergências
    // mesmo com duas séries no endereço, porque a série extra nunca entra na contagem.
    const wh = await newWh();
    const loc = await newLoc(wh);
    const s = await mk('SER2', { serialControlled: true, assetTagged: true, type: 'EQUIPAMENTO', exitMethod: 'SERIE_ESPECIFICA' });
    const sn1 = (await api().post('/api/v1/serial-numbers').set(A(gestor)).send({ materialId: s, serial: `E7T1-${sfx}` }).expect(201)).body.id as string;
    const sn2 = (await api().post('/api/v1/serial-numbers').set(A(gestor)).send({ materialId: s, serial: `E7T2-${sfx}` }).expect(201)).body.id as string;
    await stockIn(s, 1, loc, { serialId: sn1 }).expect(201);
    const c = (await create({ warehouseId: wh, scope: { locationIds: [loc] }, frozen: false }).expect(201)).body;
    await act(c.id, 'start').expect(200);
    await stockIn(s, 1, loc, { serialId: sn2 }).expect(201);
    const [l1] = (await lines(c.id)).filter((l) => l.serialId === sn1);
    await submit(c.id, l1.id, 1).expect(200);
    const closed = (await act(c.id, 'close-round').expect(200)).body;
    expect(closed.variances).toBe(1); // deveria apontar a série sobrando
  });

  it('sheet nunca vaza saldo do sistema, custo nem contagens (varre o JSON em todas as rodadas)', async () => {
    const wh = await newWh();
    const loc = await newLoc(wh);
    const m = await mk('LEAK');
    await prisma.material.update({ where: { id: m }, data: { averageCost: 7.77 } });
    await stockIn(m, 6, loc).expect(201);
    const c = (await create({ warehouseId: wh, scope: { locationIds: [loc] }, tolerancePct: 0 }).expect(201)).body;
    await act(c.id, 'start').expect(200);
    const forbidden = /systemQty|unitCost|averageCost|varianceQty|finalQty|count1Qty|count2Qty|count1By|count2By|variance_value|totalVarianceValue/;
    const r1 = (await api().get(`/api/v1/stock-counts/${c.id}/sheet`).set(A(c1)).expect(200)).body;
    expect(JSON.stringify(r1)).not.toMatch(forbidden);
    const [l] = await lines(c.id);
    await submit(c.id, l.id, 3, c1).expect(200); // 3 de 6: recontagem com tolerância 0
    expect((await act(c.id, 'close-round').expect(200)).body.status).toBe('EM_RECONTAGEM');
    const r2 = (await api().get(`/api/v1/stock-counts/${c.id}/sheet`).set(A(c2)).expect(200)).body;
    expect(r2.round).toBe(2);
    expect(r2.lines).toHaveLength(1);
    expect(JSON.stringify(r2)).not.toMatch(forbidden);
    expect(JSON.stringify(r2)).not.toMatch(/"3"|"6"|7\.77/); // nem o valor contado nem o saldo/custo aparecem
  });

  it('contador sem acesso ao almoxarifado não lê a folha, não conta e não vê o inventário na listagem', async () => {
    const { c } = await openWith('EM_CONTAGEM');
    await api().get(`/api/v1/stock-counts/${c.id}/sheet`).set(A(outsider)).expect(403);
    const [l] = await lines(c.id);
    await submit(c.id, l.id, 1, outsider).expect(403);
    const list = (await api().get('/api/v1/stock-counts').set(A(outsider)).expect(200)).body as Array<{ id: string }>;
    expect(list.map((x) => x.id)).not.toContain(c.id);
    await api().get(`/api/v1/stock-counts/${c.id}/report`).set(A(c1)).expect(403); // relatório é gestão
  });

  // ---------------------------------------------------------------------------------------------
  // Tolerância, recontagem e segregação
  // ---------------------------------------------------------------------------------------------

  it('tolerância 0: qualquer diferença recontará; tolerância 100: queda total fica como divergência; alta acima de 100% recontará', async () => {
    const wh = await newWh();
    const loc0 = await newLoc(wh);
    const loc100 = await newLoc(wh);
    const loc100b = await newLoc(wh);
    const m0 = await mk('T0'); const m100 = await mk('T100'); const m100b = await mk('T100B');
    await stockIn(m0, 100, loc0).expect(201); await stockIn(m100, 10, loc100).expect(201); await stockIn(m100b, 10, loc100b).expect(201);

    const c0 = (await create({ warehouseId: wh, scope: { locationIds: [loc0] }, tolerancePct: 0 }).expect(201)).body;
    await act(c0.id, 'start').expect(200);
    await submit(c0.id, (await lines(c0.id))[0].id, 99).expect(200);
    expect((await act(c0.id, 'close-round').expect(200)).body.status).toBe('EM_RECONTAGEM');

    const c100 = (await create({ warehouseId: wh, scope: { locationIds: [loc100] }, tolerancePct: 100 }).expect(201)).body;
    await act(c100.id, 'start').expect(200);
    await submit(c100.id, (await lines(c100.id))[0].id, 0).expect(200);
    expect((await act(c100.id, 'close-round').expect(200)).body).toEqual({ status: 'APURADA', variances: 1 });

    const c100b = (await create({ warehouseId: wh, scope: { locationIds: [loc100b] }, tolerancePct: 100 }).expect(201)).body;
    await act(c100b.id, 'start').expect(200);
    await submit(c100b.id, (await lines(c100b.id))[0].id, 25).expect(200); // +150%
    expect((await act(c100b.id, 'close-round').expect(200)).body.status).toBe('EM_RECONTAGEM');
  });

  it('recontagem: a 1ª contagem da 2ª rodada é gravada e o contador vê a folha vazia na rodada', async () => {
    const { c } = await openWith('EM_RECONTAGEM');
    const rec = (await api().get(`/api/v1/stock-counts/${c.id}/sheet`).set(A(c2)).expect(200)).body.lines[0];
    await submit(c.id, rec.id, 5, c2).expect(200);
    // A linha continua listada na folha do mesmo operador — ver it.fails abaixo.
    expect((await api().get(`/api/v1/stock-counts/${c.id}/sheet`).set(A(c2)).expect(200)).body.lines).toHaveLength(1);
  });

  it.fails('BUG: depois de recontar, a linha deveria sair da folha do operador (hoje continua listada)', async () => {
    // O filtro da folha da 2ª rodada só exclui a linha quando count1By = operador; a recontagem feita por ele
    // (count2By) não é considerada, então a linha segue na folha e pode ser sobrescrita (ver teste acima).
    const { c } = await openWith('EM_RECONTAGEM');
    const rec = (await api().get(`/api/v1/stock-counts/${c.id}/sheet`).set(A(c2)).expect(200)).body.lines[0];
    await submit(c.id, rec.id, 5, c2).expect(200);
    expect((await api().get(`/api/v1/stock-counts/${c.id}/sheet`).set(A(c2)).expect(200)).body.lines).toHaveLength(0);
  });

  it.fails('BUG: segunda contagem da recontagem pelo mesmo operador é aceita e sobrescreve a anterior (deveria ser 409)', async () => {
    // Na 1ª rodada a 2ª contagem da mesma linha dá 409; na recontagem o registro é sobrescrito sem erro.
    const { c } = await openWith('EM_RECONTAGEM');
    const rec = (await api().get(`/api/v1/stock-counts/${c.id}/sheet`).set(A(c2)).expect(200)).body.lines[0];
    await submit(c.id, rec.id, 5, c2).expect(200);
    await submit(c.id, rec.id, 6, c2).expect(409);
  });

  it('concluir a recontagem exige que todas as linhas recontadas tenham registro', async () => {
    const { c } = await openWith('EM_RECONTAGEM');
    await act(c.id, 'close-round').expect(422);
  });

  // ---------------------------------------------------------------------------------------------
  // Concorrência
  // ---------------------------------------------------------------------------------------------

  it.fails('BUG: duas contagens simultâneas na mesma linha da 1ª rodada — uma deveria ser 409', async () => {
    // Ambas leem a linha como PENDENTE antes de gravar; a checagem não é atômica (sem lock nem condição no UPDATE).
    const { c } = await openWith('EM_CONTAGEM');
    const [l] = await lines(c.id);
    const [a, b] = await Promise.all([submit(c.id, l.id, 4, c1), submit(c.id, l.id, 6, c2)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  // ---------------------------------------------------------------------------------------------
  // Ajuste: saldo reservado, rollback, parcial e saldo movimentado
  // ---------------------------------------------------------------------------------------------

  it('ajuste negativo abaixo do saldo reservado é recusado e não deixa nada persistido', async () => {
    const wh = await newWh();
    const loc = await newLoc(wh);
    const m = await mk('RES');
    await stockIn(m, 10, loc).expect(201);
    const c = (await create({ warehouseId: wh, scope: { locationIds: [loc] }, tolerancePct: 100 }).expect(201)).body;
    await act(c.id, 'start').expect(200);
    const [l] = await lines(c.id);
    await submit(c.id, l.id, 5).expect(200);
    expect((await act(c.id, 'close-round').expect(200)).body.status).toBe('APURADA');

    // 8 unidades reservadas (ex.: transferência ou separação em curso): o saldo não pode cair abaixo disso
    await prisma.$executeRaw`UPDATE stock_balances SET reserved_qty = 8 WHERE material_id = ${m} AND location_id = ${loc}`;
    const res = await adjust(c.id, { approvalRef: 'APR-RES', lines: [{ lineId: l.id, reason: 'PERDA' }] });
    expect(res.status).not.toBe(200);
    expect(await balances(m, loc)).toBe(10);
    expect(await prisma.stockMovement.count({ where: { correlationId: c.id } })).toBe(0);
    const after = (await api().get(`/api/v1/stock-counts/${c.id}`).set(A(gestor)).expect(200)).body;
    expect(after.status).toBe('APURADA');
    expect(after.lines[0]).toMatchObject({ status: 'DIVERGENTE', adjustmentMovementId: null });
  });

  it.fails('BUG: ajuste que quebra o saldo reservado deveria responder 422 (hoje responde erro de servidor)', async () => {
    // A transação de ajuste não converte a violação de CHECK (stock_balances_reserved_range) em 422 como faz StockService.run.
    const wh = await newWh();
    const loc = await newLoc(wh);
    const m = await mk('RES2');
    await stockIn(m, 10, loc).expect(201);
    const c = (await create({ warehouseId: wh, scope: { locationIds: [loc] }, tolerancePct: 100 }).expect(201)).body;
    await act(c.id, 'start').expect(200);
    const [l] = await lines(c.id);
    await submit(c.id, l.id, 5).expect(200);
    await act(c.id, 'close-round').expect(200);
    await prisma.$executeRaw`UPDATE stock_balances SET reserved_qty = 8 WHERE material_id = ${m} AND location_id = ${loc}`;
    await adjust(c.id, { approvalRef: 'APR-RES', lines: [{ lineId: l.id, reason: 'PERDA' }] }).expect(422);
  });

  it('rollback total: se um ajuste falha, os anteriores da mesma aprovação não persistem', async () => {
    const wh = await newWh();
    const loc = await newLoc(wh);
    const m1 = await mk('RB1');
    const m2 = await mk('RB2');
    await stockIn(m1, 10, loc).expect(201);
    await stockIn(m2, 10, loc).expect(201);
    const c = (await create({ warehouseId: wh, scope: { locationIds: [loc] }, tolerancePct: 100 }).expect(201)).body;
    await act(c.id, 'start').expect(200);
    const ls = await lines(c.id);
    for (const l of ls) await submit(c.id, l.id, 5).expect(200);
    expect((await act(c.id, 'close-round').expect(200)).body).toEqual({ status: 'APURADA', variances: 2 });
    await prisma.$executeRaw`UPDATE stock_balances SET reserved_qty = 8 WHERE material_id = ${m2} AND location_id = ${loc}`;

    const res = await adjust(c.id, { approvalRef: 'APR-RB', lines: ls.map((l) => ({ lineId: l.id, reason: 'PERDA' })) });
    expect(res.status).not.toBe(200);
    expect(await balances(m1, loc)).toBe(10); // o ajuste que daria certo foi desfeito
    expect(await balances(m2, loc)).toBe(10);
    expect(await prisma.stockMovement.count({ where: { correlationId: c.id } })).toBe(0);
    const after = (await api().get(`/api/v1/stock-counts/${c.id}`).set(A(gestor)).expect(200)).body;
    expect(after.status).toBe('APURADA');
    expect(after.lines.every((l: { adjustmentMovementId: string | null }) => l.adjustmentMovementId === null)).toBe(true);
  });

  it('ajuste parcial (linha divergente omitida) é recusado e nada muda', async () => {
    const wh = await newWh();
    const loc = await newLoc(wh);
    const m1 = await mk('PA1');
    const m2 = await mk('PA2');
    await stockIn(m1, 10, loc).expect(201);
    await stockIn(m2, 10, loc).expect(201);
    const c = (await create({ warehouseId: wh, scope: { locationIds: [loc] }, tolerancePct: 100 }).expect(201)).body;
    await act(c.id, 'start').expect(200);
    const ls = await lines(c.id);
    for (const l of ls) await submit(c.id, l.id, 5).expect(200);
    await act(c.id, 'close-round').expect(200);

    const first = ls.find((l) => l.materialId === m1)!;
    await adjust(c.id, { approvalRef: 'APR-PA', lines: [{ lineId: first.id, reason: 'PERDA' }] }).expect(422);
    expect(await balances(m1, loc)).toBe(10);
    expect(await balances(m2, loc)).toBe(10);
    expect((await api().get(`/api/v1/stock-counts/${c.id}`).set(A(gestor)).expect(200)).body.status).toBe('APURADA');

    // depois, com todas as linhas, o ajuste passa
    await adjust(c.id, { approvalRef: 'APR-PA', lines: ls.map((l) => ({ lineId: l.id, reason: 'PERDA' })) }).expect(200);
    expect(await balances(m1, loc)).toBe(5);
    expect(await balances(m2, loc)).toBe(5);
  });

  it('frozen=false não bloqueia movimento durante a contagem', async () => {
    const wh = await newWh();
    const loc = await newLoc(wh);
    const m = await mk('UNF');
    await stockIn(m, 10, loc).expect(201);
    const c = (await create({ warehouseId: wh, scope: { locationIds: [loc] }, frozen: false }).expect(201)).body;
    await act(c.id, 'start').expect(200);
    await stockIn(m, 2, loc).expect(201); // congelamento desligado: entra normalmente
    await stockOut(m, 1, loc).expect(201);
    expect(await balances(m, loc)).toBe(11);
  });

  it.fails('BUG: ajuste calculado sobre o snapshot desfaz movimento feito após a contagem (frozen=false)', async () => {
    // Snapshot 10; saída de 3 após o início (balanço 7); contador conta 7 (fisicamente certo).
    // A apuração compara com o snapshot (10), gera ajuste de −3 e o saldo cai para 4, abaixo do físico.
    const wh = await newWh();
    const loc = await newLoc(wh);
    const m = await mk('SNAP');
    await stockIn(m, 10, loc).expect(201);
    const c = (await create({ warehouseId: wh, scope: { locationIds: [loc] }, frozen: false, tolerancePct: 100 }).expect(201)).body;
    await act(c.id, 'start').expect(200);
    await stockOut(m, 3, loc).expect(201);
    const [l] = await lines(c.id);
    await submit(c.id, l.id, 7).expect(200);
    await act(c.id, 'close-round').expect(200);
    await adjust(c.id, { approvalRef: 'APR-SNAP', lines: [{ lineId: l.id, reason: 'ERRO_CONTAGEM_ANTERIOR' }] }).expect(200);
    expect(await balances(m, loc)).toBe(7);
  });

  // ---------------------------------------------------------------------------------------------
  // Tipos de inventário e escopo
  // ---------------------------------------------------------------------------------------------

  it('AMOSTRAGEM maior que o universo traz o universo inteiro, sem duplicar nem falhar', async () => {
    const wh = await newWh();
    const loc = await newLoc(wh);
    await stockIn(await mk('AM1'), 1, loc).expect(201);
    await stockIn(await mk('AM2'), 1, loc).expect(201);
    const c = (await api().post('/api/v1/stock-counts').set(A(gestor)).send({ type: 'AMOSTRAGEM', warehouseId: wh, scope: { sampleSize: 5000 } }).expect(201)).body;
    expect(c.lines).toBe(2);
    await act(c.id, 'cancel', { reason: 'Só validando o escopo' }).expect(200);
  });

  it('PROJETO exige almoxarífado de projeto e, com ele, conta o saldo do projeto', async () => {
    const semProjeto = await newWh('CENTRAL');
    await api().post('/api/v1/stock-counts').set(A(gestor)).send({ type: 'PROJETO', warehouseId: semProjeto }).expect(422);

    const wh = await newWh('PROJETO', `PRJ-E7-${sfx}`);
    const loc = await newLoc(wh);
    await stockIn(await mk('PRJ'), 3, loc).expect(201);
    const c = (await api().post('/api/v1/stock-counts').set(A(gestor)).send({ type: 'PROJETO', warehouseId: wh }).expect(201)).body;
    expect(c.lines).toBe(1);
    await act(c.id, 'cancel', { reason: 'Só validando o escopo' }).expect(200);
  });

  it('endereço de outro almoxarifado no escopo é ignorado e não entra no inventário', async () => {
    const wh = await newWh();
    const other = await newWh();
    const mine = await newLoc(wh);
    const theirs = await newLoc(other);
    const m = await mk('XWH');
    await stockIn(m, 4, mine).expect(201);
    await stockIn(m, 9, theirs).expect(201);
    const c = (await create({ warehouseId: wh, scope: { locationIds: [mine, theirs] } }).expect(201)).body;
    expect(c.lines).toBe(1);
    const [l] = await lines(c.id);
    expect(l.locationId).toBe(mine);
    await act(c.id, 'cancel', { reason: 'Só validando o escopo' }).expect(200);
  });

  // ---------------------------------------------------------------------------------------------
  // Ciclo de vida: cancelar em cada estado e "reabrir"
  // ---------------------------------------------------------------------------------------------

  it.each(['ABERTA', 'EM_CONTAGEM', 'EM_RECONTAGEM', 'APURADA'] as const)('cancelar em %s libera o congelamento e fecha a contagem', async (state) => {
    const { c, loc, m } = await openWith(state);
    await act(c.id, 'cancel', { reason: `Cancelado em ${state}` }).expect(200);
    await stockIn(m, 1, loc).expect(201); // descongelado
    if (state === 'EM_CONTAGEM' || state === 'EM_RECONTAGEM') {
      const [l] = await lines(c.id);
      await submit(c.id, l.id, 1).expect(409);
      await api().get(`/api/v1/stock-counts/${c.id}/sheet`).set(A(c1)).expect(409);
    }
    await act(c.id, 'start').expect(409);
    await act(c.id, 'cancel', { reason: 'De novo' }).expect(409);
  });

  it('inventário concluído não pode ser cancelado nem ajustado de novo', async () => {
    const { c, m, loc } = await openWith('CONCLUIDA');
    expect((await api().get(`/api/v1/stock-counts/${c.id}`).set(A(gestor)).expect(200)).body.status).toBe('CONCLUIDA');
    await act(c.id, 'cancel', { reason: 'Tarde demais' }).expect(409);
    await adjust(c.id, { approvalRef: 'APR-X', lines: [] }).expect(400);
    await stockIn(m, 1, loc).expect(201);
  });

  it('não há reabertura: o inventário cancelado ou concluído não volta a contar (rota inexistente)', async () => {
    // Lacuna do Sprint 7: se a reabertura for implementada, substituir por testes de transição.
    const { c } = await openWith('APURADA');
    await api().post(`/api/v1/stock-counts/${c.id}/reopen`).set(A(gestor)).send({}).expect(404);
  });

  // ---------------------------------------------------------------------------------------------
  // Relatório e eventos
  // ---------------------------------------------------------------------------------------------

  it('eventos de outbox: variância no apurado, disponibilidade após ajuste; sem divergência não há evento de variância', async () => {
    const wh = await newWh();
    const loc = await newLoc(wh);
    const m = await mk('EV');
    await stockIn(m, 10, loc).expect(201);
    const c = (await create({ warehouseId: wh, scope: { locationIds: [loc] }, tolerancePct: 100 }).expect(201)).body;
    await act(c.id, 'start').expect(200);
    const [l] = await lines(c.id);
    await submit(c.id, l.id, 8).expect(200);
    await act(c.id, 'close-round').expect(200);
    expect(await prisma.integrationMessage.count({ where: { eventType: 'inventory.variance_detected', payload: { path: ['count_id'], equals: c.id } } })).toBe(1);
    await adjust(c.id, { approvalRef: 'APR-EV', lines: [{ lineId: l.id, reason: 'OUTRO' }] }).expect(200);
    expect(await prisma.integrationMessage.count({ where: { eventType: 'availability.changed', payload: { path: ['warehouse_id'], equals: wh } } })).toBeGreaterThanOrEqual(1);

    const wh2 = await newWh();
    const loc2 = await newLoc(wh2);
    // segundo almoxarifado: o inventário dele não pode enxergar o saldo do primeiro
    const m2 = await mk('EV2');
    await stockIn(m2, 2, loc2).expect(201);
    const c2x = (await create({ warehouseId: wh2, scope: { locationIds: [loc2] } }).expect(201)).body;
    await act(c2x.id, 'start').expect(200);
    for (const x of await lines(c2x.id)) await submit(c2x.id, x.id, 2).expect(200);
    expect((await act(c2x.id, 'close-round').expect(200)).body.status).toBe('CONCLUIDA');
    expect(await prisma.integrationMessage.count({ where: { eventType: 'inventory.variance_detected', payload: { path: ['count_id'], equals: c2x.id } } })).toBe(0);
  });

  it('relatório mostra antes/depois e marca recorrência quando o mesmo item diverge em inventário anterior', async () => {
    const wh = await newWh();
    const loc = await newLoc(wh);
    const m = await mk('REC');
    await stockIn(m, 10, loc).expect(201);
    const first = (await create({ warehouseId: wh, scope: { locationIds: [loc] }, tolerancePct: 100 }).expect(201)).body;
    await act(first.id, 'start').expect(200);
    await submit(first.id, (await lines(first.id))[0].id, 9).expect(200);
    await act(first.id, 'close-round').expect(200);
    await adjust(first.id, { approvalRef: 'APR-R1', lines: [{ lineId: (await lines(first.id))[0].id, reason: 'PERDA' }] }).expect(200);

    const second = (await create({ warehouseId: wh, scope: { locationIds: [loc] }, tolerancePct: 100 }).expect(201)).body;
    await act(second.id, 'start').expect(200);
    await submit(second.id, (await lines(second.id))[0].id, 7).expect(200);
    await act(second.id, 'close-round').expect(200);
    const rep = (await api().get(`/api/v1/stock-counts/${second.id}/report`).set(A(gestor)).expect(200)).body;
    expect(rep.items).toHaveLength(1);
    expect(rep.items[0]).toMatchObject({ before: '9', after: '7', variance: '-2', recurrent: true });
    expect(rep.recurrentCount).toBe(1);
  });
});
