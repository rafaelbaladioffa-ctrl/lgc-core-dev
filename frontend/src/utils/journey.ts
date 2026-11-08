import type { JourneyState } from '../api/projects';

/** Estado de uma etapa da jornada do projeto em português (PT-11). */
export const JOURNEY_STATE_LABEL: Record<JourneyState, string> = {
  feito: 'Feito',
  em_andamento: 'Em andamento',
  pendente: 'Pendente',
  atencao: 'Atenção',
};
