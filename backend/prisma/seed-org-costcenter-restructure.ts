/**
 * One-off restructure of the Cost Center hierarchy, requested directly by the user after
 * `seed-org.ts` had already created the flat (root) + 1-level structure. Sectors are NOT
 * touched — only Cost Centers move. The 16 existing cost centers are deleted and recreated as a
 * 3-level tree under two new root cost centers representing the company's two divisions:
 *
 *   LGC Data Center (root)
 *   ├── Diretoria, Comercial (└ Clientes), Projetos, Operações (└ Qualidade), RH (└ DP),
 *   │   HSE/SST, Financeiro, Suprimentos (├ Almoxarifado e Patrimônio, └ Frota), TI,
 *   │   Jurídico (└ Compliance)
 *   LGC Instalações e Projetos (root, no children yet — reserved for a future division)
 *
 * Safe to run because no collaborator/project is linked to any cost center yet (confirmed by the
 * planning session before requesting this) — deleteMany() would otherwise be blocked by the FK
 * restrict on those tables. Deliberately does NOT hardcode codes: creates go through the real
 * CostCentersService, so the hierarchical code generation (root sequence, "<parent>.<n>" for
 * children) runs exactly as it would via the API.
 *
 * Run with: npm run seed:org-cc-restructure
 */
// Imports from `dist/`, not `src/` — the production Docker image only copies the compiled
// output, so `../src/...` resolves to nothing inside the container (the same issue fixed in
// seed-org.ts after the test session hit it there).
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { CostCentersService } from '../dist/cost-centers/cost-centers.service.js';

const prisma = new PrismaService();
const costCentersService = new CostCentersService(prisma);

// Each old root cost center -> its own sector (unchanged, homonymous) and its children (also
// homonymous with their own sector). This mirrors the original seed-org.ts list exactly, just
// nested one level deeper under "LGC Data Center".
const DIVISION_TREE: Array<{ name: string; children: string[] }> = [
  { name: 'Diretoria', children: [] },
  { name: 'Comercial', children: ['Clientes'] },
  { name: 'Projetos', children: [] },
  { name: 'Operações', children: ['Qualidade'] },
  { name: 'RH', children: ['DP'] },
  { name: 'HSE/SST', children: [] },
  { name: 'Financeiro', children: [] },
  { name: 'Suprimentos', children: ['Almoxarifado e Patrimônio', 'Frota'] },
  { name: 'TI', children: [] },
  { name: 'Jurídico', children: ['Compliance'] },
];

// "LGC Data Center"/"LGC Instalações e Projetos" are company divisions, not one of the existing
// sectors — CostCenter.sectorId is required, though, so both are tied to the "Diretoria" sector
// as the closest fit (a judgment call: the planning session didn't specify one, and these two
// cost centers sit above the whole org chart the same way Diretoria does).
const DIVISION_ROOT_SECTOR_NAME = 'Diretoria';

async function main() {
  // `projects.cost_center_id` is required (every project has one) and RESTRICT — if any project
  // exists at all, it necessarily references a cost center, and this script should NOT silently
  // delete out from under it.
  const projectCount = await prisma.project.count();
  if (projectCount > 0) {
    throw new Error(
      `${projectCount} project(s) exist and reference cost centers — refusing to delete cost centers automatically. ` +
        'Resolve those references first (this script is only safe when nothing real depends on the old cost centers).',
    );
  }

  // `collaborators.cost_center_id` is ON DELETE NO ACTION (no CASCADE/SET NULL), so it would
  // otherwise block the deleteMany below. Unlike projects, clearing this is safe to do
  // automatically: it's just a soft "which cost center am I allocated to" pointer (no history),
  // and every one of them will point at a dangling, about-to-be-deleted id in a moment anyway.
  const { count: clearedCollaborators } = await prisma.collaborator.updateMany({
    where: { costCenterId: { not: null } },
    data: { costCenterId: null },
  });
  if (clearedCollaborators > 0) {
    console.log(`Cleared cost_center_id on ${clearedCollaborators} collaborator(s) that pointed at a cost center about to be deleted.`);
  }

  const existingCount = await prisma.costCenter.count();
  console.log(`Found ${existingCount} existing cost center(s). Deleting all of them...`);
  await prisma.costCenter.deleteMany({});

  // Reset the root sequence so the two new roots get clean codes (100, 200) instead of
  // continuing from wherever the previous structure left off.
  await prisma.$executeRawUnsafe('ALTER SEQUENCE cost_center_root_code_seq RESTART WITH 100');
  console.log('Cleared cost centers and reset cost_center_root_code_seq to start at 100.');

  const diretoriaSector = await prisma.sector.findFirst({ where: { name: DIVISION_ROOT_SECTOR_NAME, parentSectorId: null } });
  if (!diretoriaSector) throw new Error(`Sector "${DIVISION_ROOT_SECTOR_NAME}" not found — run seed-org.ts first`);

  const sectorByName = new Map<string, { id: string; name: string }>();
  for (const sector of await prisma.sector.findMany()) sectorByName.set(sector.name, sector);

  const lgcDataCenter = await costCentersService.create({ name: 'LGC Data Center', sectorId: diretoriaSector.id });
  console.log(`  cost center (root): ${lgcDataCenter.name} -> ${lgcDataCenter.code}`);

  const lgcInstalacoes = await costCentersService.create({ name: 'LGC Instalações e Projetos', sectorId: diretoriaSector.id });
  console.log(`  cost center (root, sem filhos ainda): ${lgcInstalacoes.name} -> ${lgcInstalacoes.code}`);

  for (const { name, children } of DIVISION_TREE) {
    const sector = sectorByName.get(name);
    if (!sector) throw new Error(`Sector "${name}" not found — run seed-org.ts first`);
    const cc = await costCentersService.create({ name, sectorId: sector.id, parentCostCenterId: lgcDataCenter.id });
    console.log(`  cost center (child of LGC Data Center): ${cc.name} -> ${cc.code}`);

    for (const childName of children) {
      const childSector = sectorByName.get(childName);
      if (!childSector) throw new Error(`Sector "${childName}" not found — run seed-org.ts first`);
      const childCc = await costCentersService.create({ name: childName, sectorId: childSector.id, parentCostCenterId: cc.id });
      console.log(`    cost center (child of ${name}): ${childCc.name} -> ${childCc.code}`);
    }
  }

  const finalCount = await prisma.costCenter.count();
  console.log(`Done. ${finalCount} cost center(s) now in place (2 roots + 10 level-2 + 6 level-3 = 18 expected).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
