import { IsBase64, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * Conteúdo em base64 no corpo JSON — não multipart/form-data. Decisão pragmática: o resto desta
 * API é só JSON, e endpoint de upload binário "de verdade" (multipart, URL de download
 * temporária) depende da decisão de infraestrutura de armazenamento ainda pendente (ver
 * requests.service.ts). Isso é adequado pro armazenamento BYTEA temporário atual, mas deve ser
 * revisto (provavelmente pra multipart + stream) quando a infraestrutura definitiva entrar —
 * base64 infla o payload ~33% e não é indicado para arquivos grandes.
 */
export class CreateRequestAttachmentDto {
  @IsString()
  @MinLength(1)
  filename!: string;

  @IsBase64()
  contentBase64!: string;

  // Envia uma nova versão deste anexo em vez de um anexo novo e independente (§16: "anexo
  // substituído cria nova versão; nunca sobrescrever silenciosamente").
  @IsOptional()
  @IsUUID()
  replacesAttachmentId?: string;
}
