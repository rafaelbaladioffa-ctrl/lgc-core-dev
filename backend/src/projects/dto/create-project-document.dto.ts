import { IsBase64, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { ProjectDocumentKind } from '@prisma/client';

/**
 * Conteúdo em base64 no corpo JSON, como nos anexos de requisição (create-attachment.dto.ts):
 * o armazenamento atual é BYTEA e o limite do corpo em main.ts já comporta 25MB em base64.
 */
export class CreateProjectDocumentDto {
  @IsEnum(ProjectDocumentKind, { message: 'Tipo de documento inválido.' })
  kind!: ProjectDocumentKind;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename!: string;

  @IsBase64({}, { message: 'Conteúdo do arquivo inválido.' })
  contentBase64!: string;
}
