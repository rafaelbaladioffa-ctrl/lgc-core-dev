import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateSectorDto } from './create-sector.dto.js';

// parentSectorId is deliberately excluded: reparenting would require recomputing the hierarchical
// code for the sector and every descendant, which this iteration doesn't support. Create a new
// sector under the desired parent instead.
export class UpdateSectorDto extends PartialType(OmitType(CreateSectorDto, ['parentSectorId'] as const)) {}
