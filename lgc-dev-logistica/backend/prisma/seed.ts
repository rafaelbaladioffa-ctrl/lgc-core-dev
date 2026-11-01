import { PrismaClient, UomDimension } from '@prisma/client';
import { DEFAULT_AXIS_ROLE_MAP, PERMISSIONS, ROLES } from '../src/rbac/catalog.js';
import { CATALOG } from './catalog-data.js';

const prisma = new PrismaClient();

const UOMS: Array<[string, string, UomDimension, number]> = [
  ['UN', 'Unidade', 'UNIDADE', 0],
  ['PAR', 'Par', 'UNIDADE', 0],
  ['JG', 'Jogo', 'UNIDADE', 0],
  ['KIT', 'Kit', 'UNIDADE', 0],
  ['CX', 'Caixa', 'EMBALAGEM', 0],
  ['PCT', 'Pacote', 'EMBALAGEM', 0],
  ['FD', 'Fardo', 'EMBALAGEM', 0],
  ['ROLO', 'Rolo', 'EMBALAGEM', 0],
  ['RESMA', 'Resma', 'EMBALAGEM', 0],
  ['KG', 'Quilograma', 'MASSA', 3],
  ['L', 'Litro', 'VOLUME', 3],
  ['M', 'Metro', 'COMPRIMENTO', 2],
  ['M2', 'Metro quadrado', 'AREA', 2],
  ['M3', 'Metro cúbico', 'VOLUME', 3],
];

async function main() {
  for (const [code, name, dimension, precision] of UOMS) {
    await prisma.unitOfMeasure.upsert({ where: { code }, update: {}, create: { code, name, dimension, precision } });
  }
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await prisma.logisticsPermission.upsert({ where: { code }, update: { description }, create: { code, description } });
  }
  for (const role of ROLES) {
    const saved = await prisma.logisticsRole.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: { code: role.code, name: role.name, description: role.description },
    });
    const perms = await prisma.logisticsPermission.findMany({ where: { code: { in: role.permissions } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: saved.id } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: saved.id, permissionId: p.id })) });
  }
  // Mapeamento só é semeado se estiver vazio — não sobrescreve edições feitas em produção.
  if ((await prisma.axisRoleToLogisticsRole.count()) === 0) {
    for (const [axisRole, codes] of Object.entries(DEFAULT_AXIS_ROLE_MAP)) {
      for (const code of codes) {
        const role = await prisma.logisticsRole.findUniqueOrThrow({ where: { code } });
        await prisma.axisRoleToLogisticsRole.create({ data: { axisRole, logisticsRoleId: role.id } });
      }
    }
  }

  if (process.env.SEED_CATALOG !== 'false') await seedCatalog();
  if (process.env.SEED_DEV_DATA === 'true' && process.env.NODE_ENV !== 'production') await seedDevData();
}

/**
 * Catálogo inicial (seção 8.1–8.8 do planejamento): cria os materiais que ainda não existem, sem sobrescrever o que a LGC já ajustou.
 * Os controles da coluna "Controles recomendados" viram flags; 8.9 (químicos) NÃO é carregado — exige validação técnica e de HSE.
 */
async function seedCatalog() {
  const uoms = new Map((await prisma.unitOfMeasure.findMany()).map((u) => [u.code, u.id]));
  let created = 0;
  for (const it of CATALOG) {
    if (await prisma.material.findUnique({ where: { code: it.code }, select: { id: true } })) continue;
    const stockUomId = uoms.get(it.uom);
    if (!stockUomId) throw new Error(`Unidade ${it.uom} do item ${it.code} não existe no cadastro de unidades.`);
    const data = {
      code: it.code, shortDescription: it.description, category: it.category, subcategory: it.subcategory,
      type: it.type as never, stockUomId, createdBy: 'seed',
      technicalDescription: `Controles recomendados (seção 8 do planejamento): ${it.controls}. Marca, modelo, tamanhos, CA e quantidades mínimas a confirmar pela LGC.`,
      lotControlled: it.lotControlled, expiryControlled: it.expiryControlled, serialControlled: it.serialControlled, assetTagged: it.assetTagged,
      requiresCa: it.requiresCa, requiresCalibration: it.requiresCalibration, calibratable: it.requiresCalibration, returnable: it.returnable,
      disposable: it.disposable, repairable: it.repairable, hasSizeGrid: it.hasSizeGrid, exitMethod: it.exitMethod as never, criticality: it.criticality as never,
      riskClass: it.riskClass, storageCondition: it.storageCondition,
    };
    const m = await prisma.material.create({ data });
    await prisma.materialVersion.create({ data: { materialId: m.id, version: 1, snapshot: JSON.parse(JSON.stringify(m)), changedBy: 'seed', changeReason: 'Carga inicial do catálogo' } });
    created++;
  }
  console.log(`Catálogo inicial: ${created} material(is) criado(s) de ${CATALOG.length} (8.9 químicos não carregado).`);
}

/**
 * Dados de desenvolvimento (SEED_DEV_DATA=true, nunca em produção): um almoxarifado com endereços para o fluxo manual funcionar
 * logo após o login, e acesso por almoxarifado para os usuários listados em SEED_DEV_GRANT_SUBS. Não altera o mapeamento de perfis.
 */
async function seedDevData() {
  const wh = await prisma.warehouse.upsert({
    where: { code: 'ALM-CENTRAL' },
    update: {},
    create: { code: 'ALM-CENTRAL', name: 'Almoxarifado Central (desenvolvimento)', type: 'CENTRAL', createdBy: 'seed' },
  });
  for (const [code, name] of [['DOCA', 'Doca de recebimento'], ['A-01', 'Corredor A, posição 1'], ['A-02', 'Corredor A, posição 2'], ['B-01', 'Corredor B, posição 1']]) {
    await prisma.location.upsert({ where: { warehouseId_code: { warehouseId: wh.id, code } }, update: {}, create: { warehouseId: wh.id, code, name, level: 'AREA' } });
  }
  // Saldo inicial pequeno (entradas reais no ledger) para as telas não ficarem vazias: itens sem lote/série.
  const locs = await prisma.location.findMany({ where: { warehouseId: wh.id, code: { in: ['A-01', 'A-02', 'B-01'] } } });
  const simple = CATALOG.filter((i) => !i.lotControlled && !i.serialControlled && !i.requiresCa).slice(0, 24);
  for (const [n, it] of simple.entries()) {
    const key = `seed-saldo:${it.code}`;
    if (await prisma.stockMovement.findUnique({ where: { idempotencyKey: key }, select: { id: true } })) continue;
    const material = await prisma.material.findUnique({ where: { code: it.code } });
    const loc = locs[n % locs.length];
    if (!material || !loc) continue;
    const qty = 10 + ((n * 7) % 40);
    await prisma.$transaction([
      prisma.stockMovement.create({ data: { type: 'ENTRADA_RECEBIMENTO', materialId: material.id, quantity: qty, uomId: material.stockUomId, toLocationId: loc.id, reason: 'Saldo inicial de desenvolvimento', effectiveAt: new Date(), actorAxisId: 'seed', correlationId: 'seed', idempotencyKey: key } }),
      prisma.stockBalance.upsert({ where: { materialId_locationId_lotKey_condition_ownership: { materialId: material.id, locationId: loc.id, lotKey: '', condition: 'DISPONIVEL', ownership: 'PROPRIO' } }, update: { quantity: { increment: qty } }, create: { materialId: material.id, locationId: loc.id, quantity: qty } }),
    ]);
  }

  // Perfil direto + acesso aos almoxarifados para os usuários do Axis listados (claim `sub` do JWT).
  // Acesso por almoxarifado é por usuário (user_warehouse_access): SEED_DEV_GRANT_SUBS = ids do Axis (claim `sub`) separados por vírgula.
  const subs = (process.env.SEED_DEV_GRANT_SUBS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const all = [{ id: wh.id }]; // só o almoxarifado de desenvolvimento (o banco de teste tem centenas de outros)
  for (const sub of subs) {
    const gestorRole = await prisma.logisticsRole.findUniqueOrThrow({ where: { code: 'GESTOR_ALMOXARIFADO' } });
    await prisma.userLogisticsRole.upsert({ where: { axisUserId_logisticsRoleId: { axisUserId: sub, logisticsRoleId: gestorRole.id } }, update: {}, create: { axisUserId: sub, logisticsRoleId: gestorRole.id, grantedBy: 'seed' } });
    for (const w of all) await prisma.userWarehouseAccess.upsert({ where: { axisUserId_warehouseId: { axisUserId: sub, warehouseId: w.id } }, update: {}, create: { axisUserId: sub, warehouseId: w.id, grantedBy: 'seed' } });
  }
  console.log(`Dados de desenvolvimento: ALM-CENTRAL com saldo inicial; perfil Gestor de almoxarifado e acesso liberados a ${subs.length} usuário(s) de SEED_DEV_GRANT_SUBS.`);
}

main().finally(() => prisma.$disconnect());
