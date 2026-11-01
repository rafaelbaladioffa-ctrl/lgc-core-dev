import { IsOptional, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  /** New temporary password. Auto-generated server-side when omitted. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  temporaryPassword?: string;
}
