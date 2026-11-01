import { IsIn } from 'class-validator';

export class SetUserStatusDto {
  @IsIn(['active', 'disabled'])
  status!: 'active' | 'disabled';
}
