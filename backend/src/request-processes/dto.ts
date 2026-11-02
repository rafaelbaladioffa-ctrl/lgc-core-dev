import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBpmQueueDto {
  @IsUUID() sectorId!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsArray() @IsUUID('4', { each: true }) members!: string[];
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) managers?: string[];
}
export class UpdateBpmQueueDto extends CreateBpmQueueDto {
  @IsInt() @Min(0) expectedVersion!: number;
}
export class CreateBpmProcessDto {
  @IsString() @MinLength(2) @MaxLength(40) code!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @MinLength(2) @MaxLength(500) description!: string;
  @IsUUID() sectorId!: string;
  @IsUUID() triageQueueId!: string;
  @IsUUID() executionQueueId!: string;
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  publisherUserIds?: string[];
}
export class CreateVersionDto {
  @IsOptional() @IsInt() @Min(1) cloneVersionId?: number;
  @IsInt() @Min(0) expectedVersion!: number;
}
export class PatchVersionDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsObject() definition!: Record<string, unknown>;
}
export class ExpectedVersionDto {
  @IsInt() @Min(0) expectedVersion!: number;
}
export class PublishVersionDto extends ExpectedVersionDto {
  @IsString() validatedHash!: string;
}
export class GrantDto {
  @IsUUID() userId!: string;
  @IsIn(['modeler', 'publisher', 'operator', 'auditor']) role!:
    'modeler' | 'publisher' | 'operator' | 'auditor';
  @IsOptional() @IsBoolean() restrictedRead?: boolean;
}
export class GrantPatchDto extends ExpectedVersionDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GrantDto)
  grants!: GrantDto[];
}
