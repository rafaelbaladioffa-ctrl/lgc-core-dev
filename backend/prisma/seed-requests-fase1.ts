/**
 * Seeds the Fase 1 request-category catalog (REQUISICOES_SPEC.md §7/§23) for the 5 sectors
 * prioritized in this phase: TI, Financeiro, Suprimentos (+ Almoxarifado e Patrimônio, Frota),
 * RH + DP, Administração. A representative subset of each sector's catalog (§7), not the full
 * list — the remaining categories and the other 12 sectors are Fase 2/3 (§23), added later as
 * data (new RequestCategory/CategoryVersion rows), with no migration needed.
 *
 * Idempotent (code-based, skips anything that already exists) — safe to re-run.
 * Requires `npm run seed:org` to have run first (every sector below must already exist) and
 * `npm run prisma:seed` for the queue-less default to still work (categories don't need a queue
 * to exist; RequestsService.create finds the sector's first Queue, or none).
 *
 * Run with: npm run seed:requests-fase1
 */
// Imports from `dist/`, not `src/` — same reasoning as seed-org.ts (production image only ships
// compiled output).
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { RequestCategoriesService } from '../dist/request-categories/request-categories.service.js';

const prisma = new PrismaService();
const requestCategoriesService = new RequestCategoriesService(prisma);

type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'attachment';
interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  optionsSource?: 'projects' | 'collaborators' | 'clients' | 'cost_centers' | 'job_titles';
}

type WorkflowStep = { stepOrder: 1; approverRule: 'gestor_direto' } | { stepOrder: number; approverRule: 'management_level'; requiredLevel: 'supervisor' | 'coordenador' | 'gerente' | 'diretor' };

const GESTOR_DIRETO: WorkflowStep[] = [{ stepOrder: 1, approverRule: 'gestor_direto' }];
const CADEIA_CUSTO: WorkflowStep[] = [
  { stepOrder: 1, approverRule: 'management_level', requiredLevel: 'supervisor' },
  { stepOrder: 2, approverRule: 'management_level', requiredLevel: 'coordenador' },
  { stepOrder: 3, approverRule: 'management_level', requiredLevel: 'gerente' },
  { stepOrder: 4, approverRule: 'management_level', requiredLevel: 'diretor' },
];

const DEFAULT_SLA_FIRST_RESPONSE_MINUTES = 240; // 4h
const DEFAULT_SLA_RESOLUTION_MINUTES = 2880; // 2 dias úteis (aprox.)

interface CategorySeed {
  code: string;
  name: string;
  sectorName: string;
  confidentiality?: 'interna' | 'confidencial' | 'restrita';
  // §15.2/§11: entrega/mudança/serviço exige aceite do solicitante antes de encerrar.
  requiresAcceptance?: boolean;
  workflow: WorkflowStep[];
  fields: FieldDef[];
}

// Subconjunto representativo do catálogo completo (REQUISICOES_SPEC.md §7.16/7.12/7.13/7.14/
// 7.15/7.9/7.10/7.17) — 2 a 3 categorias por setor priorizado nesta fase.
const CATEGORIES: CategorySeed[] = [
  // TI — 900 (§7.16)
  {
    code: 'TI-ACESSO',
    name: 'Acesso a sistema/perfil',
    sectorName: 'TI',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'sistema', label: 'Sistema', type: 'select', required: true, options: ['Axis', 'E-mail', 'VPN', 'Outro'] },
      { key: 'perfil', label: 'Perfil/nível de acesso', type: 'text', required: true },
      { key: 'motivo', label: 'Motivo', type: 'textarea', required: true },
    ],
  },
  {
    code: 'TI-SUPORTE',
    name: 'Incidente/suporte',
    sectorName: 'TI',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'servico', label: 'Serviço/equipamento com erro', type: 'text', required: true },
      { key: 'descricao_problema', label: 'Descrição do problema', type: 'textarea', required: true },
      { key: 'urgencia', label: 'Urgência', type: 'select', required: true, options: ['Normal', 'Urgente', 'Crítica'] },
    ],
  },
  {
    code: 'TI-EQUIPAMENTO',
    name: 'Equipamento/periférico',
    sectorName: 'TI',
    workflow: CADEIA_CUSTO,
    fields: [
      { key: 'tipo_equipamento', label: 'Tipo de equipamento', type: 'select', required: true, options: ['Notebook', 'Monitor', 'Periférico', 'Celular', 'Outro'] },
      { key: 'justificativa', label: 'Justificativa', type: 'textarea', required: true },
      { key: 'valor_estimado', label: 'Valor estimado (R$)', type: 'number' },
    ],
  },
  // Financeiro — 700 (§7.12)
  {
    code: 'FIN-REEMBOLSO',
    name: 'Reembolso',
    sectorName: 'Financeiro',
    confidentiality: 'confidencial',
    workflow: CADEIA_CUSTO,
    fields: [
      { key: 'tipo_despesa', label: 'Tipo de despesa', type: 'select', required: true, options: ['Viagem', 'Combustível', 'Material', 'Outro'] },
      { key: 'valor', label: 'Valor (R$)', type: 'number', required: true },
      { key: 'anexo_comprovante', label: 'Comprovante', type: 'attachment', required: true },
    ],
  },
  {
    code: 'FIN-ADIANTAMENTO',
    name: 'Adiantamento',
    sectorName: 'Financeiro',
    confidentiality: 'confidencial',
    workflow: CADEIA_CUSTO,
    fields: [
      { key: 'finalidade', label: 'Finalidade', type: 'textarea', required: true },
      { key: 'valor', label: 'Valor (R$)', type: 'number', required: true },
      { key: 'periodo', label: 'Período de prestação de contas', type: 'date' },
    ],
  },
  // Suprimentos — 800 (§7.13) + Almoxarifado (§7.14) + Frota (§7.15)
  {
    code: 'SUP-COMPRA',
    name: 'Compra de material',
    sectorName: 'Suprimentos',
    workflow: CADEIA_CUSTO,
    fields: [
      { key: 'itens', label: 'Itens/especificação', type: 'textarea', required: true },
      { key: 'quantidade', label: 'Quantidade', type: 'number', required: true },
      { key: 'valor_estimado', label: 'Valor estimado (R$)', type: 'number', required: true },
    ],
  },
  {
    code: 'ALM-MATERIAL',
    name: 'Requisição de material em estoque',
    sectorName: 'Almoxarifado e Patrimônio',
    requiresAcceptance: true,
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'item', label: 'Item', type: 'text', required: true },
      { key: 'quantidade', label: 'Quantidade', type: 'number', required: true },
      { key: 'centro_custo', label: 'Centro de custo', type: 'select', optionsSource: 'cost_centers' },
    ],
  },
  {
    code: 'FRT-RESERVA',
    name: 'Reserva de veículo',
    sectorName: 'Frota',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'destino', label: 'Destino', type: 'text', required: true },
      { key: 'data_inicio', label: 'Data início', type: 'date', required: true },
      { key: 'data_fim', label: 'Data fim', type: 'date', required: true },
    ],
  },
  // RH — 500 (§7.9) + DP — 500.1 (§7.10)
  {
    code: 'RH-VAGA',
    name: 'Requisição de vaga',
    sectorName: 'RH',
    confidentiality: 'confidencial',
    workflow: CADEIA_CUSTO,
    fields: [
      { key: 'cargo', label: 'Cargo', type: 'select', optionsSource: 'job_titles', required: true },
      { key: 'motivo', label: 'Motivo', type: 'textarea', required: true },
      { key: 'quantidade', label: 'Quantidade', type: 'number', required: true },
    ],
  },
  {
    code: 'DP-FERIAS',
    name: 'Férias',
    sectorName: 'DP',
    confidentiality: 'confidencial',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'colaborador', label: 'Colaborador', type: 'select', optionsSource: 'collaborators', required: true },
      { key: 'data_inicio', label: 'Data início', type: 'date', required: true },
      { key: 'data_fim', label: 'Data fim', type: 'date', required: true },
    ],
  },
  {
    code: 'DP-ATESTADO',
    name: 'Afastamento/atestado',
    sectorName: 'DP',
    confidentiality: 'restrita',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'tipo', label: 'Tipo', type: 'select', required: true, options: ['Atestado médico', 'Licença', 'Outro'] },
      { key: 'data_inicio', label: 'Data início', type: 'date', required: true },
      { key: 'data_fim', label: 'Data fim', type: 'date', required: true },
      { key: 'anexo_documento', label: 'Documento', type: 'attachment', required: true },
    ],
  },
  // Administração — ADM (§7.17)
  {
    code: 'ADM-VIAGEM',
    name: 'Viagem/hospedagem',
    sectorName: 'Administração',
    workflow: CADEIA_CUSTO,
    fields: [
      { key: 'destino', label: 'Destino', type: 'text', required: true },
      { key: 'data_inicio', label: 'Data início', type: 'date', required: true },
      { key: 'data_fim', label: 'Data fim', type: 'date', required: true },
      { key: 'objetivo', label: 'Objetivo', type: 'textarea', required: true },
    ],
  },
  {
    code: 'ADM-SALA',
    name: 'Sala/evento/reunião',
    sectorName: 'Administração',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'data', label: 'Data', type: 'date', required: true },
      { key: 'participantes', label: 'Número de participantes', type: 'number' },
      { key: 'recursos', label: 'Recursos necessários', type: 'textarea' },
    ],
  },
];

async function main() {
  console.log('Seeding Fase 1 request categories (REQUISICOES_SPEC.md §7/§23)...');
  let created = 0;

  for (const seed of CATEGORIES) {
    const existing = await prisma.requestCategory.findUnique({ where: { code: seed.code } });
    if (existing) {
      // requiresAcceptance foi adicionado depois de uma execução anterior deste seed — corrige
      // em categorias já existentes também, não só nas novas.
      if (existing.requiresAcceptance !== (seed.requiresAcceptance ?? false)) {
        await prisma.requestCategory.update({ where: { id: existing.id }, data: { requiresAcceptance: seed.requiresAcceptance ?? false } });
        console.log(`  atualizada (requires_acceptance): ${seed.code} — ${seed.name}`);
      } else {
        console.log(`  já existe: ${seed.code} — ${seed.name}`);
      }
      continue;
    }
    const sector = await prisma.sector.findFirst({ where: { name: seed.sectorName } });
    if (!sector) {
      throw new Error(`Setor "${seed.sectorName}" não encontrado — rode "npm run seed:org" primeiro.`);
    }
    await requestCategoriesService.create(
      {
        code: seed.code,
        name: seed.name,
        sectorId: sector.id,
        confidentiality: seed.confidentiality,
        requiresAcceptance: seed.requiresAcceptance,
        formSchema: seed.fields,
        workflowSchema: seed.workflow,
        slaFirstResponseMinutes: DEFAULT_SLA_FIRST_RESPONSE_MINUTES,
        slaResolutionMinutes: DEFAULT_SLA_RESOLUTION_MINUTES,
      },
      null,
    );
    created++;
    console.log(`  criada: ${seed.code} — ${seed.sectorName} / ${seed.name}`);
  }

  console.log(`Concluído. ${created} categoria(s) criada(s) nesta execução — o restante já existia.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
