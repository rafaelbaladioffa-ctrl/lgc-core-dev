/**
 * Catálogo único dos eventos de integração que o Core grava no outbox (`OutboxService.record`).
 * É a lista que a tela de satélite oferece para assinatura (`GET /integration/event-types`) e a que
 * a edição de assinatura aceita. Evento novo no código entra aqui no mesmo PR; o teste
 * `event-catalog.spec.ts` confere que todo `outbox.record(..., '<tipo>', ...)` do código está listado.
 * Contratos: docs/dominio/cadastros.md, docs/integracao-core-logistica.md, docs/integracao-core-financeiro.md,
 * docs/integracao-core-field.md e docs/mapa-interoperabilidade.md §6.
 */

export interface EventFamily {
  key: string;
  label: string;
}

export interface EventTypeInfo {
  type: string;
  description: string;
}

/** Famílias na ordem em que a tela mostra. A família é o prefixo do tipo (`client.created` → `client`). */
export const EVENT_FAMILIES: readonly EventFamily[] = [
  { key: 'client', label: 'Clientes' },
  { key: 'site', label: 'Sites de clientes' },
  { key: 'project', label: 'Projetos' },
  { key: 'cost_center', label: 'Centros de custo' },
  { key: 'collaborator', label: 'Colaboradores' },
  { key: 'user', label: 'Usuários' },
  { key: 'job_title', label: 'Cargos' },
  { key: 'holiday', label: 'Feriados' },
  { key: 'request', label: 'Requisições' },
  { key: 'purchase', label: 'Compras' },
  { key: 'material_request', label: 'Envio de material' },
  { key: 'finance_request', label: 'Requisições financeiras' },
  { key: 'sla', label: 'SLA de requisições' },
];

export const EVENT_TYPES: readonly EventTypeInfo[] = [
  { type: 'client.created', description: 'Cliente cadastrado' },
  { type: 'client.updated', description: 'Cliente alterado (e reenvio de cadastros)' },
  { type: 'client.deleted', description: 'Cliente excluído' },

  { type: 'site.created', description: 'Site cadastrado' },
  { type: 'site.updated', description: 'Site alterado ou inativado (e reenvio de cadastros)' },

  { type: 'project.created', description: 'Projeto cadastrado' },
  { type: 'project.updated', description: 'Projeto alterado (e reenvio de cadastros)' },
  { type: 'project.deleted', description: 'Projeto excluído' },
  { type: 'project.status_changed', description: 'Status do projeto mudou' },
  { type: 'project.approved', description: 'Projeto aprovado (cotação e SOW)' },
  { type: 'project.document_added', description: 'Documento anexado ao projeto (SOW)' },
  { type: 'project.quote_requested', description: 'Cotação do projeto pedida ao Financeiro' },

  { type: 'cost_center.created', description: 'Centro de custo cadastrado' },
  { type: 'cost_center.updated', description: 'Centro de custo alterado ou excluído (e reenvio de cadastros)' },

  { type: 'collaborator.created', description: 'Colaborador admitido' },
  { type: 'collaborator.updated', description: 'Colaborador alterado (e reenvio de cadastros)' },
  { type: 'collaborator.offboarded', description: 'Colaborador desligado' },
  { type: 'collaborator.cost_center_changed', description: 'Colaborador mudou de centro de custo' },

  { type: 'user.created', description: 'Usuário de acesso criado' },
  { type: 'user.updated', description: 'Usuário alterado: papéis ou reativação (e reenvio de cadastros)' },
  { type: 'user.disabled', description: 'Usuário desativado' },

  { type: 'job_title.created', description: 'Cargo cadastrado' },
  { type: 'job_title.updated', description: 'Cargo alterado (e reenvio de cadastros)' },
  { type: 'job_title.deleted', description: 'Cargo excluído' },

  { type: 'holiday.created', description: 'Feriado cadastrado' },
  { type: 'holiday.updated', description: 'Feriado reenviado (reenvio de cadastros)' },
  { type: 'holiday.deleted', description: 'Feriado excluído' },

  { type: 'request.submitted', description: 'Requisição enviada' },
  { type: 'request.status_changed', description: 'Status da requisição mudou' },
  { type: 'request.completed', description: 'Requisição encerrada' },

  { type: 'purchase.approved', description: 'Compra aprovada' },
  { type: 'purchase.order_registered', description: 'Pedido de compra registrado' },
  { type: 'purchase.delivery_received', description: 'Entrega da compra recebida' },
  { type: 'purchase.cancelled', description: 'Compra cancelada' },

  { type: 'material_request.approved', description: 'Envio de material aprovado' },
  { type: 'material_request.cancel_requested', description: 'Cancelamento do envio de material pedido' },

  { type: 'finance_request.approved', description: 'Requisição financeira aprovada' },

  { type: 'sla.warning', description: 'SLA perto de vencer' },
  { type: 'sla.breached', description: 'SLA vencido (reatribuída ao supervisor)' },
];

const KNOWN_TYPES = new Set(EVENT_TYPES.map((e) => e.type));

export function isKnownEventType(type: string): boolean {
  return KNOWN_TYPES.has(type);
}

export function eventFamilyOf(type: string): string {
  return type.slice(0, type.indexOf('.'));
}

/** Resposta de `GET /integration/event-types`: lista plana, com a família e o rótulo dela para agrupar na tela. */
export function eventTypeCatalog() {
  const labels = new Map(EVENT_FAMILIES.map((f) => [f.key, f.label]));
  return EVENT_TYPES.map((e) => {
    const family = eventFamilyOf(e.type);
    return { type: e.type, description: e.description, family, familyLabel: labels.get(family) ?? family };
  });
}
