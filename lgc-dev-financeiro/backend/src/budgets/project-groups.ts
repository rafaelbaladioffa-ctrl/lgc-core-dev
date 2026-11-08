import type { CcCategory } from '@prisma/client';

/**
 * Grupos do resultado do projeto (PA-16): os mesmos quatro grupos de custo do motor do orçamento
 * (`BudgetResult.groups`), cada um com as categorias dos lançamentos do CC que o compõem. É por eles que o
 * cotado, o comprometido e o realizado se comparam: o realizado chega em categorias do CC (compra, reembolso,
 * consumo da Logística…), que não casam uma a uma com as linhas do orçamento.
 */
export type GroupKey = 'mao_de_obra' | 'material' | 'deslocamento_e_estadia' | 'outros';

export const RESULT_GROUPS: ReadonlyArray<{ key: GroupKey; label: string; categories: readonly CcCategory[] }> = [
  { key: 'mao_de_obra', label: 'Mão de obra', categories: ['folha'] },
  { key: 'material', label: 'Material (inclui frete e compras)', categories: ['material', 'compras'] },
  { key: 'deslocamento_e_estadia', label: 'Deslocamento, plataforma, hospedagem e alimentação', categories: ['frota', 'servicos', 'despesas_campo'] },
  { key: 'outros', label: 'Outros custos', categories: ['outros'] },
];

export const groupOfCategory = (category: string): GroupKey | null => RESULT_GROUPS.find((g) => (g.categories as readonly string[]).includes(category))?.key ?? null;
