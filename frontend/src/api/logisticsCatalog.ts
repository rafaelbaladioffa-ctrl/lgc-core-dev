import { api } from './client';

export interface LogisticsCatalogItem {
  id: string;
  code: string;
  shortDescription: string;
  technicalDescription?: string | null;
  category: string;
  subcategory?: string | null;
  unit: string;
  unitPrice: string | null;
}

/** Linha de `POST materials/availability:batch` do satélite Logística — `available` já descontou
 * reserva e bloqueio (lote vencido/condição), é o número que o solicitante deve ver. */
export interface MaterialAvailability {
  material_id: string;
  available: string;
}

const baseUrl = import.meta.env.VITE_LOGISTICA_API_BASE_URL ?? '/logistica-api';

// Teto do próprio endpoint (`ArrayMaxSize(200)` em availability.controller.ts) — acima disso a
// consulta é dividida em várias chamadas em paralelo.
const AVAILABILITY_BATCH_SIZE = 200;

export const logisticsCatalogApi = {
  // Reutiliza o cliente do Core para manter o mesmo token e o refresh automático
  // quando a sessão expira, apenas trocando a base URL para o satélite Logística.
  list: () => api.get<LogisticsCatalogItem[]>('/materials/purchase-catalog', { baseURL: baseUrl }).then((response) => response.data),
  /** Disponível em estoque por material — o papel "Solicitante Axis" do satélite já tem
   * `stock:read` especificamente para isto (ver lgc-dev-logistica rbac/catalog.ts). */
  availability: async (materialIds: string[]): Promise<MaterialAvailability[]> => {
    if (materialIds.length === 0) return [];
    const chunks: string[][] = [];
    for (let i = 0; i < materialIds.length; i += AVAILABILITY_BATCH_SIZE) chunks.push(materialIds.slice(i, i + AVAILABILITY_BATCH_SIZE));
    const results = await Promise.all(
      chunks.map((chunk) =>
        api.post<{ items: MaterialAvailability[] }>('/materials/availability:batch', { material_ids: chunk }, { baseURL: baseUrl }).then((r) => r.data.items),
      ),
    );
    return results.flat();
  },
};
