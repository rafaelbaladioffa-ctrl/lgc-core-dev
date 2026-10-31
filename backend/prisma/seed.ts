import { PrismaClient, UomDimension } from '@prisma/client';
import { DEFAULT_AXIS_ROLE_MAP, PERMISSIONS, ROLES } from '../src/rbac/catalog.js';

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
}

main().finally(() => prisma.$disconnect());
