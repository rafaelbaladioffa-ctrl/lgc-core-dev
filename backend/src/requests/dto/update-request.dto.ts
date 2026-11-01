import { PartialType } from '@nestjs/mapped-types';
import { CreateRequestDto } from './create-request.dto.js';

/** Edits allowed only while RASCUNHO (§5.2) — enforced in the service, not here. */
export class UpdateRequestDto extends PartialType(CreateRequestDto) {}
