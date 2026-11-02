/** Idempotent seed for P04: SUP-MATERIAIS. Run seed:org first. */
import { PrismaService } from '../dist/prisma/prisma.service.js';

const prisma = new PrismaService();

const definition = {
  format: 'axis-bpm/1',
  capabilities: ['human_tasks'],
  policy: {
    confidentiality: 'interna',
    requiresAcceptance: false,
    allowRepresentation: false,
    executorMayBeRequester: false,
    closure: { mode: 'manual' },
  },
  sla: { firstResponseMinutes: 240, resolutionMinutes: 2880 },
  form: {
    sections: [
      {
        id: 'identificacao', title: 'Identificação da Requisição', order: 1,
        fields: [
          { key: 'centro_custo', label: 'Centro de Custo', type: 'reference', source: { key: 'cost_centers' }, binding: 'request.costCenterId', required: true },
          { key: 'projeto_destino', label: 'Projeto de Destino', type: 'reference', source: { key: 'projects' }, binding: 'request.projectId' },
          { key: 'justificativa', label: 'Justificativa', type: 'textarea', required: true, maxLength: 1000 },
          { key: 'data_necessidade', label: 'Data de Necessidade', type: 'date', required: true },
        ],
      },
      {
        id: 'itens', title: 'Itens Solicitados', order: 2,
        fields: [{
          key: 'itens', label: 'Itens', type: 'repeatable_table', required: true, minRows: 1, maxRows: 50,
          writableWhen: { op: 'in', value: { path: 'context.nodeId' }, set: [{ literal: 'cc_aprovacao_inicial' }, { literal: 'suprimentos_cotacao' }] },
          columns: [
            { key: 'item_ref', label: 'Item', type: 'reference', source: { key: 'logistics.catalog' }, required: true },
            { key: 'quantidade', label: 'Qtd', type: 'decimal', min: '0.001', required: true },
            { key: 'unidade', label: 'Un.', type: 'text', maxLength: 20 },
            { key: 'preco_unitario', label: 'Preço Unit. (R$)', type: 'money' },
            { key: 'observacao', label: 'Observação', type: 'text', maxLength: 200 },
          ],
        }],
      },
      {
        id: 'cotacoes', title: 'Cotações', order: 3,
        fields: [{
          key: 'cotacoes', label: 'Cotações', type: 'repeatable_table', minRows: 1, maxRows: 10,
          visibleWhen: { op: 'in', value: { path: 'context.nodeId' }, set: ['suprimentos_cotacao', 'cc_aprova_cotacao', 'solicitante_aprova_cotacao', 'suprimentos_compra', 'solicitante_confirma_recebimento'].map((literal) => ({ literal })) },
          writableWhen: { op: 'eq', left: { path: 'context.nodeId' }, right: { literal: 'suprimentos_cotacao' } },
          columns: [
            { key: 'fornecedor_nome', label: 'Fornecedor', type: 'text', required: true, maxLength: 200 },
            { key: 'cnpj', label: 'CNPJ', type: 'text', required: true, maxLength: 18 },
            { key: 'valor_total', label: 'Valor Total (R$)', type: 'money', required: true },
            { key: 'prazo_entrega', label: 'Prazo de Entrega', type: 'text', maxLength: 100 },
            { key: 'documento', label: 'Documento (cotação)', type: 'attachment' },
          ],
        }],
      },
      {
        id: 'fornecedor_escolhido', title: 'Fornecedor Escolhido', order: 4,
        fields: [{ key: 'cotacao_escolhida_index', label: 'Número da cotação selecionada', type: 'integer', min: 1, requiredWhen: { op: 'eq', left: { path: 'context.nodeId' }, right: { literal: 'cc_aprova_cotacao' } } }],
      },
      {
        id: 'logistica_compra', title: 'Dados da Compra', order: 5,
        fields: [
          { key: 'data_previsao_recebimento', label: 'Previsão de Recebimento', type: 'date' },
          { key: 'endereco_entrega', label: 'Endereço de Entrega', type: 'textarea', maxLength: 500 },
          { key: 'recebimento_confirmado', label: 'Material recebido e conferido', type: 'boolean', mustBeTrue: true },
        ],
      },
    ],
  },
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'cc_aprovacao_inicial', type: 'human', phase: 'approval', assigneeRule: { type: 'cost_center_responsible', field: 'centro_custo' } },
    { id: 'suprimentos_cotacao', type: 'human', phase: 'execution' },
    { id: 'cc_aprova_cotacao', type: 'human', phase: 'approval', assigneeRule: { type: 'cost_center_responsible', field: 'centro_custo' } },
    { id: 'solicitante_aprova_cotacao', type: 'human', phase: 'approval', assigneeRule: { type: 'requester' } },
    { id: 'suprimentos_compra', type: 'human', phase: 'execution' },
    { id: 'solicitante_confirma_recebimento', type: 'human', phase: 'confirmation', assigneeRule: { type: 'requester' } },
    { id: 'end', type: 'end' },
  ],
  edges: [
    { from: 'start', to: 'cc_aprovacao_inicial' },
    { from: 'cc_aprovacao_inicial', to: 'suprimentos_cotacao' },
    { from: 'suprimentos_cotacao', to: 'cc_aprova_cotacao' },
    { from: 'cc_aprova_cotacao', to: 'solicitante_aprova_cotacao' },
    { from: 'solicitante_aprova_cotacao', to: 'suprimentos_compra' },
    { from: 'suprimentos_compra', to: 'solicitante_confirma_recebimento' },
    { from: 'solicitante_confirma_recebimento', to: 'end' },
  ],
};

async function main() {
  const sector = await prisma.sector.findFirst({ where: { name: 'Suprimentos' } });
  if (!sector) throw new Error('Setor Suprimentos não encontrado — rode npm run seed:org primeiro.');
  const members = await prisma.collaborator.findMany({ where: { sectorId: sector.id, status: 'ativo' }, select: { id: true } });
  let queue = await prisma.queue.findFirst({ where: { sectorId: sector.id, name: 'Suprimentos — Compras' } });
  if (!queue) queue = await prisma.queue.create({ data: { sectorId: sector.id, name: 'Suprimentos — Compras' } });
  for (const member of members)
    await prisma.requestQueueMember.upsert({ where: { queueId_collaboratorId_role: { queueId: queue.id, collaboratorId: member.id, role: 'member' } }, update: { active: true }, create: { queueId: queue.id, collaboratorId: member.id, role: 'member' } });
  for (const node of definition.nodes as Array<Record<string, unknown>>)
    if (node.id === 'suprimentos_cotacao' || node.id === 'suprimentos_compra') node.queueId = queue.id;

  const category = await prisma.requestCategory.upsert({
    where: { code: 'SUP-MATERIAIS' },
    update: { name: 'Requisição de Materiais / Compras', sectorId: sector.id },
    create: { code: 'SUP-MATERIAIS', name: 'Requisição de Materiais / Compras', sectorId: sector.id },
  });
  const version = await prisma.categoryVersion.upsert({
    where: { categoryId_version: { categoryId: category.id, version: 1 } },
    update: { bpmDefinition: definition as any, formSchema: definition.form as any, workflowSchema: [] as any, bpmStatus: 'published', publishedAt: new Date(), bpmRevision: 1 },
    create: { categoryId: category.id, version: 1, formSchema: definition.form as any, workflowSchema: [] as any, slaFirstResponseMinutes: 240, slaResolutionMinutes: 2880, bpmDefinition: definition as any, bpmStatus: 'published', publishedAt: new Date(), bpmRevision: 1 },
  });
  await prisma.requestCategory.update({ where: { id: category.id }, data: { publishedBpmVersionId: version.id, runtimeEnabled: true } });
  console.log(`SUP-MATERIAIS publicado: categoria=${category.id}, versão=${version.id}, fila=${queue.id}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
