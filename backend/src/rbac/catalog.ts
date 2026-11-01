/** Catálogo de permissões e perfis de Logística (PLANNING_LOGISTICA.md seção 6). Fonte do seed. */

export const PERMISSIONS: Record<string, string> = {
  'material:read': 'Consultar catálogo de materiais',
  'material:write': 'Criar e alterar materiais (gera versão)',
  'material:read_cost': 'Ver custo médio e último custo',
  'warehouse:read': 'Consultar almoxarifados e endereços',
  'warehouse:write': 'Administrar almoxarifados e endereços',
  'warehouse:access_all': 'Acessar todos os almoxarifados sem escopo explícito',
  'uom:read': 'Consultar unidades de medida',
  'uom:write': 'Administrar unidades de medida e conversões',
  'stock:read': 'Consultar saldos e movimentações',
  'stock:post': 'Lançar entradas, saídas e transferências no ledger',
  'stock:adjust': 'Lançar ajustes, perdas e descartes (exige aprovação Axis)',
  'stock:reverse': 'Estornar movimentos (movimento reverso vinculado)',
  'lot:write': 'Cadastrar lotes',
  'lot:block': 'Bloquear, colocar em quarentena e liberar lotes',
  'serial:write': 'Cadastrar números de série e patrimônio',
  'fulfillment:read': 'Acompanhar as próprias ordens de atendimento',
  'fulfillment:read_all': 'Ver todas as ordens de atendimento',
  'fulfillment:create': 'Criar ordens de atendimento (integração Axis)',
  'fulfillment:manage': 'Reservar, reanalisar e cancelar ordens de atendimento',
  'transfer:request': 'Solicitar e executar transferências',
  'transfer:approve': 'Aprovar transferências e usar o fluxo urgente',
  'return:execute': 'Receber e classificar devoluções',
  'label:print': 'Imprimir e reimprimir etiquetas',
  'document:read': 'Emitir documentos operacionais',
  'receipt:execute': 'Receber e armazenar materiais',
  'picking:execute': 'Separar, conferir e entregar',
  'shipment:execute': 'Criar volumes, romaneios e expedições',
  'inspection:execute': 'Inspecionar, bloquear e liberar lotes',
  'custody:execute': 'Etiquetar, custodiar e transferir ativos',
  'stockcount:manage': 'Supervisionar inventários',
  'adjustment:request': 'Solicitar ajustes, baixas e perdas (aprovação no Axis)',
  'purchasing:read': 'Consultar consumo, faltas e reposição',
  'audit:read': 'Ler trilha de auditoria',
  'rbac:read': 'Consultar perfis e mapeamentos de acesso',
  'rbac:write': 'Alterar mapeamento de perfis e escopo por almoxarifado',
  'integration:configure': 'Configurar integrações (sem acesso a operações restritas)',
};

const BASE_READ = ['material:read', 'warehouse:read', 'uom:read', 'stock:read'];

export const ROLES: Array<{ code: string; name: string; description: string; permissions: string[] }> = [
  { code: 'SOLICITANTE', name: 'Solicitante Axis', description: 'Consulta catálogo/disponibilidade permitida', permissions: ['material:read', 'uom:read', 'stock:read', 'fulfillment:read'] },
  { code: 'ALMOXARIFE', name: 'Almoxarife', description: 'Recebe, armazena, separa, confere, entrega e registra devolução', permissions: [...BASE_READ, 'receipt:execute', 'picking:execute', 'adjustment:request', 'stock:post', 'lot:write', 'serial:write', 'fulfillment:read', 'fulfillment:read_all', 'fulfillment:manage', 'shipment:execute', 'transfer:request', 'return:execute', 'label:print', 'document:read'] },
  { code: 'CONFERENTE', name: 'Conferente', description: 'Valida entrada/saída de forma independente', permissions: [...BASE_READ, 'picking:execute'] },
  { code: 'GESTOR_ALMOXARIFADO', name: 'Gestor de almoxarifado', description: 'Distribui tarefas, desbloqueia exceções e supervisiona inventários', permissions: [...BASE_READ, 'warehouse:write', 'warehouse:access_all', 'material:read_cost', 'receipt:execute', 'picking:execute', 'stockcount:manage', 'adjustment:request', 'audit:read', 'stock:post', 'stock:adjust', 'stock:reverse', 'lot:write', 'serial:write', 'fulfillment:read', 'fulfillment:read_all', 'fulfillment:manage', 'fulfillment:create', 'shipment:execute', 'transfer:request', 'transfer:approve', 'return:execute', 'label:print', 'document:read', 'custody:execute'] },
  { code: 'LOGISTICA_EXPEDICAO', name: 'Logística/Expedição', description: 'Volumes, romaneios, cargas, rotas e comprovantes', permissions: [...BASE_READ, 'shipment:execute', 'fulfillment:read', 'fulfillment:read_all', 'label:print', 'document:read'] },
  { code: 'CONTROLE_PATRIMONIO', name: 'Controle de patrimônio', description: 'Etiqueta, transfere, custodia e baixa ativos', permissions: [...BASE_READ, 'custody:execute', 'adjustment:request', 'serial:write', 'return:execute', 'label:print', 'document:read'] },
  { code: 'HSE_QUALIDADE', name: 'HSE/Qualidade', description: 'Inspeciona, bloqueia/libera lotes e consulta certificados', permissions: [...BASE_READ, 'inspection:execute', 'lot:block', 'return:execute', 'document:read'] },
  { code: 'COMPRAS', name: 'Compras', description: 'Consulta consumo, falta, reposição e recebimento', permissions: [...BASE_READ, 'purchasing:read', 'material:read_cost', 'fulfillment:read', 'fulfillment:read_all'] },
  { code: 'AUDITOR', name: 'Auditor', description: 'Leitura de documentos, movimentos e trilha, sem alteração', permissions: [...BASE_READ, 'material:read_cost', 'audit:read', 'rbac:read', 'warehouse:access_all', 'fulfillment:read', 'fulfillment:read_all', 'document:read'] },
  { code: 'ADMIN_CATALOGO', name: 'Administrador de catálogo', description: 'Mantém materiais e parâmetros', permissions: [...BASE_READ, 'material:write', 'material:read_cost', 'uom:write'] },
  // Administrador técnico: integrações e RBAC, sem acesso automático a operações restritas (seção 6).
  { code: 'ADMIN_TECNICO', name: 'Administrador técnico', description: 'Configura integrações e acessos', permissions: ['uom:read', 'rbac:read', 'rbac:write', 'integration:configure', 'audit:read', 'fulfillment:create'] },
];

/** Mapeamento inicial das roles do Axis (seed do core) → perfis de Logística; editável depois no banco. */
export const DEFAULT_AXIS_ROLE_MAP: Record<string, string[]> = {
  admin: ['ADMIN_TECNICO', 'ADMIN_CATALOGO'],
  gestor: ['GESTOR_ALMOXARIFADO'],
  tecnico: ['ALMOXARIFE'],
  colaborador: ['SOLICITANTE'],
  rh: [],
};
