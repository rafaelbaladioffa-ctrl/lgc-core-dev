/** Famílias do código do material (prefixo), as mesmas do catálogo inicial da seção 8. */
export const MATERIAL_FAMILIES = [
  { prefix: 'EPI', label: 'EPI — equipamento de proteção individual', type: 'EPI' },
  { prefix: 'EPC', label: 'EPC — equipamento de proteção coletiva', type: 'EPC' },
  { prefix: 'FER', label: 'FER — ferramentas', type: 'FERRAMENTA' },
  { prefix: 'EQP', label: 'EQP — equipamentos', type: 'EQUIPAMENTO' },
  { prefix: 'CON', label: 'CON — consumíveis', type: 'CONSUMO' },
  { prefix: 'ELE', label: 'ELE — material elétrico', type: 'CONSUMO' },
  { prefix: 'RED', label: 'RED — redes e cabeamento', type: 'CONSUMO' },
  { prefix: 'TI', label: 'TI — tecnologia da informação', type: 'ATIVO' },
  { prefix: 'LIM', label: 'LIM — limpeza', type: 'CONSUMO' },
  { prefix: 'ESC', label: 'ESC — escritório', type: 'CONSUMO' },
  { prefix: 'EMB', label: 'EMB — embalagens', type: 'EMBALAGEM' },
] as const;

export const FAMILY_PREFIXES: string[] = MATERIAL_FAMILIES.map((f) => f.prefix);
