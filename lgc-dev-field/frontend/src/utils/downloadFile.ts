import { apiClient } from "../api/client";

/** Baixa um arquivo autenticado da API (a API usa JWT via header, então uma
 * <a href> comum não funcionaria — o navegador não anexa o Authorization). */
export async function downloadAuthenticatedFile(url: string, filename: string) {
  const response = await apiClient.get(url, { responseType: "blob" });
  const blobUrl = URL.createObjectURL(response.data as Blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(blobUrl);
}
