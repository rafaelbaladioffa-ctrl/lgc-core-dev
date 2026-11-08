/** Tipos aceitos no servidor (backend/src/requests/attachment-security.ts): PDF, DOCX/XLSX, PNG e JPG, até 25MB. */
export const DOCUMENT_ACCEPT = '.pdf,.docx,.xlsx,.png,.jpg,.jpeg';

/** Bid Template do cliente: planilha com ou sem macros. */
export const SPREADSHEET_ACCEPT = '.xlsx,.xlsm';

/** Conteúdo do arquivo em base64 (sem o prefixo `data:`), para os endpoints JSON de anexo. */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Baixa um arquivo recebido da API com o nome informado. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
