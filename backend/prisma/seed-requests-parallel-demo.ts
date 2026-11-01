/**
 * Seeds ONE demo category with a parallel approval node (REQUISICOES_SPEC.md §9.1
 * TODOS/QUALQUER_UM/N_DE_M) — not part of the real catalog, just a QA fixture so the test
 * session has something to exercise the new engine against without the planning session having
 * to name real Compliance/Jurídico collaborators (a `colaboradores` workflow step needs actual
 * collaborator ids, which this script resolves at seed time — it can't hardcode anyone, since
 * who exists depends on what `seed:org`/real data has created).
 *
 * Picks the seeded admin collaborator plus up to 2 other existing collaborators (any) as the
 * parallel node's approvers, `qualquer_um` (first one to approve finishes the node). Skips
 * (with a clear message) if fewer than 2 collaborators exist in the database.
 *
 * Idempotent (code-based). Run with: npm run seed:requests-parallel-demo
 */
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { RequestCategoriesService } from '../dist/request-categories/request-categories.service.js';

const prisma = new PrismaService();
const requestCategoriesService = new RequestCategoriesService(prisma);

const CODE = 'DEMO-PARALELO';

async function main() {
  const existing = await prisma.requestCategory.findUnique({ where: { code: CODE } });
  if (existing) {
    console.log(`Categoria demo "${CODE}" já existe — nada a fazer.`);
    return;
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@axis.local';
  const adminUser = await prisma.user.findUnique({ where: { email: adminEmail }, select: { collaboratorId: true } });
  if (!adminUser?.collaboratorId) {
    console.log('Admin seedado não tem collaboratorId — rode "npm run prisma:seed" primeiro. Pulando.');
    return;
  }

  const others = await prisma.collaborator.findMany({ where: { id: { not: adminUser.collaboratorId } }, take: 2, select: { id: true } });
  const approverIds = [adminUser.collaboratorId, ...others.map((c) => c.id)];
  if (approverIds.length < 2) {
    console.log(`Só há ${approverIds.length} colaborador(es) no banco — o nó paralelo precisa de ao menos 2. Pulando (rode npm run seed:org primeiro).`);
    return;
  }

  const sector = await prisma.sector.findFirst({ where: { name: 'Compliance' } });
  if (!sector) throw new Error('Setor "Compliance" não encontrado — rode "npm run seed:org" primeiro.');

  await requestCategoriesService.create(
    {
      code: CODE,
      name: '[QA] Aprovação paralela (qualquer um)',
      sectorId: sector.id,
      formSchema: [{ key: 'descricao', label: 'Descrição', type: 'textarea', required: true }],
      workflowSchema: [{ stepOrder: 1, approverRule: 'colaboradores', collaboratorIds: approverIds, completionRule: 'qualquer_um' }],
      slaFirstResponseMinutes: 240,
      slaResolutionMinutes: 2880,
    },
    null,
  );
  console.log(`Categoria demo "${CODE}" criada com ${approverIds.length} aprovadores em paralelo (qualquer_um): ${approverIds.join(', ')}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
