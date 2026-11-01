import { IsDateString, IsEmail, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { MaritalStatus, ContractType, Gender, ManagementLevel } from '@prisma/client';

export class CreateCollaboratorDto {
  @IsString()
  @MaxLength(255)
  fullName!: string;

  @IsString()
  @MaxLength(20)
  rg!: string;

  @IsString()
  @MaxLength(14)
  cpf!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  ctps?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  pis?: string;

  // Split from a single "email" field: corporateEmail is the collaborator's primary/unique
  // address; personalEmail is informational only. Neither one is the login identifier — that's
  // User.email, a separate record (User.collaboratorId just optionally links the two).
  @IsEmail()
  corporateEmail!: string;

  @IsOptional()
  @IsEmail()
  personalEmail?: string;

  @IsUUID()
  jobTitleId!: string;

  @IsUUID()
  sectorId!: string;

  @IsOptional()
  @IsUUID()
  supervisorId?: string;

  @IsOptional()
  @IsDateString()
  asoDate?: string;

  @IsOptional()
  @IsDateString()
  asoValidity?: string;

  // Not a yes/no flag: it's the yellow-badge login/identifier string itself.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  yellowBadge?: string;

  // Independent of jobTitleId (HR job title) — only used to resolve the multi-level approval
  // chain for high-cost ticket requests (PLANNING.md 4.6.2). Defaults to "colaborador" in the DB.
  @IsOptional()
  @IsEnum(ManagementLevel)
  managementLevel?: ManagementLevel;

  // Personal / contact data
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  emergencyContactPhone?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsEnum(MaritalStatus)
  maritalStatus?: MaritalStatus;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  // Address — filled by the frontend's ViaCEP autocomplete on `cep`, but every field stays
  // independently editable since ViaCEP responses are sometimes wrong or incomplete.
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'cep must be in the format 00000-000 or 00000000' })
  cep?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressStreet?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  addressNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  addressComplement?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  addressDistrict?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  addressCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  addressState?: string;

  // Employment data
  @IsOptional()
  @IsDateString()
  admissionDate?: string;

  @IsOptional()
  @IsEnum(ContractType)
  contractType?: ContractType;

  @IsOptional()
  @IsUUID()
  workScheduleId?: string;

  // Which cost center this collaborator is allocated to — optional, not scoped to the sector
  // chosen above (the planning session confirmed the full cost-center list, not a sector-filtered
  // one).
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  // Documents / compliance. Photo metadata mirrors the ticket-attachment pattern: the API stores
  // a filename + storage path, it does not host the binary upload itself.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  photoFilename?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoStoragePath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  uniformSize?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(A|B|C|D|E|AB|AC|AD|AE)$/, { message: 'cnhCategory must be one of A, B, C, D, E, AB, AC, AD, AE' })
  cnhCategory?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/, { message: 'cnhNumber must be 11 digits' })
  cnhNumber?: string;

  @IsOptional()
  @IsDateString()
  cnhExpiresAt?: string;
}
