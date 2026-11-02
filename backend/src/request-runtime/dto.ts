import {
  IsBase64,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
export class ListBpmDto {
  @IsOptional() @IsUUID() cursor?: string;
  @IsOptional() @IsIn(['mine','queue']) view?: 'mine' | 'queue';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
export class CreateBpmRequestDto {
  @IsOptional() @IsUUID() commandId?: string;
  @IsOptional() @IsString() @MinLength(8) commandKey?: string;
  @IsUUID() categoryId!: string;
  @IsUUID() versionId!: string;
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() fields?: Record<string, unknown>;
  @IsOptional() @IsUUID() beneficiaryId?: string;
}
export class DraftPatchDto {
  @IsOptional() @IsUUID() commandId?: string;
  @IsOptional() @IsString() @MinLength(8) commandKey?: string;
  @IsInt() @Min(0) expectedVersion!: number;
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() fields?: Record<string, unknown>;
}
export class CommandDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @MinLength(8) commandKey!: string;
  @IsUUID() commandId!: string;
}
export class CompleteActivityDto extends CommandDto {
  @IsString() @MinLength(3) resolution!: string;
}
export class ReasonCommandDto extends CommandDto {
  @IsString() @MinLength(3) reason!: string;
}
export class ReassignDto extends ReasonCommandDto {
  @IsUUID() assigneeId!: string;
}
export class CommentDto {
  @IsOptional() @IsUUID() commandId?: string;
  @IsOptional() @IsString() commandKey?: string;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
  @IsOptional() @IsIn(['publico', 'interno']) visibility?:
    'publico' | 'interno';
}
export class AttachmentDto {
  @IsOptional() @IsUUID() previousId?: string;
  @IsOptional() @IsUUID() commandId?: string;
  @IsOptional() @IsString() commandKey?: string;
  @IsString() @MaxLength(255) filename!: string;
  @IsBase64() contentBase64!: string;
  @IsOptional() @IsString() fieldKey?: string;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}
export class ReturnForCorrectionDto extends CommandDto {
  @IsString() @MinLength(3) reason!: string;
  @IsOptional() @IsString({ each: true }) editableFieldKeys?: string[];
}
export class SaveCorrectionDto {
  @IsOptional() @IsUUID() commandId?: string;
  @IsOptional() @IsString() @MinLength(8) commandKey?: string;
  @IsInt() @Min(0) expectedVersion!: number;
  @IsOptional() @IsObject() fields?: Record<string, unknown>;
}
export class ResubmitDto extends CommandDto {}
export class RequestInformationDto extends CommandDto {
  @IsString() @MinLength(3) @MaxLength(2000) question!: string;
}
export class RespondInformationDto extends CommandDto {
  @IsString() @MinLength(1) @MaxLength(4000) answer!: string;
  @IsOptional() @IsObject() fields?: Record<string, unknown>;
}
