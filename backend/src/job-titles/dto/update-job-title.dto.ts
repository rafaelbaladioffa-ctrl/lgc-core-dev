import { PartialType } from '@nestjs/mapped-types';
import { CreateJobTitleDto } from './create-job-title.dto.js';

export class UpdateJobTitleDto extends PartialType(CreateJobTitleDto) {}
