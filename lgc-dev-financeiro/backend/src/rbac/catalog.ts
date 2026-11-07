/** Catálogo de permissões e perfis do Financeiro (especificação §3). Fonte do seed. */

export const PERMISSIONS: Record<string, string> = {
  'supplier:read': 'Consultar fornecedores (sem dados bancários)',
  'supplier:write': 'Cadastrar e alterar fornecedores',
  'supplier:read_bank': 'Ver dados bancários completos de fornecedores (leitura registrada)',
  'supplier:write_bank': 'Alterar dados bancários de fornecedores (exige confirmação de outra pessoa)',
  'bank_account:read': 'Consultar contas bancárias da empresa',
  'bank_account:write': 'Administrar contas bancárias da empresa',
  'payable:read': 'Consultar títulos a pagar',
  'payable:write': 'Lançar e corrigir títulos em rascunho',
  'payable:approve': 'Aprovar, reprovar e devolver títulos',
  'payable:cancel': 'Cancelar títulos (com motivo)',
  'payment:schedule': 'Montar e alterar programações de pagamento',
  'payment:execute': 'Registrar baixas e estornos',
  'report:read': 'Agenda de pagamentos, posição de títulos e previsão de saídas',
  'audit:read': 'Ler a trilha de auditoria',
  'rbac:read': 'Consultar perfis e mapeamentos de acesso',
  'rbac:write': 'Alterar perfis concedidos e mapeamentos de acesso',
  'integration:configure': 'Acompanhar e reprocessar a integração com o Core',
};

export interface RoleDefinition {
  code: string;
  name: string;
  description: string;
  permissions: string[];
}

export const ROLES: RoleDefinition[] = [
  {
    code: 'ANALISTA_CONTAS_PAGAR',
    name: 'Analista de contas a pagar',
    description: 'Cadastra fornecedores e lança títulos',
    permissions: ['supplier:read', 'supplier:write', 'payable:read', 'payable:write', 'bank_account:read', 'report:read'],
  },
  {
    code: 'APROVADOR_FINANCEIRO',
    name: 'Aprovador financeiro',
    description: 'Aprova, reprova e cancela títulos',
    permissions: ['supplier:read', 'payable:read', 'payable:approve', 'payable:cancel', 'report:read'],
  },
  {
    code: 'TESOURARIA',
    name: 'Tesouraria',
    description: 'Programa pagamentos e registra baixas',
    permissions: ['supplier:read', 'supplier:read_bank', 'bank_account:read', 'bank_account:write', 'payable:read', 'payment:schedule', 'payment:execute', 'report:read'],
  },
  {
    code: 'CADASTRO_BANCARIO',
    name: 'Cadastro bancário',
    description: 'Inclui e confirma dados bancários de fornecedores',
    permissions: ['supplier:read', 'supplier:read_bank', 'supplier:write_bank'],
  },
  {
    code: 'CONSULTA_FINANCEIRA',
    name: 'Consulta financeira',
    description: 'Consulta títulos e relatórios, sem alterar',
    permissions: ['supplier:read', 'payable:read', 'report:read'],
  },
  {
    code: 'AUDITOR',
    name: 'Auditor',
    description: 'Leitura de tudo e da trilha de auditoria, sem alteração',
    permissions: ['supplier:read', 'supplier:read_bank', 'bank_account:read', 'payable:read', 'report:read', 'audit:read', 'rbac:read'],
  },
  {
    // Administra acessos e integração, sem acesso automático a títulos nem a dados bancários.
    code: 'ADMIN_TECNICO',
    name: 'Administrador técnico',
    description: 'Configura acessos e integração',
    permissions: ['rbac:read', 'rbac:write', 'integration:configure', 'audit:read'],
  },
];

/**
 * Mapeamento inicial papel do Core → perfis do Financeiro. O Core não tem papel financeiro:
 * as pessoas do Financeiro recebem perfis por usuário (especificação §3.2, decisão F-03).
 */
export const DEFAULT_AXIS_ROLE_MAP: Record<string, string[]> = {
  admin: ['ADMIN_TECNICO'],
};
