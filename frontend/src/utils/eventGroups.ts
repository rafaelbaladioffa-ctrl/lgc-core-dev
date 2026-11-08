import type { EventTypeInfo } from '../api/integration';

export interface EventGroup {
  key: string;
  label: string;
  events: Array<{ type: string; description: string }>;
}

const OTHERS_KEY = '__outros';

/**
 * Agrupa o catálogo por família, na ordem em que o servidor manda. Tipos assinados que não estão no catálogo
 * (assinaturas antigas, ex.: `ticket.*`) vão para "Outros", para o usuário poder desmarcar.
 */
export function groupEventTypes(catalog: EventTypeInfo[], selected: string[]): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  for (const e of catalog) {
    const group = groups.get(e.family) ?? { key: e.family, label: e.familyLabel, events: [] };
    group.events.push({ type: e.type, description: e.description });
    groups.set(e.family, group);
  }
  const known = new Set(catalog.map((e) => e.type));
  const others = selected.filter((type) => !known.has(type)).sort();
  if (others.length > 0) {
    groups.set(OTHERS_KEY, {
      key: OTHERS_KEY,
      label: 'Outros (o Core não emite)',
      events: others.map((type) => ({ type, description: 'Assinatura antiga: desmarque para remover' })),
    });
  }
  return [...groups.values()];
}
