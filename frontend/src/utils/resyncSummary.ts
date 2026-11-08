import type { MasterDataResyncResult } from '../api/integration';

/** Contagem do "Reenviar cadastros" em texto: "2 centros de custo, 10 colaboradores, … e 3 feriados". */
export function resyncSummary(r: MasterDataResyncResult): string {
  const parts = [
    `${r.costCenters} centros de custo`,
    `${r.collaborators} colaboradores`,
    `${r.allocations} alocações`,
    `${r.clients} clientes`,
    `${r.sites} sites`,
    `${r.projects} projetos`,
    `${r.users} usuários`,
    `${r.jobTitles} cargos`,
    `${r.holidays} feriados`,
  ];
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}
