import { ArrayUnique, IsArray, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class SaveRoleDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  permissionIds!: string[];
}
