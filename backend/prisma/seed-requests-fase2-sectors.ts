/**
 * Seeds the Fase 2 request-category catalog (REQUISICOES_SPEC.md §23 item 10) for the 5 new
 * sectors: Jurídico (§7.2), Compliance (§7.3), Operações (§7.7), Qualidade (§7.8), HSE/SST
 * (§7.11). A representative subset per sector, same convention as seed-requests-fase1.ts.
 *
 * Denúncia/relato ético (§7.3) is seeded `confidentiality: 'restrita'` and marked
 * `anonimato: true` in its own form field — true anonymity (no requester attribution at all) and
 * "denunciado/cadeia conflitante nunca entram na triagem" (beyond the generic requester/
 * beneficiary conflict-of-interest check already in RequestsService) are NOT implemented yet:
 * the category still requires a logged-in requester like every other, and the form has no
 * structured "denunciado" field the backend could use to exclude anyone beyond the usual
 * requester/beneficiary check. Flagged in the hand-off note as an open gap for this sensitive
 * category, not silently assumed solved.
 *
 * Idempotent (code-based). Requires `npm run seed:org` first.
 * Run with: npm run seed:requests-fase2-sectors
 */
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
  optionsSource?: 'collaborators';
}

type WorkflowStep = { stepOrder: 1; approverRule: 'gestor_direto' } | { stepOrder: number; approverRule: 'management_level'; requiredLevel: 'supervisor' | 'coordenador' | 'gerente' | 'diretor' };

const GESTOR_DIRETO: WorkflowStep[] = [{ stepOrder: 1, approverRule: 'gestor_direto' }];
const CADEIA_CUSTO: WorkflowStep[] = [
  { stepOrder: 1, approverRule: 'management_level', requiredLevel: 'supervisor' },
  { stepOrder: 2, approverRule: 'management_level', requiredLevel: 'coordenador' },
  { stepOrder: 3, approverRule: 'management_level', requiredLevel: 'gerente' },
  { stepOrder: 4, approverRule: 'management_level', requiredLevel: 'diretor' },
];

const DEFAULT_SLA_FIRST_RESPONSE_MINUTES = 240;
const DEFAULT_SLA_RESOLUTION_MINUTES = 2880;

interface CategorySeed {
  code: string;
  name: string;
  sectorName: string;
  confidentiality?: 'interna' | 'confidencial' | 'restrita';
  workflow: WorkflowStep[];
  fields: FieldDef[];
}

const CATEGORIES: CategorySeed[] = [
  // Jurídico — §7.2
  {
    code: 'JUR-CONTRATO',
    name: 'Elaboração/revisão de contrato',
    sectorName: 'Jurídico',
    confidentiality: 'confidencial',
    workflow: CADEIA_CUSTO,
    fields: [
      { key: 'tipo', label: 'Tipo de contrato', type: 'text', required: true },
      { key: 'partes', label: 'Partes/CNPJ', type: 'text', required: true },
      { key: 'valor', label: 'Valor (R$)', type: 'number' },
      { key: 'minuta', label: 'Minuta', type: 'attachment' },
    ],
  },
  {
    code: 'JUR-PARECER',
    name: 'Parecer jurídico',
    sectorName: 'Jurídico',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'pergunta', label: 'Pergunta objetiva', type: 'textarea', required: true },
      { key: 'fatos', label: 'Fatos relevantes', type: 'textarea', required: true },
    ],
  },
  {
    code: 'JUR-CONTENCIOSO',
    name: 'Contencioso/notificação',
    sectorName: 'Jurídico',
    confidentiality: 'confidencial',
    workflow: CADEIA_CUSTO,
    fields: [
      { key: 'processo', label: 'Processo/notificação', type: 'text', required: true },
      { key: 'prazo_fatal', label: 'Prazo fatal', type: 'date', required: true },
      { key: 'valor', label: 'Valor envolvido (R$)', type: 'number' },
    ],
  },
  // Compliance — §7.3
  {
    code: 'CMP-DUEDILIGENCE',
    name: 'Due diligence de terceiro',
    sectorName: 'Compliance',
    confidentiality: 'confidencial',
    workflow: CADEIA_CUSTO,
    fields: [
      { key: 'terceiro', label: 'Terceiro/CNPJ', type: 'text', required: true },
      { key: 'servico', label: 'Serviço', type: 'text', required: true },
      { key: 'valor', label: 'Valor (R$)', type: 'number' },
    ],
  },
  {
    code: 'CMP-DENUNCIA',
    name: 'Denúncia/relato ético',
    sectorName: 'Compliance',
    confidentiality: 'restrita',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'canal', label: 'Canal', type: 'select', options: ['Presencial', 'E-mail', 'Formulário anônimo'], required: true },
      { key: 'relato', label: 'Relato', type: 'textarea', required: true },
      { key: 'local_data', label: 'Local/data do(s) fato(s)', type: 'text' },
      // Usado por RequestsService.whistleblowerExclusions pra excluir o denunciado e toda a
      // cadeia de supervisor_id dele da triagem/aprovação desta requisição (REQUISICOES_SPEC.md
      // §7.3, escopo definido pela sessão de planejamento).
      { key: 'envolvido_id', label: 'Principal envolvido/denunciado', type: 'select', optionsSource: 'collaborators', required: true },
      // Lido por RequestsService.create — true marca `requests.anonymous`, que oculta o
      // requesterId real de todo participante sem a permissão request:view_whistleblower_identity.
      { key: 'anonimo', label: 'Enviar como anônimo', type: 'checkbox' },
      { key: 'evidencias', label: 'Evidências', type: 'attachment' },
    ],
  },
  {
    code: 'CMP-LGPD',
    name: 'LGPD/dados pessoais',
    sectorName: 'Compliance',
    confidentiality: 'restrita',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'titular', label: 'Titular dos dados', type: 'text', required: true },
      { key: 'tipo', label: 'Tipo', type: 'select', options: ['Incidente', 'Solicitação do titular'], required: true },
      { key: 'descricao', label: 'Descrição', type: 'textarea', required: true },
    ],
  },
  // Operações — §7.7
  {
    code: 'OPS-MOBILIZACAO',
    name: 'Mobilização/desmobilização',
    sectorName: 'Operações',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'local', label: 'Local', type: 'text', required: true },
      { key: 'data_inicio', label: 'Data início', type: 'date', required: true },
      { key: 'data_fim', label: 'Data fim', type: 'date' },
    ],
  },
  {
    code: 'OPS-OCORRENCIA',
    name: 'Ocorrência operacional',
    sectorName: 'Operações',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'local', label: 'Local', type: 'text', required: true },
      { key: 'evento', label: 'Evento', type: 'textarea', required: true },
      { key: 'acao_imediata', label: 'Ação imediata', type: 'textarea' },
      { key: 'evidencias', label: 'Evidências', type: 'attachment' },
    ],
  },
  {
    code: 'OPS-PARALISACAO',
    name: 'Paralisação/retomada',
    sectorName: 'Operações',
    confidentiality: 'confidencial',
    workflow: CADEIA_CUSTO,
    fields: [
      { key: 'motivo', label: 'Motivo', type: 'textarea', required: true },
      { key: 'risco', label: 'Risco', type: 'select', options: ['Baixo', 'Médio', 'Alto'], required: true },
    ],
  },
  // Qualidade — §7.8
  {
    code: 'QUA-RNC',
    name: 'Não conformidade (RNC)',
    sectorName: 'Qualidade',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'origem', label: 'Origem', type: 'text', required: true },
      { key: 'evidencia', label: 'Evidência', type: 'attachment' },
      { key: 'severidade', label: 'Severidade', type: 'select', options: ['Baixa', 'Média', 'Alta'], required: true },
    ],
  },
  {
    code: 'QUA-ACAO',
    name: 'Ação corretiva/preventiva',
    sectorName: 'Qualidade',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'causa_raiz', label: 'Causa raiz', type: 'textarea', required: true },
      { key: 'acao', label: 'Ação proposta', type: 'textarea', required: true },
      { key: 'prazo', label: 'Prazo', type: 'date', required: true },
    ],
  },
  // HSE/SST — §7.11
  {
    code: 'HSE-INCIDENTE',
    name: 'Incidente/acidente/quase acidente',
    sectorName: 'HSE/SST',
    confidentiality: 'confidencial',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'data_hora', label: 'Data/hora', type: 'date', required: true },
      { key: 'local', label: 'Local', type: 'text', required: true },
      { key: 'descricao', label: 'Descrição', type: 'textarea', required: true },
      { key: 'lesao', label: 'Houve lesão?', type: 'checkbox' },
      { key: 'evidencias', label: 'Evidências', type: 'attachment' },
    ],
  },
  {
    code: 'HSE-EPI',
    name: 'EPI/EPC',
    sectorName: 'HSE/SST',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'item', label: 'Item', type: 'text', required: true },
      { key: 'quantidade', label: 'Quantidade', type: 'number', required: true },
      { key: 'motivo', label: 'Motivo', type: 'select', options: ['Primeira entrega', 'Desgaste', 'Perda', 'Troca de tamanho'] },
    ],
  },
  {
    code: 'HSE-CONDICAOINSEGURA',
    name: 'Inspeção/condição insegura',
    sectorName: 'HSE/SST',
    workflow: GESTOR_DIRETO,
    fields: [
      { key: 'local', label: 'Local', type: 'text', required: true },
      { key: 'risco', label: 'Risco observado', type: 'textarea', required: true },
      { key: 'fotos', label: 'Fotos', type: 'attachment' },
    ],
  },
];

async function main() {
  console.log('Seeding Fase 2 request categories — Jurídico, Compliance, Operações, Qualidade, HSE/SST (REQUISICOES_SPEC.md §7/§23)...');
  let created = 0;

  for (const seed of CATEGORIES) {
    const existing = await prisma.requestCategory.findUnique({ where: { code: seed.code } });
    if (existing) {
      // CMP-DENUNCIA pode já ter sido seedada numa execução anterior sem os campos
      // envolvido_id/anonimo (adicionados depois, pelo escopo de anonimato) — corrige o
      // form_schema da versão mais recente em vez de deixar categorias antigas defasadas.
      if (seed.code === 'CMP-DENUNCIA') {
        const latestVersion = await prisma.categoryVersion.findFirst({ where: { categoryId: existing.id }, orderBy: { version: 'desc' } });
        if (latestVersion) {
          await prisma.categoryVersion.update({ where: { id: latestVersion.id }, data: { formSchema: seed.fields } });
          console.log(`  atualizada (form_schema): ${seed.code} — ${seed.name}`);
        }
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
