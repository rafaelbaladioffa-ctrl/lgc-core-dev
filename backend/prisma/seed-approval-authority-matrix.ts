/**
 * Seeds the default global financial authority matrix (REQUISICOES_SPEC.md §9.2) —
 * administrable via API (`POST /approval-authority-rules`), these are just the suggested
 * starting values the document gives, "parâmetros de implantação, não constantes no código".
 *
 * APPROXIMATION documented explicitly: the real table names "Financeiro" (a sector/role) as a
 * required approver in two brackets, which this system's `ManagementLevel`-only resolver can't
 * express yet (mixing hierarchy-based and role-based approvers in one workflow isn't supported —
 * same limitation as the parallel-approval increment). Mapped instead onto the 5 available
 * management levels, monotonically increasing with value:
 *   até R$ 1.000,00            -> [supervisor]
 *   R$ 1.000,01 a 10.000,00    -> [supervisor, coordenador]
 *   R$ 10.000,01 a 50.000,00   -> [coordenador, gerente]
 *   R$ 50.000,01 a 100.000,00  -> [gerente, diretor]
 *   acima de R$ 100.000,00     -> [diretor]
 * Revisit once role-based approvers (Financeiro, Jurídico, etc. as a step, not a hierarchy
 * level) are supported.
 *
 * Global rules (sector_id = null) — safe to add sector-specific overrides later via the API,
 * which take precedence over these for requests in that sector.
 *
 * Idempotent-ish: only runs if there are zero global rules yet (doesn't try to diff/update).
 * Run with: npm run seed:approval-authority-matrix
 */
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { ApprovalAuthorityRulesService } from '../dist/approval-authority-rules/approval-authority-rules.service.js';
import { RequestCategoriesService } from '../dist/request-categories/request-categories.service.js';
import type { ManagementLevel } from '@prisma/client';

const prisma = new PrismaService();
const rulesService = new ApprovalAuthorityRulesService(prisma);
const requestCategoriesService = new RequestCategoriesService(prisma);

const DEMO_CATEGORY_CODE = 'DEMO-ALCADA';

const MATRIX: Array<{ minValue: string; maxValue?: string; levels: ManagementLevel[] }> = [
  { minValue: '0', maxValue: '1000.00', levels: ['supervisor'] },
  { minValue: '1000.01', maxValue: '10000.00', levels: ['supervisor', 'coordenador'] },
  { minValue: '10000.01', maxValue: '50000.00', levels: ['coordenador', 'gerente'] },
  { minValue: '50000.01', maxValue: '100000.00', levels: ['gerente', 'diretor'] },
  { minValue: '100000.01', levels: ['diretor'] },
];

async function main() {
  const existingGlobal = await prisma.approvalAuthorityRule.count({ where: { sectorId: null } });
  if (existingGlobal > 0) {
    console.log(`Já existem ${existingGlobal} regra(s) global(is) de alçada — nada a fazer (edite via API se precisar ajustar).`);
    return;
  }

  for (const rule of MATRIX) {
    await rulesService.create({ minValue: rule.minValue, maxValue: rule.maxValue, levels: rule.levels });
    console.log(`  criada: R$ ${rule.minValue} - ${rule.maxValue ?? '∞'} -> ${rule.levels.join(' + ')}`);
  }
  console.log('Matriz de alçada global padrão criada.');

  const existingDemo = await prisma.requestCategory.findUnique({ where: { code: DEMO_CATEGORY_CODE } });
  if (existingDemo) {
    console.log(`Categoria demo "${DEMO_CATEGORY_CODE}" já existe — nada a fazer.`);
    return;
  }
  const sector = await prisma.sector.findFirst({ where: { name: 'Financeiro' } });
  if (!sector) {
    console.log('Setor "Financeiro" não encontrado — rode "npm run seed:org" primeiro. Pulando categoria demo.');
    return;
  }
  await requestCategoriesService.create(
    {
      code: DEMO_CATEGORY_CODE,
      name: '[QA] Alçada dinâmica por valor',
      sectorId: sector.id,
      useDynamicAuthority: true,
      formSchema: [{ key: 'descricao', label: 'Descrição', type: 'textarea', required: true }],
      workflowSchema: [], // ignorado — a cadeia vem da matriz (ApprovalAuthorityRule), não daqui
      slaFirstResponseMinutes: 240,
      slaResolutionMinutes: 2880,
    },
    null,
  );
  console.log(`Categoria demo "${DEMO_CATEGORY_CODE}" criada (setor Financeiro, useDynamicAuthority=true).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
