import { IsDateString, IsIn, IsNumberString, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const PRIORITIES = ['baixa', 'normal', 'alta', 'critica'] as const;
const CONFIDENTIALITY = ['interna', 'confidencial', 'restrita'] as const;

// No `requesterId`: always the logged-in user (JWT), same principle as the previous module.
// `beneficiaryId` defaults to the requester when absent — "abrir em nome de terceiro" is explicit.
export class CreateRequestDto {
  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsUUID()
  beneficiaryId?: string;

  // Para categorias do tipo compra_material o título é gerado no servidor. Nas demais categorias continua obrigatório.
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(120)
  title?: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: 'baixa' | 'normal' | 'alta' | 'critica';

  @IsOptional()
  @IsIn(CONFIDENTIALITY)
  confidentiality?: 'interna' | 'confidencial' | 'restrita';

  @IsOptional()
  @IsDateString()
  neededBy?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @IsOptional()
  @IsNumberString()
  estimatedValue?: string;

  @IsOptional()
  @IsObject()
  formData?: Record<string, unknown>;

  // §11.4: cria a requisição já vinculada como subtarefa de outra — RequestsService.create
  // grava o RequestRelation (relation_type = subtarefa_de); o pai não conclui enquanto esta
  // (e qualquer outra subtarefa) não estiver concluida/encerrada/cancelada.
  @IsOptional()
  @IsUUID()
  parentRequestId?: string;
}
