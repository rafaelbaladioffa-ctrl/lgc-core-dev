import { PrismaClient } from '@prisma/client';
import { DEFAULT_AXIS_ROLE_MAP, PERMISSIONS, ROLES } from '../src/rbac/catalog.js';

/**
 * Seed idempotente do catálogo de RBAC. Permissões e perfis seguem o código (src/rbac/catalog.ts);
 * o mapeamento papel do Core → perfil só é criado se ainda não existir, para não desfazer ajustes feitos pela tela.
 */
const prisma = new PrismaClient();

async function main() {
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await prisma.financePermission.upsert({ where: { code }, create: { code, description }, update: { description } });
  }
  const permissions = new Map((await prisma.financePermission.findMany()).map((p) => [p.code, p.id]));

  for (const role of ROLES) {
    const saved = await prisma.financeRole.upsert({
      where: { code: role.code },
      create: { code: role.code, name: role.name, description: role.description },
      update: { name: role.name, description: role.description },
    });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: saved.id } }),
      prisma.rolePermission.createMany({ data: role.permissions.map((code) => ({ roleId: saved.id, permissionId: permissions.get(code)! })) }),
    ]);
  }

  if ((await prisma.axisRoleToFinanceRole.count()) === 0) {
    const roles = new Map((await prisma.financeRole.findMany()).map((r) => [r.code, r.id]));
    const data = Object.entries(DEFAULT_AXIS_ROLE_MAP).flatMap(([axisRole, codes]) => codes.map((code) => ({ axisRole, financeRoleId: roles.get(code)! })));
    await prisma.axisRoleToFinanceRole.createMany({ data });
  }

  console.log(`Seed do Financeiro: ${Object.keys(PERMISSIONS).length} permissões, ${ROLES.length} perfis.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
