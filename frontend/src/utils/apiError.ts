/**
 * The backend's own error messages (NestJS exception `message` field) are in English, matching
 * the rest of the API's wording. Rather than a full i18n layer, map the handful of messages the
 * UI surfaces directly to the user into pt-BR; anything unmapped falls back to a generic message
 * instead of showing raw English.
 */
const KNOWN_MESSAGES: Record<string, string> = {
  // Sites (já em pt-BR no servidor): o texto do servidor é o texto da tela.
  'Já existe um site com este código para o cliente.': 'Já existe um site com este código para o cliente.',
  'O site não pertence ao cliente do projeto.': 'O site não pertence ao cliente do projeto.',
  'O site está inativo. Escolha outro site ou reative este.': 'O site está inativo. Escolha outro site ou reative este.',
  'Site não encontrado.': 'Site não encontrado.',
  // Aprovação do projeto e envio de material para obra (PT-06): o texto do servidor é o texto da tela.
  'Informe o site do projeto antes de aprovar.': 'Informe o site do projeto antes de aprovar.',
  'O site do projeto está inativo. Reative o site ou escolha outro antes de aprovar.': 'O site do projeto está inativo. Reative o site ou escolha outro antes de aprovar.',
  'O projeto não tem cotação recebida do Financeiro. Solicite a cotação antes de aprovar.': 'O projeto não tem cotação recebida do Financeiro. Solicite a cotação antes de aprovar.',
  'A cotação informada não pertence ao projeto.': 'A cotação informada não pertence ao projeto.',
  'Cotação aceita e PO só valem na aprovação do projeto.': 'Cotação aceita e PO só valem na aprovação do projeto.',
  'A aprovação do projeto exige a cotação aceita e o site: use a aprovação do projeto.': 'A aprovação do projeto exige a cotação aceita e o site: use a aprovação do projeto.',
  'O envio de material não está configurado (usuário de sistema ou categoria ausentes). Aplique as migrações do Core e rode o seed.':
    'O envio de material não está configurado (usuário de sistema ou categoria ausentes). Aplique as migrações do Core e rode o seed.',
  'O envio de material para obra é criado automaticamente ao aprovar o projeto.': 'O envio de material para obra é criado automaticamente ao aprovar o projeto.',
  'No envio de material para obra, a conclusão vem da entrega confirmada pela Logística.': 'No envio de material para obra, a conclusão vem da entrega confirmada pela Logística.',
  'No envio de material para obra o solicitante é o sistema: comente na requisição em vez de pedir informação.':
    'No envio de material para obra o solicitante é o sistema: comente na requisição em vez de pedir informação.',
  'O centro de custo do projeto (e o centro de custo pai) continua sem responsável. Cadastre o responsável e tente de novo.':
    'O centro de custo do projeto (e o centro de custo pai) continua sem responsável. Cadastre o responsável e tente de novo.',
  'A requisição já tem um aprovador pendente.': 'A requisição já tem um aprovador pendente.',
  'A requisição não está aguardando aprovação.': 'A requisição não está aguardando aprovação.',
  'Esta requisição não é um envio de material para obra.': 'Esta requisição não é um envio de material para obra.',
  'Cannot delete a sector that still has linked records (collaborators, cost centers, tickets, etc.)':
    'Não é possível excluir um setor que ainda possui registros vinculados (colaboradores, centros de custo, chamados, etc.).',
  'Cannot delete a cost center that still has linked projects': 'Não é possível excluir um centro de custo que ainda possui projetos vinculados.',
  'Cannot delete a client that still has linked projects': 'Não é possível excluir um cliente que ainda possui projetos vinculados.',
  'Cannot delete a cost center that still has linked projects or sub-cost-centers':
    'Não é possível excluir um centro de custo que ainda possui projetos, sub-centros, requisições ou histórico de colaboradores vinculados.',
  'Cost center short code already in use': 'Já existe um centro de custo com esta sigla.',
  'Cost center effective date cannot be before the start of the current allocation':
    'A data de início no novo centro de custo não pode ser anterior ao início no centro de custo atual.',
  'CPF already registered': 'CPF já cadastrado.',
  // Usuários (já em pt-BR no servidor).
  'Já existe um usuário com este e-mail. Use outro e-mail ou reative o usuário existente.':
    'Já existe um usuário com este e-mail. Use outro e-mail ou reative o usuário existente.',
  'Este colaborador já tem um usuário de acesso.': 'Este colaborador já tem um usuário de acesso.',
  'A client with this CNPJ already exists': 'Já existe um cliente com este CNPJ.',
};

export function translateApiError(err: unknown, fallback: string): string {
  const message =
    err && typeof err === 'object' && 'response' in err
      ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
      : undefined;
  if (!message) return fallback;
  return KNOWN_MESSAGES[message] ?? fallback;
}

/** Mensagens do servidor (ja em pt-BR nas rotas do catalogo) como lista: o `message` do NestJS
 * pode ser texto ou lista de erros de validacao por campo. */
export function extractApiMessages(err: unknown, fallback: string): string[] {
  const response =
    err && typeof err === 'object' && 'response' in err
      ? (err as { response?: { status?: number; data?: { message?: unknown } } }).response
      : undefined;
  if (response?.status === 403) return ['Você não tem permissão para esta ação.'];
  const message = response?.data?.message;
  if (Array.isArray(message)) {
    const list = message.filter((m): m is string => typeof m === 'string' && m !== '');
    if (list.length > 0) return list;
  }
  if (typeof message === 'string' && message !== '') return [message];
  return [fallback];
}
