import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';

/**
 * Anexos seguros (REQUISICOES_SPEC.md §16) — a parte que NÃO depende da decisão de infraestrutura
 * ainda pendente (armazenamento definitivo / motor de antimalware real):
 * - MIME detectado pelos bytes do arquivo, nunca confiado do Content-Type/extensão informados.
 * - Nome de arquivo seguro gerado (uuid + extensão), nunca o nome original do usuário.
 * - Bloqueio de executáveis/scripts (assinatura + extensão), tipo mais perigoso e mais barato de
 *   detectar sem um motor de antivírus de verdade.
 * - Limites de tipo/tamanho (recomendação inicial do documento: 25MB/arquivo, 100MB/requisição).
 *
 * **NÃO é antimalware de verdade** — isso exigiria um motor real (ex.: ClamAV) ou um serviço
 * externo, que depende da decisão de infraestrutura ainda pendente com o usuário. O que está
 * aqui é defesa específica e barata (bloquear o tipo de arquivo mais perigoso de se aceitar: um
 * executável/script disfarçado), não uma varredura de assinaturas de vírus.
 */

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB — recomendação inicial do §16
export const MAX_REQUEST_TOTAL_BYTES = 100 * 1024 * 1024; // 100MB por requisição

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/zip': 'zip', // DOCX/XLSX/PPTX são ZIP por dentro — ver sniffMimeType
};

const DANGEROUS_EXTENSIONS = ['.exe', '.bat', '.cmd', '.com', '.scr', '.ps1', '.vbs', '.js', '.jar', '.msi', '.sh', '.app'];

/** Detecta o tipo real pelos primeiros bytes — ignora a extensão/Content-Type informados. Cobre
 * só os tipos mais comuns (§16: "recomendação inicial: PDF, DOCX, XLSX, PNG, JPG"); qualquer
 * outro tipo é recusado por padrão (allowlist, não blocklist). */
export function sniffMimeType(buffer: Buffer): string {
  if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'application/pdf';
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  // ZIP local file header ("PK\x03\x04") — também o formato por dentro de DOCX/XLSX/PPTX; não dá
  // pra diferenciar sem abrir o arquivo e inspecionar `[Content_Types].xml`, o que esta versão
  // não faz (documentado como limitação — tratamos todos como "application/zip" genérico).
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return 'application/zip';
  return 'application/octet-stream';
}

/** Assinatura de executável (Windows PE "MZ", ELF Linux, shebang de script) OU extensão
 * perigosa no nome original — qualquer um dos dois já é motivo de bloqueio. */
export function isDangerousUpload(buffer: Buffer, originalFilename: string): boolean {
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) return true; // "MZ", Windows PE
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) return true; // ELF
  if (buffer.length >= 2 && buffer[0] === 0x23 && buffer[1] === 0x21) return true; // "#!" shebang
  // Pega também "fatura.pdf.exe" (extensão dupla) — o que importa é com que extensão o nome
  // termina, já que é essa que o SO usa pra decidir como abrir/executar o arquivo.
  const lower = originalFilename.toLowerCase();
  return DANGEROUS_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Valida tamanho + tipo (allowlist) e devolve o MIME real; lança 400 com mensagem em pt-BR se
 * recusado. Nunca usa o `declaredFilename` para decidir o tipo — só para a mensagem de erro. */
export function validateAttachment(buffer: Buffer, declaredFilename: string): string {
  if (buffer.length === 0) throw new BadRequestException('Arquivo vazio');
  if (buffer.length > MAX_FILE_SIZE_BYTES) throw new BadRequestException(`Arquivo "${declaredFilename}" excede o limite de ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`);
  if (isDangerousUpload(buffer, declaredFilename)) throw new BadRequestException(`Arquivo "${declaredFilename}" bloqueado: tipo não permitido (executável/script)`);
  const mimeType = sniffMimeType(buffer);
  if (!ALLOWED_MIME_TYPES[mimeType]) throw new BadRequestException(`Arquivo "${declaredFilename}" bloqueado: tipo de conteúdo não permitido`);
  return mimeType;
}

/** Nunca o nome original — gerado, sem nenhum caractere do usuário (evita path traversal/nome
 * malicioso), com a extensão do tipo real detectado. */
export function generateSafeFilename(mimeType: string): string {
  const extension = ALLOWED_MIME_TYPES[mimeType] ?? 'bin';
  return `${randomUUID()}.${extension}`;
}
