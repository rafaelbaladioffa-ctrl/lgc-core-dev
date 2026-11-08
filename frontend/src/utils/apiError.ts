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
