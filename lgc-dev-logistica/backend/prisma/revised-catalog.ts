export type RevisedCatalogItem = {
  code: string;
  description: string;
  category: string;
  uom: string;
  price: number;
  type: 'EPI' | 'FERRAMENTA' | 'CONSUMO';
  manufacturer?: string;
  technicalDescription?: string;
};

// Fonte: lista_itens_catalogo_logistica_revisada.xlsx (itens com preço definido).
export const REVISED_CATALOG: RevisedCatalogItem[] = [
  { code: 'REV-01234875', description: 'Cordão para crachá', category: 'Uniformes', uom: 'UN', price: 10.3, type: 'CONSUMO', manufacturer: 'E&M' },
  { code: 'REV-013322', description: 'Crachá em PVC com identificação', category: 'Uniformes', uom: 'UN', price: 15.5, type: 'CONSUMO', manufacturer: 'E&M' },
  { code: 'REV-09270', description: 'Mochila de poliéster USB 26 L', category: 'Uniformes', uom: 'UN', price: 139.9, type: 'CONSUMO', manufacturer: 'E&M' },
  { code: 'REV-484913', description: 'Colete gestor', category: 'Uniformes', uom: 'UN', price: 149, type: 'CONSUMO', manufacturer: 'E&M' },
  { code: 'REV-23559', description: 'Calça com elástico e faixa refletiva', category: 'Uniformes', uom: 'UN', price: 103.3, type: 'CONSUMO', manufacturer: 'E&M' },
  { code: 'REV-9561174', description: 'Camisa manga longa com faixa refletiva', category: 'Uniformes', uom: 'UN', price: 178.2, type: 'CONSUMO', manufacturer: 'E&M' },
  { code: 'REV-965412', description: 'Camiseta polo manga curta, 2 cores', category: 'Uniformes', uom: 'UN', price: 72, type: 'CONSUMO', manufacturer: 'E&M' },
  { code: 'REV-1147821', description: 'Porta-crachá vertical transparente para 2 cartões', category: 'Uniformes', uom: 'UN', price: 2.5, type: 'CONSUMO', manufacturer: 'E&M' },
  { code: 'REV-EPI-001', description: 'Capacete de segurança', category: 'EPI', uom: 'UN', price: 200, type: 'EPI', manufacturer: 'Montana' },
  { code: 'REV-EPI-002', description: 'Luva de corte', category: 'EPI', uom: 'UN', price: 19, type: 'EPI', manufacturer: 'Volk' },
  { code: 'REV-EPI-003', description: 'Luva tátil', category: 'EPI', uom: 'UN', price: 4.8, type: 'EPI', manufacturer: 'Volk' },
  { code: 'REV-EPI-004', description: 'Bota de segurança ocupacional', category: 'EPI', uom: 'PAR', price: 296, type: 'EPI', manufacturer: 'Marluvas' },
  { code: 'REV-EPI-005', description: 'Óculos de proteção', category: 'EPI', uom: 'UN', price: 12, type: 'EPI', manufacturer: 'Vonder' },
  { code: 'REV-EPI-006', description: 'Protetor auricular para acoplar ao capacete', category: 'EPI', uom: 'UN', price: 52.9, type: 'EPI', manufacturer: 'SteelFlex' },
  { code: 'REV-EPI-007', description: 'Prendedor de luva', category: 'EPI', uom: 'UN', price: 15.4, type: 'EPI', manufacturer: 'LMK/B' },
  { code: 'REV-EPI-008', description: 'Cinto paraquedista', category: 'EPI', uom: 'UN', price: 245, type: 'EPI', manufacturer: 'Carbografite' },
  { code: 'REV-EPI-009', description: 'Talabarte Y', category: 'EPI', uom: 'UN', price: 145, type: 'EPI', manufacturer: 'Elevado Cintos' },
  { code: 'REV-FER-001', description: 'Crimpador RJ45', category: 'Ferramentais', uom: 'UN', price: 40, type: 'FERRAMENTA', manufacturer: 'EZ' },
  { code: 'REV-FER-002', description: 'Estilete retrátil', category: 'Ferramentais', uom: 'UN', price: 31.82, type: 'FERRAMENTA', manufacturer: 'Onsite' },
  { code: 'REV-FER-003', description: 'Alicate de corte', category: 'Ferramentais', uom: 'UN', price: 39.41, type: 'FERRAMENTA', manufacturer: 'Gedore' },
  { code: 'REV-FER-004', description: 'Alicate de corte de precisão', category: 'Ferramentais', uom: 'UN', price: 18.04, type: 'FERRAMENTA', manufacturer: 'Plato' },
  { code: 'REV-FER-005', description: 'Tesoura de Kevlar', category: 'Ferramentais', uom: 'UN', price: 39.99, type: 'FERRAMENTA' },
  { code: 'REV-FER-006', description: 'Mala para ferramentas', category: 'Ferramentais', uom: 'UN', price: 95, type: 'FERRAMENTA' },
  { code: 'REV-FER-007', description: 'Testador RJ45', category: 'Ferramentais', uom: 'UN', price: 76.68, type: 'FERRAMENTA' },
  { code: 'REV-FER-008', description: 'Kit de chaves Phillips e fenda', category: 'Ferramentais', uom: 'KIT', price: 50, type: 'FERRAMENTA' },
  { code: 'REV-FER-009', description: 'Alicate universal', category: 'Ferramentais', uom: 'UN', price: 36, type: 'FERRAMENTA' },
  { code: 'REV-FER-010', description: 'VFL — localizador visual de falhas', category: 'Ferramentais', uom: 'UN', price: 32.99, type: 'FERRAMENTA' },
  { code: 'REV-FER-011', description: 'Power meter', category: 'Ferramentais', uom: 'UN', price: 257.4, type: 'FERRAMENTA' },
  { code: 'REV-FER-012', description: 'Mala de ferramenta', category: 'Ferramentais', uom: 'UN', price: 112.38, type: 'FERRAMENTA' },
];
