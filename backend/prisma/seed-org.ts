/**
 * One-off seed of the real organizational structure (sectors, cost centers, job titles),
 * requested directly by the user after the shared database was intentionally cleared. Separate
 * from `prisma/seed.ts` (RBAC + admin bootstrap, re-run on every `docker compose up`) — this
 * script is run once, by hand, and is safe to re-run (every create is name-based idempotent:
 * skips anything that already exists instead of erroring or duplicating).
 *
 * Deliberately does NOT hardcode sector/cost-center codes: it instantiates the real
 * SectorsService/CostCentersService/JobTitlesService and calls their actual `create()` methods,
 * so the hierarchical code generation (root = sector_root_code_seq / cost_center_root_code_seq,
 * child = "<parent.code>.<n>") runs exactly as it would via the API — see
 * backend/src/sectors/sectors.service.ts and cost-centers.service.ts for that logic.
 *
 * Run with: npm run seed:org
 */
// Imports from `dist/`, not `src/`: the production Docker image only copies the compiled
// output (see backend/Dockerfile), so `../src/...` resolves to nothing inside the container —
// confirmed by the test session (ERR_MODULE_NOT_FOUND). `dist/` mirrors `src/`'s layout 1:1
// (tsconfig.build.json's rootDir is `src`), and it's always present wherever this script would
// realistically run, since the app itself runs from `dist/main.js`.
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { SectorsService } from '../dist/sectors/sectors.service.js';
import { CostCentersService } from '../dist/cost-centers/cost-centers.service.js';
import { JobTitlesService } from '../dist/job-titles/job-titles.service.js';
import { OutboxService } from '../dist/integration/outbox.service.js';

const prisma = new PrismaService();
const sectorsService = new SectorsService(prisma);
const outbox = new OutboxService();
const costCentersService = new CostCentersService(prisma, outbox);
const jobTitlesService = new JobTitlesService(prisma, outbox);

const ROOT_SECTORS = [
  'Diretoria',
  'Comercial',
  'Projetos',
  'Operações',
  'RH',
  'HSE/SST',
  'Financeiro',
  'Suprimentos',
  'TI',
  'Jurídico',
];

// [name, parent root sector name]
const SUB_SECTORS: Array<[string, string]> = [
  ['Clientes', 'Comercial'],
  ['Qualidade', 'Operações'],
  ['DP', 'RH'],
  ['Almoxarifado e Patrimônio', 'Suprimentos'],
  ['Frota', 'Suprimentos'],
  ['Compliance', 'Jurídico'],
];

// Cost centers mirror the sector tree 1:1 by name. Each cost center's sectorId is its OWN
// homonymous sector (not the parent) — e.g. cost center "DP" belongs to sector "DP", not "RH" —
// while parentCostCenterId mirrors the sector hierarchy (cost center "DP" → parent cost center
// "RH"), per the planning session's explicit instruction.
const ALL_SECTOR_NAMES = [...ROOT_SECTORS, ...SUB_SECTORS.map(([name]) => name)];

const JOB_TITLES: Array<[string, boolean]> = [
  ['Diretor(a)', false],
  ['Gerente Executivo', false],
  ['Gerente Comercial', false],
  ['Coordenador de Contratos', false],
  ['Analista Comercial', false],
  ['Analista de Relacionamento (CS)', false],
  ['Gerente de Projetos', false],
  ['Coordenador de PMO', false],
  ['Analista de Projetos', false],
  ['Gerente de Operações', false],
  ['Coordenador de Operações', false],
  ['Auxiliar de Infraestrutura de Redes', false],
  ['Técnico de Infraestrutura de Redes I', true],
  ['Técnico de Infraestrutura de Redes II', true],
  ['Técnico de Infraestrutura de Redes III', true],
  ['Analista de RH', false],
  ['Assistente de RH', false],
  ['Analista de DP', false],
  ['Engenheiro de Segurança do Trabalho', false],
  ['Técnico de Segurança do Trabalho', true],
  ['Controller', false],
  ['Analista Financeiro', false],
  ['Assistente Financeiro', false],
  ['Comprador', false],
  ['Analista de Suprimentos', false],
  ['Almoxarife', false],
  ['Auxiliar de Almoxarifado', false],
  ['Motorista', false],
  ['Gestor de Frota', false],
  ['Analista de Qualidade', false],
  ['Coordenador de Qualidade', false],
  ['Analista de TI', false],
  ['Suporte Técnico', false],
  ['Advogado(a)', false],
  ['Analista de Compliance', false],
];

// Tracks created vs already-existing counts so the final summary says what actually happened on
// THIS run, instead of just the total processed — a rerun of an already-seeded database used to
// print the same "Done: N sectors..." either way, which read as if it had created N more.
const counts = { sectorsCreated: 0, costCentersCreated: 0, jobTitlesCreated: 0 };

async function findOrCreateRootSector(name: string) {
  const existing = await prisma.sector.findFirst({ where: { name, parentSectorId: null } });
  if (existing) return existing;
  counts.sectorsCreated++;
  return sectorsService.create({ name });
}

async function findOrCreateSubSector(name: string, parentSectorId: string) {
  const existing = await prisma.sector.findFirst({ where: { name, parentSectorId } });
  if (existing) return existing;
  counts.sectorsCreated++;
  return sectorsService.create({ name, parentSectorId });
}

async function findOrCreateRootCostCenter(name: string, sectorId: string) {
  const existing = await prisma.costCenter.findFirst({ where: { name, parentCostCenterId: null } });
  if (existing) return existing;
  counts.costCentersCreated++;
  return costCentersService.create({ name, sectorId });
}

async function findOrCreateSubCostCenter(name: string, sectorId: string, parentCostCenterId: string) {
  const existing = await prisma.costCenter.findFirst({ where: { name, parentCostCenterId } });
  if (existing) return existing;
  counts.costCentersCreated++;
  return costCentersService.create({ name, sectorId, parentCostCenterId });
}

async function findOrCreateJobTitle(name: string, isTechnician: boolean) {
  const existing = await prisma.jobTitle.findUnique({ where: { name } });
  if (existing) return existing;
  counts.jobTitlesCreated++;
  return jobTitlesService.create({ name, isTechnician });
}

async function main() {
  console.log('Seeding organizational structure (sectors, cost centers, job titles)...');

  // --- Sectors: root first, then subsectors pointing at the right parent ---
  const sectorByName = new Map<string, { id: string; name: string }>();
  for (const name of ROOT_SECTORS) {
    const sector = await findOrCreateRootSector(name);
    sectorByName.set(name, sector);
    console.log(`  sector (root): ${sector.name} -> ${sector.code}`);
  }
  for (const [name, parentName] of SUB_SECTORS) {
    const parent = sectorByName.get(parentName);
    if (!parent) throw new Error(`Parent sector "${parentName}" not found for subsector "${name}"`);
    const sector = await findOrCreateSubSector(name, parent.id);
    sectorByName.set(name, sector);
    console.log(`  sector (sub of ${parentName}): ${sector.name} -> ${sector.code}`);
  }

  for (const name of ALL_SECTOR_NAMES) {
    if (!sectorByName.has(name)) throw new Error(`Sector "${name}" was expected but never created`);
  }

  // --- Cost centers: mirror the sector tree 1:1 by name, each tied to its own homonymous sector ---
  const costCenterByName = new Map<string, { id: string; name: string }>();
  for (const name of ROOT_SECTORS) {
    const sector = sectorByName.get(name)!;
    const cc = await findOrCreateRootCostCenter(name, sector.id);
    costCenterByName.set(name, cc);
    console.log(`  cost center (root): ${cc.name} -> ${cc.code} (sector: ${sector.name})`);
  }
  for (const [name, parentSectorName] of SUB_SECTORS) {
    const sector = sectorByName.get(name)!; // the cost center's OWN sector, not the parent's
    const parentCostCenter = costCenterByName.get(parentSectorName);
    if (!parentCostCenter) throw new Error(`Parent cost center "${parentSectorName}" not found for "${name}"`);
    const cc = await findOrCreateSubCostCenter(name, sector.id, parentCostCenter.id);
    costCenterByName.set(name, cc);
    console.log(`  cost center (sub of ${parentSectorName}): ${cc.name} -> ${cc.code} (sector: ${sector.name})`);
  }

  // --- Job titles: flat list, no sector link in the schema (see module docstring) ---
  for (const [name, isTechnician] of JOB_TITLES) {
    const jobTitle = await findOrCreateJobTitle(name, isTechnician);
    console.log(`  job title: ${jobTitle.name}${jobTitle.isTechnician ? ' [TÉCNICO]' : ''}`);
  }

  console.log(
    `Done. This run created ${counts.sectorsCreated} sector(s), ${counts.costCentersCreated} cost center(s), ` +
      `${counts.jobTitlesCreated} job title(s) — the rest already existed. ` +
      `Totals processed: ${sectorByName.size} sectors, ${costCenterByName.size} cost centers, ${JOB_TITLES.length} job titles.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
