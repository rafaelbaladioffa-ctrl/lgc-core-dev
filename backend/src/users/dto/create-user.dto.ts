import { ArrayMinSize, IsArray, IsEmail, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsUUID()
  collaboratorId!: string;

  /** Defaults to the collaborator's corporate_email when omitted. */
  @IsOptional()
  @IsEmail()
  email?: string;

  /** Temporary password set by the admin/RH. Auto-generated server-side when omitted. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  temporaryPassword?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  roleIds!: string[];
}
