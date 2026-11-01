/** Interpretação de códigos lidos por câmera ou coletor: QR/barras internos, SKU, GTIN e código de endereço. */

export interface BootMaterial { id: string; code: string; description: string; uom: string; uomPrecision: number; serialControlled: boolean; barcodes: Array<{ code: string; factor: string }> }
export interface BootLocation { id: string; code: string; name?: string | null }

export type Scanned =
  | { kind: 'location'; id: string; code: string }
  | { kind: 'material'; id: string; code: string; factor: number; lotNumber?: string }
  | { kind: 'unknown'; raw: string };

function byLocation(code: string, locations: BootLocation[]): Scanned | null {
  const l = locations.find((x) => x.code.toUpperCase() === code.toUpperCase());
  return l ? { kind: 'location', id: l.id, code: l.code } : null;
}

export function resolveCode(raw: string, materials: BootMaterial[], locations: BootLocation[]): Scanned {
  const code = raw.trim();
  if (!code) return { kind: 'unknown', raw };

  // Formatos internos das etiquetas (16.1): LGC:LOC:<almox>:<endereço> · LGC:MAT:<sku>[:LOT:<lote>]
  const parts = code.split(':');
  if (parts[0] === 'LGC') {
    if (parts[1] === 'LOC' && parts[3]) return byLocation(parts[3], locations) ?? { kind: 'unknown', raw };
    if (parts[1] === 'MAT' && parts[2]) {
      const m = materials.find((x) => x.code === parts[2]);
      const lot = parts[3] === 'LOT' ? parts.slice(4).join(':') : undefined;
      return m ? { kind: 'material', id: m.id, code: m.code, factor: 1, lotNumber: lot } : { kind: 'unknown', raw };
    }
    return { kind: 'unknown', raw };
  }

  const bar = materials.flatMap((m) => m.barcodes.map((b) => ({ m, b }))).find((x) => x.b.code === code);
  if (bar) return { kind: 'material', id: bar.m.id, code: bar.m.code, factor: Number(bar.b.factor) || 1 };
  const sku = materials.find((m) => m.code.toUpperCase() === code.toUpperCase());
  if (sku) return { kind: 'material', id: sku.id, code: sku.code, factor: 1 };
  return byLocation(code, locations) ?? { kind: 'unknown', raw };
}
