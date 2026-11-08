/** Catálogo de permissões e perfis de Logística (PLANNING_LOGISTICA.md seção 6). Fonte do seed. */

export const PERMISSIONS: Record<string, string> = {
  'material:read': 'Consultar catálogo de materiais',
  'material:write': 'Criar e alterar materiais (gera versão)',
  'material:set_code': 'Informar o código do material manualmente (importação/migração; o normal é gerar automaticamente)',
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
  'policy:write': 'Definir mínimo, máximo e segurança de reposição',
  'replenishment:manage': 'Calcular, enviar e descartar sugestões de reposição',
  'alert:read': 'Ver alertas operacionais',
  'alert:manage': 'Reconhecer alertas e executar a varredura',
  'dashboard:read': 'Ver indicadores e dashboard',
  'reconciliation:manage': 'Executar e tratar a reconciliação',
  'receipt:execute': 'Receber e armazenar materiais',
  'picking:execute': 'Separar, conferir e entregar',
  'shipment:execute': 'Criar volumes, romaneios e expedições',
  'inspection:execute': 'Inspecionar, bloquear e liberar lotes',
  'custody:execute': 'Etiquetar, custodiar e transferir ativos',
  'stockcount:count': 'Realizar contagens de inventário',
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
  { code: 'ALMOXARIFE', name: 'Almoxarife', description: 'Recebe, armazena, separa, confere, entrega e registra devolução', permissions: [...BASE_READ, 'receipt:execute', 'picking:execute', 'adjustment:request', 'stockcount:count', 'stock:post', 'lot:write', 'serial:write', 'fulfillment:read', 'fulfillment:read_all', 'fulfillment:manage', 'shipment:execute', 'transfer:request', 'return:execute', 'label:print', 'document:read', 'alert:read'] },
  { code: 'CONFERENTE', name: 'Conferente', description: 'Valida entrada/saída de forma independente', permissions: [...BASE_READ, 'picking:execute', 'stockcount:count'] },
  { code: 'GESTOR_ALMOXARIFADO', name: 'Gestor de almoxarifado', description: 'Distribui tarefas, desbloqueia exceções e supervisiona inventários', permissions: [...BASE_READ, 'warehouse:write', 'warehouse:access_all', 'material:read_cost', 'receipt:execute', 'picking:execute', 'stockcount:manage', 'stockcount:count', 'adjustment:request', 'audit:read', 'document:read', 'stock:post', 'stock:adjust', 'stock:reverse', 'lot:write', 'serial:write', 'fulfillment:read', 'fulfillment:read_all', 'fulfillment:manage', 'fulfillment:create', 'shipment:execute', 'transfer:request', 'transfer:approve', 'return:execute', 'label:print', 'document:read', 'custody:execute', 'policy:write', 'replenishment:manage', 'alert:read', 'alert:manage', 'dashboard:read', 'purchasing:read', 'reconciliation:manage'] },
  { code: 'LOGISTICA_EXPEDICAO', name: 'Logística/Expedição', description: 'Volumes, romaneios, cargas, rotas e comprovantes', permissions: [...BASE_READ, 'shipment:execute', 'fulfillment:read', 'fulfillment:read_all', 'label:print', 'document:read'] },
  { code: 'CONTROLE_PATRIMONIO', name: 'Controle de patrimônio', description: 'Etiqueta, transfere, custodia e baixa ativos', permissions: [...BASE_READ, 'custody:execute', 'adjustment:request', 'serial:write', 'return:execute', 'label:print', 'document:read', 'alert:read'] },
  { code: 'HSE_QUALIDADE', name: 'HSE/Qualidade', description: 'Inspeciona, bloqueia/libera lotes e consulta certificados', permissions: [...BASE_READ, 'inspection:execute', 'lot:block', 'return:execute', 'document:read', 'alert:read'] },
  { code: 'COMPRAS', name: 'Compras', description: 'Consulta consumo, falta, reposição e recebimento', permissions: [...BASE_READ, 'purchasing:read', 'material:read_cost', 'fulfillment:read', 'fulfillment:read_all', 'replenishment:manage', 'alert:read', 'dashboard:read'] },
  { code: 'AUDITOR', name: 'Auditor', description: 'Leitura de documentos, movimentos e trilha, sem alteração', permissions: [...BASE_READ, 'material:read_cost', 'audit:read', 'rbac:read', 'warehouse:access_all', 'fulfillment:read', 'fulfillment:read_all', 'document:read', 'alert:read', 'dashboard:read', 'purchasing:read'] },
  { code: 'ADMIN_CATALOGO', name: 'Administrador de catálogo', description: 'Mantém materiais, almoxarifados, endereços e parâmetros', permissions: [...BASE_READ, 'material:write', 'material:read_cost', 'uom:write', 'policy:write', 'warehouse:write'] },
  // Administrador técnico: integrações e RBAC, sem acesso automático a operações restritas (seção 6).
  // Trata as ordens que chegam da integração: cria (fulfillment:create) e completa/reserva/cancela (fulfillment:manage),
  // ex.: definir o almoxarifado de uma ordem que chegou sem ele. Separação, expedição e estoque continuam fora.
  { code: 'ADMIN_TECNICO', name: 'Administrador técnico', description: 'Configura integrações e acessos', permissions: ['material:set_code', 'uom:read', 'rbac:read', 'rbac:write', 'integration:configure', 'audit:read', 'fulfillment:create', 'fulfillment:manage', 'alert:read', 'alert:manage', 'reconciliation:manage'] },
];

/** Mapeamento inicial das roles do Axis (seed do core) → perfis de Logística; editável depois no banco. */
export const DEFAULT_AXIS_ROLE_MAP: Record<string, string[]> = {
  // AUDITOR dá ao admin do Axis leitura de toda a operação (inclusive todas as ordens de atendimento), sem alterar nada.
  admin: ['ADMIN_TECNICO', 'ADMIN_CATALOGO', 'AUDITOR'],
  gestor: ['GESTOR_ALMOXARIFADO'],
  tecnico: ['ALMOXARIFE'],
  colaborador: ['SOLICITANTE'],
  rh: [],
};
