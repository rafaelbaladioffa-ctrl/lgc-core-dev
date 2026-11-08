import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBase64,
  IsBoolean,
  IsEmail,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "Solicitar cotação" na tela do projeto. */
export class RequestProjectQuoteDto {
  /** Recado para o orçamentista (ex.: "cliente pediu a proposta até sexta"). */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Uma função da equipe orçada (técnico, encarregado, gerente…). Quantidade, nunca pessoas nomeadas. */
export class ProjectQuoteTeamLineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  role_key!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  role_name!: string;

  /** Funções de campo entram em pessoas × dias; o gerente entra só em horas. */
  @IsBoolean()
  field_role!: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  people?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  days?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000000)
  hours!: number;
}

export class ProjectQuoteBidFileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;

  @IsBase64({}, { message: 'Conteúdo da Bid inválido.' })
  content_base64!: string;
}

/**
 * Cotação devolvida pelo satélite Financeiro (revisão aprovada para envio). Contrato em
 * docs/integracao-core-financeiro.md §4; nomes em snake_case como nos eventos.
 */
export class ReceiveProjectQuoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  external_revision_id!: string;

  @IsInt()
  @Min(1)
  revision_number!: number;

  /** SOW do Core usada na cotação. */
  @IsOptional()
  @IsUUID()
  sow_document_id?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  work_days!: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DATE_ONLY)
  planned_start_date?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DATE_ONLY)
  planned_end_date?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProjectQuoteTeamLineDto)
  team!: ProjectQuoteTeamLineDto[];

  @IsOptional()
  @IsISO8601()
  approved_at?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  approved_by_email?: string;

  @ValidateNested()
  @Type(() => ProjectQuoteBidFileDto)
  bid!: ProjectQuoteBidFileDto;
}
