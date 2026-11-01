import { IsOptional, IsUUID } from 'class-validator';

export class AssignRequestDto {
  @IsUUID()
  assigneeId!: string;

  @IsOptional()
  @IsUUID()
  queueId?: string;
}
